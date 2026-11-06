import { parse } from 'pg-connection-string';

import {
  DatabaseConfigError,
  resolveConnection,
  stripSslParams,
  typeOrmConnectionOptions,
} from './connection-options';

const NEON =
  'postgresql://app_user:segredo@ep-exemplo-123.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('opções de conexão', () => {
  it('URL do Neon: valida o certificado e liga o channel binding', () => {
    const connection = resolveConnection({ DATABASE_URL: NEON });
    expect(connection.ssl).toEqual({ rejectUnauthorized: true });
    expect(connection.extra).toEqual({ enableChannelBinding: true });
    expect(connection.sslRequired).toBe(true);
    expect(connection.url).not.toMatch(/sslmode|channel_binding/);
  });

  it('a pg não recebe sslmode pela URL (não sobrescreve a validação do certificado)', () => {
    const { url } = resolveConnection({ DATABASE_URL: NEON });
    const parsed = parse(url as string);
    expect(parsed.ssl).toBeUndefined();
    expect(parsed.host).toBe('ep-exemplo-123.us-east-1.aws.neon.tech');
    expect(parsed.database).toBe('neondb');
  });

  it('DB_SSL=true sem sslmode na URL também exige SSL validado', () => {
    const connection = resolveConnection({
      DATABASE_URL: 'postgres://u:p@db.exemplo.test:5432/app',
      DB_SSL: 'true',
    });
    expect(connection.ssl).toEqual({ rejectUnauthorized: true });
    expect(connection.extra).toEqual({});
  });

  it('nunca aceita desligar a validação do certificado', () => {
    expect(() =>
      resolveConnection({
        DATABASE_URL: 'postgres://u:p@h/db?sslmode=no-verify',
      }),
    ).toThrow(DatabaseConfigError);
    expect(() =>
      resolveConnection({
        DATABASE_URL: 'postgres://u:p@h/db?sslmode=require&uselibpqcompat=true',
      }),
    ).toThrow(/uselibpqcompat/);
    expect(() =>
      resolveConnection({
        DATABASE_URL: 'postgres://u:p@h/db?sslmode=disable',
        DB_SSL: 'true',
      }),
    ).toThrow(/sslmode=disable/);
  });

  it('recusa parâmetros desconhecidos ou não suportados', () => {
    expect(() => stripSslParams('postgres://u:p@h/db?sslmode=talvez')).toThrow(
      /sslmode desconhecido/,
    );
    expect(() =>
      stripSslParams('postgres://u:p@h/db?sslrootcert=/tmp/ca.pem'),
    ).toThrow(/sslrootcert/);
    expect(() => stripSslParams('mysql://u:p@h/db')).toThrow(/postgres/);
    expect(() => resolveConnection({ DB_SSL: 'sim' })).toThrow(/DB_SSL/);
  });

  it('channel_binding=require sem SSL é recusado', () => {
    expect(() =>
      resolveConnection({
        DATABASE_URL: 'postgres://u:p@h/db?channel_binding=require',
      }),
    ).toThrow(/channel_binding=require exige SSL/);
  });

  it('desenvolvimento local (sem DB_SSL) continua sem SSL, por DB_HOST ou URL', () => {
    const byHost = resolveConnection({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'postgres',
      DB_PASSWORD: 'x',
      DB_NAME: 'fittrack',
    });
    expect(byHost.ssl).toBe(false);
    expect(typeOrmConnectionOptions(byHost)).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'x',
      database: 'fittrack',
      ssl: false,
      extra: {},
    });
    const byUrl = resolveConnection({
      DATABASE_URL: 'postgres://u:p@localhost:5432/fittrack_x_test',
    });
    expect(byUrl.ssl).toBe(false);
    expect(typeOrmConnectionOptions(byUrl)).toEqual({
      url: 'postgres://u:p@localhost:5432/fittrack_x_test',
      ssl: false,
      extra: {},
    });
  });
});
