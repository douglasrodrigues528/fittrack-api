import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DataSource, type QueryRunner } from 'typeorm';

import {
  typeOrmConnectionOptions,
  type ResolvedConnection,
} from '../connection-options';
import { KNOWN_MIGRATIONS, KNOWN_MIGRATION_NAMES } from './known-migrations';
import { MIGRATIONS_TABLE } from './migration-state';
import { runProdCommand, type DbSession, type Query } from './runner';
import { GuardError, devIdentityFromDotEnv } from './target';

/*
 * Entrada de `npm run db:prod:migrate` e `npm run db:prod:catalog` (depois de `npm run build`).
 * O ambiente é copiado ANTES de qualquer outra coisa e o `.env` nunca é carregado: o destino
 * vem só das variáveis deste terminal. O `.env` é lido apenas para recusar o banco local.
 */
const env = { ...process.env };

function readDotEnv(): string | null {
  try {
    return readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  } catch {
    return null;
  }
}

async function connect(connection: ResolvedConnection): Promise<DbSession> {
  const options = typeOrmConnectionOptions(connection);
  const dataSource = new DataSource({
    type: 'postgres',
    ...options,
    extra: { ...options.extra, max: 2, connectionTimeoutMillis: 20_000 },
    entities: [],
    migrations: KNOWN_MIGRATIONS,
    migrationsTableName: MIGRATIONS_TABLE,
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();

  const withRunner = async <T>(
    begin: string,
    fn: (query: Query) => Promise<T>,
  ): Promise<T> => {
    const runner: QueryRunner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(begin);
      const result = await fn(
        (sql, params) => runner.query(sql, params) as Promise<any[]>,
      );
      await runner.query('COMMIT');
      return result;
    } catch (error) {
      await runner.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await runner.release();
    }
  };

  return {
    inspect: (fn) => withRunner('BEGIN TRANSACTION READ ONLY', fn),
    write: (fn) => withRunner('BEGIN', fn),
    async runMigrations() {
      const executed = await dataSource.runMigrations({ transaction: 'all' });
      return executed.map((migration) => migration.name);
    },
    close: () => dataSource.destroy(),
  };
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } catch {
    return '';
  } finally {
    rl.close();
  }
}

runProdCommand({
  argv: process.argv.slice(2),
  env,
  devIdentity: devIdentityFromDotEnv(readDotEnv()),
  knownMigrations: KNOWN_MIGRATION_NAMES,
  readFile: (path) => readFileSync(resolve(process.cwd(), path)),
  connect,
  prompt,
  log: (line) => console.log(line),
})
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      error instanceof GuardError ? `ABORTADO: ${message}` : `ERRO: ${message}`,
    );
    process.exitCode = 1;
  });
