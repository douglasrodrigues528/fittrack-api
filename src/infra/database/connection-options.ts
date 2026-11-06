/**
 * Opções de conexão com o PostgreSQL, compartilhadas pela API, pela CLI de migrations e
 * pelos comandos de produção (`db:prod:*`). Não lê `.env` nem tem efeitos colaterais.
 *
 * SSL: com SSL ligado, o certificado do servidor é SEMPRE validado (`rejectUnauthorized`).
 * A biblioteca `pg` aplica os parâmetros SSL da URL por cima destas opções, e alguns deles
 * desligam a validação (`sslmode=no-verify`, `uselibpqcompat=true`). Por isso a URL é
 * normalizada: os parâmetros SSL saem dela e viram opções explícitas daqui.
 */

export interface DatabaseEnv {
  DATABASE_URL?: string;
  DB_HOST?: string;
  DB_PORT?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
  DB_NAME?: string;
  DB_SSL?: string;
}

export interface ResolvedConnection {
  /** URL sem parâmetros SSL (só quando DATABASE_URL foi usada). */
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl: false | { rejectUnauthorized: true };
  /** Opções repassadas ao driver `pg` (ex.: channel binding do SCRAM). */
  extra: { enableChannelBinding?: true };
  /** Resumo, sem segredos, para mensagens. */
  sslRequired: boolean;
  channelBinding: boolean;
}

export class DatabaseConfigError extends Error {}

const SSL_REQUIRED_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const SSL_OFF_MODES = new Set(['disable', 'allow', 'prefer']);
/** Parâmetros SSL que a `pg` interpretaria por conta própria. */
const SSL_PARAMS = [
  'sslmode',
  'ssl',
  'channel_binding',
  'uselibpqcompat',
  'sslrootcert',
  'sslcert',
  'sslkey',
];

interface UrlSslSettings {
  url: string;
  sslMode: string | null;
  channelBinding: string | null;
}

/** Tira da URL os parâmetros SSL, recusando os que enfraqueceriam a validação. */
export function stripSslParams(rawUrl: string): UrlSslSettings {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DatabaseConfigError('DATABASE_URL não é uma URL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new DatabaseConfigError(
      'DATABASE_URL precisa começar com postgres:// ou postgresql://.',
    );
  }
  const params = parsed.searchParams;
  const sslMode = params.get('sslmode');
  const channelBinding = params.get('channel_binding');

  if (sslMode === 'no-verify') {
    throw new DatabaseConfigError(
      'sslmode=no-verify não é aceito: o certificado do banco precisa ser validado.',
    );
  }
  if (params.has('uselibpqcompat')) {
    throw new DatabaseConfigError(
      'uselibpqcompat não é aceito: com ele, sslmode=require deixa de validar o certificado.',
    );
  }
  for (const name of ['sslrootcert', 'sslcert', 'sslkey']) {
    if (params.has(name)) {
      throw new DatabaseConfigError(
        `${name} na DATABASE_URL não é suportado por esta configuração.`,
      );
    }
  }
  if (
    sslMode !== null &&
    !SSL_REQUIRED_MODES.has(sslMode) &&
    !SSL_OFF_MODES.has(sslMode)
  ) {
    throw new DatabaseConfigError(`sslmode desconhecido: ${sslMode}.`);
  }
  if (
    channelBinding !== null &&
    !['require', 'prefer', 'disable'].includes(channelBinding)
  ) {
    throw new DatabaseConfigError(
      `channel_binding desconhecido: ${channelBinding}.`,
    );
  }
  for (const name of SSL_PARAMS) params.delete(name);
  return { url: parsed.toString(), sslMode, channelBinding };
}

/** Monta as opções de conexão a partir das variáveis de ambiente informadas. */
export function resolveConnection(env: DatabaseEnv): ResolvedConnection {
  const dbSsl = env.DB_SSL?.trim().toLowerCase();
  if (
    dbSsl !== undefined &&
    dbSsl !== '' &&
    !['true', 'false'].includes(dbSsl)
  ) {
    throw new DatabaseConfigError('DB_SSL deve ser "true" ou "false".');
  }
  const sslFlag = dbSsl === 'true';

  if (env.DATABASE_URL) {
    const { url, sslMode, channelBinding } = stripSslParams(env.DATABASE_URL);
    const urlWantsSsl = sslMode !== null && SSL_REQUIRED_MODES.has(sslMode);
    if (sslFlag && sslMode === 'disable') {
      throw new DatabaseConfigError(
        'DB_SSL=true, mas a DATABASE_URL pede sslmode=disable.',
      );
    }
    const sslRequired = sslFlag || urlWantsSsl;
    if (channelBinding === 'require' && !sslRequired) {
      throw new DatabaseConfigError(
        'channel_binding=require exige SSL (defina DB_SSL=true ou sslmode=require).',
      );
    }
    const channel = sslRequired && channelBinding !== 'disable';
    return {
      url,
      ssl: sslRequired ? { rejectUnauthorized: true } : false,
      extra:
        channel && channelBinding !== null
          ? { enableChannelBinding: true }
          : {},
      sslRequired,
      channelBinding: channel && channelBinding !== null,
    };
  }

  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: sslFlag ? { rejectUnauthorized: true } : false,
    extra: {},
    sslRequired: sslFlag,
    channelBinding: false,
  };
}

/** Só as opções de conexão do TypeORM (sem os campos de resumo). */
export function typeOrmConnectionOptions(connection: ResolvedConnection) {
  const { url, host, port, username, password, database, ssl, extra } =
    connection;
  return url
    ? { url, ssl, extra }
    : { host, port, username, password, database, ssl, extra };
}
