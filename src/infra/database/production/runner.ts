import {
  DatabaseConfigError,
  resolveConnection,
  type ResolvedConnection,
} from '../connection-options';
import {
  CATALOG_COLUMNS,
  CATALOG_FILE,
  CREATE_CATALOG_TABLE,
  EXPECTED_CATALOG,
  parseCatalog,
  upsertStatements,
  type CatalogExpectation,
} from './catalog';
import {
  CATALOG_TABLE,
  MIGRATIONS_TABLE,
  evaluateMigrationState,
  type MigrationState,
} from './migration-state';
import {
  GuardError,
  assertHostConfirmed,
  assertTargetAllowed,
  describeTarget,
  formatTarget,
  isLocalHost,
  type DbTarget,
  type DevIdentity,
} from './target';

export type Query = (sql: string, params?: unknown[]) => Promise<any[]>;

/** Conexão usada pelos comandos. `inspect` roda numa transação SOMENTE LEITURA. */
export interface DbSession {
  inspect<T>(fn: (query: Query) => Promise<T>): Promise<T>;
  /** Aplica as migrations pendentes numa única transação; devolve os nomes aplicados. */
  runMigrations(): Promise<string[]>;
  /** Executa `fn` numa transação de escrita: qualquer erro desfaz tudo. */
  write<T>(fn: (query: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface RunnerDeps {
  argv: string[];
  /** Cópia do ambiente do processo. O `.env` nunca entra aqui. */
  env: Record<string, string | undefined>;
  /** Banco de desenvolvimento (do `.env`), usado só para ser recusado. */
  devIdentity: DevIdentity;
  knownMigrations: string[];
  readFile: (path: string) => Buffer;
  connect: (connection: ResolvedConnection) => Promise<DbSession>;
  prompt: (question: string) => Promise<string>;
  log: (line: string) => void;
  catalogExpectation?: CatalogExpectation;
}

export const CONFIRMATION_WORD = 'APLICAR';

interface Options {
  command: 'migrate' | 'catalog';
  apply: boolean;
  allowLocalTest: boolean;
  file: string;
}

export function parseArgs(argv: string[]): Options {
  const [command, ...flags] = argv;
  if (command !== 'migrate' && command !== 'catalog') {
    throw new GuardError('Use: migrate | catalog [--dry-run | --apply]');
  }
  let apply = false;
  let dryRun = false;
  let allowLocalTest = false;
  let file = CATALOG_FILE;
  for (const flag of flags) {
    if (flag === '--apply') apply = true;
    else if (flag === '--dry-run') dryRun = true;
    else if (flag === '--allow-local-test') allowLocalTest = true;
    else if (flag.startsWith('--file=') && command === 'catalog') {
      file = flag.slice('--file='.length);
    } else throw new GuardError(`Opção desconhecida: ${flag}`);
  }
  if (apply && dryRun) {
    throw new GuardError('Use --dry-run OU --apply, não os dois.');
  }
  return { command, apply, allowLocalTest, file };
}

interface ServerInfo {
  database: string;
  user: string;
  ssl: boolean;
  version: string;
}

async function readState(
  session: DbSession,
  known: string[],
): Promise<{
  info: ServerInfo;
  tables: string[];
  state: MigrationState;
}> {
  return session.inspect(async (query) => {
    const [info] = (await query(
      `SELECT current_database() AS database, current_user AS "user",
              COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
              version() AS version`,
    )) as ServerInfo[];
    const tables = (
      (await query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
      )) as { table_name: string }[]
    ).map((row) => row.table_name);
    const applied = tables.includes(MIGRATIONS_TABLE)
      ? (
          (await query(
            `SELECT name FROM "${MIGRATIONS_TABLE}" ORDER BY id`,
          )) as { name: string }[]
        ).map((row) => row.name)
      : null;
    return {
      info,
      tables,
      state: evaluateMigrationState({ tables, applied }, known),
    };
  });
}

async function confirm(deps: RunnerDeps, target: DbTarget, action: string) {
  const answer = await deps.prompt(
    `Digite ${CONFIRMATION_WORD} para ${action} em ${target.host}/${target.database}: `,
  );
  if (answer.trim() !== CONFIRMATION_WORD) {
    throw new GuardError('Confirmação não recebida. Nada foi alterado.');
  }
}

/**
 * Comandos de banco de produção: mostram o destino, conferem SSL e estado, simulam por
 * padrão e só escrevem com --apply + CONFIRM_DB_HOST + confirmação digitada.
 */
export async function runProdCommand(deps: RunnerDeps): Promise<void> {
  const options = parseArgs(deps.argv);
  const log = deps.log;

  const rawUrl = deps.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new GuardError(
      'DATABASE_URL não está definida neste terminal. Comandos de produção nunca usam o .env como destino.',
    );
  }

  let connection: ResolvedConnection;
  try {
    connection = resolveConnection({
      DATABASE_URL: rawUrl,
      DB_SSL: deps.env.DB_SSL,
    });
  } catch (error) {
    if (error instanceof DatabaseConfigError)
      throw new GuardError(error.message);
    throw error;
  }
  const target = describeTarget(connection.url as string);
  const local =
    isLocalHost(target.host) || target.host === deps.devIdentity.host;

  log(`Destino: ${formatTarget(target)}`);
  log(
    `SSL: ${connection.sslRequired ? 'obrigatório, com validação do certificado' : 'não exigido'}` +
      (connection.channelBinding ? ' · channel binding ativado' : ''),
  );
  log(
    `Modo: ${options.apply ? 'APLICAÇÃO (grava no banco)' : 'SIMULAÇÃO (--dry-run, nada é gravado)'}`,
  );

  assertTargetAllowed(target, deps.devIdentity, options.allowLocalTest);
  assertHostConfirmed(target, deps.env.CONFIRM_DB_HOST);
  if (!local && !connection.sslRequired) {
    throw new GuardError(
      'Fora do ensaio local o SSL é obrigatório: defina DB_SSL=true ou use sslmode=require na URL.',
    );
  }
  if (local) log('Ensaio local autorizado (--allow-local-test).');

  const expectation = deps.catalogExpectation ?? EXPECTED_CATALOG;
  const catalog =
    options.command === 'catalog'
      ? (() => {
          let content: Buffer;
          try {
            content = deps.readFile(options.file);
          } catch {
            throw new GuardError(
              `Arquivo do catálogo não encontrado: ${options.file}. Importação interrompida.`,
            );
          }
          const loaded = parseCatalog(content, expectation);
          log(
            `Catálogo: ${loaded.rows.length} exercícios · SHA-256 ${loaded.sha256} (confere)`,
          );
          return loaded;
        })()
      : null;

  const session = await deps.connect(connection);
  try {
    const before = await readState(session, deps.knownMigrations);
    if (before.info.database !== target.database) {
      throw new GuardError(
        `Conectado ao banco ${before.info.database}, mas o destino era ${target.database}.`,
      );
    }
    if (connection.sslRequired && !before.info.ssl) {
      throw new GuardError(
        'A conexão não está usando SSL. Comando interrompido.',
      );
    }
    log(
      `Servidor: ${before.info.version.split(',')[0]} · SSL ativo: ${before.info.ssl ? 'sim' : 'não'}`,
    );
    log(
      `Tabelas: ${before.tables.length ? before.tables.join(', ') : '(nenhuma)'}`,
    );

    if (options.command === 'migrate') {
      const { pending } = before.state;
      log(
        `Migrations pendentes: ${pending.length ? pending.join(', ') : 'nenhuma'}`,
      );
      if (pending.length === 0) {
        log('Nada a aplicar.');
        return;
      }
      if (!options.apply) {
        log('Simulação concluída: nenhuma alteração foi feita.');
        return;
      }
      await confirm(deps, target, `aplicar ${pending.length} migration(s)`);
      const executed = await session.runMigrations();
      const after = await readState(session, deps.knownMigrations);
      if (
        after.state.kind !== 'complete' ||
        executed.join() !== pending.join()
      ) {
        throw new GuardError(
          `Resultado inesperado: aplicadas [${executed.join(', ')}], pendentes [${after.state.pending.join(', ')}].`,
        );
      }
      log(`Migrations aplicadas: ${executed.join(', ')}.`);
      return;
    }

    // ---------- catálogo ----------
    if (before.state.kind !== 'complete') {
      throw new GuardError(
        'O esquema ainda não está completo: rode db:prod:migrate antes do catálogo.',
      );
    }
    const rows = catalog!.rows;
    const fileIds = new Set(rows.map((row) => row.id));
    const existing = await session.inspect(async (query) => {
      if (!before.tables.includes(CATALOG_TABLE)) return null;
      const columns = (
        (await query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1`,
          [CATALOG_TABLE],
        )) as { column_name: string }[]
      ).map((row) => row.column_name);
      const missing = CATALOG_COLUMNS.filter((c) => !columns.includes(c));
      if (missing.length > 0) {
        throw new GuardError(
          `A tabela exercises existe, mas faltam colunas (${missing.join(', ')}).`,
        );
      }
      return (
        (await query(`SELECT id FROM ${CATALOG_TABLE}`)) as { id: string }[]
      ).map((row) => row.id);
    });

    const foreign = (existing ?? []).filter((id) => !fileIds.has(id));
    if (foreign.length > 0) {
      throw new GuardError(
        `A tabela exercises tem ${foreign.length} exercício(s) fora do arquivo validado (ex.: ${foreign.slice(0, 3).join(', ')}). Estado inconsistente.`,
      );
    }
    const updates = existing?.length ?? 0;
    log(
      `Plano: ${rows.length - updates} a inserir, ${updates} a atualizar` +
        (existing === null ? ' (a tabela exercises será criada)' : '') +
        '. Caminhos das imagens mantidos como no arquivo.',
    );
    if (!options.apply) {
      log('Simulação concluída: nenhuma alteração foi feita.');
      return;
    }

    await confirm(deps, target, `importar ${rows.length} exercícios`);
    await session.write(async (query) => {
      await query(CREATE_CATALOG_TABLE);
      for (const [sql, params] of upsertStatements(rows)) {
        await query(sql, params);
      }
      const [{ count }] = (await query(
        `SELECT count(*)::int AS count FROM ${CATALOG_TABLE}`,
      )) as { count: number }[];
      if (count !== expectation.count) {
        // Lançar aqui desfaz a transação inteira: nada parcial fica gravado.
        throw new GuardError(
          `Depois da importação a tabela teria ${count} exercícios (esperado ${expectation.count}). Nada foi gravado.`,
        );
      }
    });
    const finalCount = await session.inspect(async (query) => {
      const [{ count }] = (await query(
        `SELECT count(*)::int AS count FROM ${CATALOG_TABLE}`,
      )) as { count: number }[];
      return count;
    });
    if (finalCount !== expectation.count) {
      throw new GuardError(
        `Contagem final ${finalCount}, esperado ${expectation.count}.`,
      );
    }
    log(`Catálogo importado: ${finalCount} exercícios.`);
  } finally {
    await session.close();
  }
}
