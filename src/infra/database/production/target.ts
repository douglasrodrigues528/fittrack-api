/**
 * Quem é o banco de destino de um comando de produção e se ele pode ser usado.
 * Nada aqui conecta ao banco: são só regras sobre a URL e o ambiente.
 */

export class GuardError extends Error {}

export interface DbTarget {
  host: string;
  port: number;
  database: string;
  user: string;
}

/** Identidade do banco de desenvolvimento (lida do `.env` só para ser RECUSADA). */
export interface DevIdentity {
  host: string | null;
  database: string | null;
}

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
]);

export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return LOCAL_HOSTS.has(h) || h.endsWith('.localhost') || h.startsWith('127.');
}

/** Host, porta, banco e usuário da URL. A senha nunca sai daqui. */
export function describeTarget(url: string): DbTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GuardError('DATABASE_URL não é uma URL válida.');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname) throw new GuardError('DATABASE_URL sem host.');
  if (!database) throw new GuardError('DATABASE_URL sem nome de banco.');
  if (!parsed.username) throw new GuardError('DATABASE_URL sem usuário.');
  return {
    host: parsed.hostname.toLowerCase(),
    port: Number(parsed.port || 5432),
    database,
    user: decodeURIComponent(parsed.username),
  };
}

/** Linha para o terminal: host, porta, banco e usuário, sem senha. */
export function formatTarget(target: DbTarget): string {
  return `host=${target.host} porta=${target.port} banco=${target.database} usuário=${target.user}`;
}

/** Lê do texto de um `.env` apenas o host e o banco de desenvolvimento. */
export function devIdentityFromDotEnv(text: string | null): DevIdentity {
  const values: Record<string, string> = {};
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  if (values.DATABASE_URL) {
    try {
      const target = describeTarget(values.DATABASE_URL);
      return { host: target.host, database: target.database };
    } catch {
      /* URL inválida no .env: cai para DB_HOST/DB_NAME */
    }
  }
  return {
    host: values.DB_HOST ? values.DB_HOST.toLowerCase() : null,
    database: values.DB_NAME ?? null,
  };
}

/**
 * Regras do destino:
 * - nunca o banco de desenvolvimento (mesmo host e banco do `.env`);
 * - host local ou o host do `.env` só no ensaio, com `--allow-local-test`
 *   e banco terminado em `_test`;
 * - `--allow-local-test` não vale para destino remoto.
 */
export function assertTargetAllowed(
  target: DbTarget,
  dev: DevIdentity,
  allowLocalTest: boolean,
) {
  if (
    dev.database !== null &&
    target.database === dev.database &&
    (dev.host === null || dev.host === target.host || isLocalHost(target.host))
  ) {
    throw new GuardError(
      `O destino é o banco de desenvolvimento do .env (${target.database}). Comando recusado.`,
    );
  }
  const sameHostAsDev = dev.host !== null && dev.host === target.host;
  const local = isLocalHost(target.host) || sameHostAsDev;
  if (local) {
    if (!allowLocalTest) {
      throw new GuardError(
        `Host local ou do banco de desenvolvimento (${target.host}). Para o ensaio, use --allow-local-test com um banco terminado em _test.`,
      );
    }
    if (!target.database.endsWith('_test')) {
      throw new GuardError(
        `No ensaio local o banco precisa terminar em _test (recebido: ${target.database}).`,
      );
    }
    return;
  }
  if (allowLocalTest) {
    throw new GuardError(
      '--allow-local-test só vale para banco local de ensaio, não para um host remoto.',
    );
  }
}

/** CONFIRM_DB_HOST precisa ser exatamente o host da conexão. */
export function assertHostConfirmed(
  target: DbTarget,
  confirmHost: string | undefined,
) {
  if (!confirmHost) {
    throw new GuardError(
      `Defina CONFIRM_DB_HOST com o host de destino (${target.host}) para confirmar.`,
    );
  }
  if (confirmHost.trim().toLowerCase() !== target.host) {
    throw new GuardError(
      `CONFIRM_DB_HOST (${confirmHost.trim()}) não confere com o host da DATABASE_URL (${target.host}).`,
    );
  }
}
