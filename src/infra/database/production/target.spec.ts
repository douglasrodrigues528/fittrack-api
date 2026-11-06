import {
  GuardError,
  assertHostConfirmed,
  assertTargetAllowed,
  describeTarget,
  devIdentityFromDotEnv,
  formatTarget,
} from './target';

const NEON =
  'postgresql://app_user:s3gr3d0@ep-x.us-east-1.aws.neon.tech/neondb';
const DEV = { host: 'localhost', database: 'fittrack_exercises_test' };

describe('destino dos comandos de produção', () => {
  it('descreve host, porta, banco e usuário sem a senha', () => {
    const target = describeTarget(NEON);
    expect(target).toEqual({
      host: 'ep-x.us-east-1.aws.neon.tech',
      port: 5432,
      database: 'neondb',
      user: 'app_user',
    });
    expect(formatTarget(target)).not.toContain('s3gr3d0');
  });

  it('remoto, sem a opção de ensaio: permitido', () => {
    expect(() =>
      assertTargetAllowed(describeTarget(NEON), DEV, false),
    ).not.toThrow();
  });

  it('host local sem --allow-local-test: recusado', () => {
    const target = describeTarget(
      'postgres://u:p@localhost:5432/qualquer_test',
    );
    expect(() => assertTargetAllowed(target, DEV, false)).toThrow(/Host local/);
    const loopback = describeTarget('postgres://u:p@127.0.0.1/qualquer_test');
    expect(() => assertTargetAllowed(loopback, DEV, false)).toThrow(GuardError);
  });

  it('banco de desenvolvimento do .env: recusado, mesmo com --allow-local-test e nome _test', () => {
    // O banco de desenvolvimento deste projeto termina em _test: a regra do nome não basta.
    const target = describeTarget(
      'postgres://u:p@localhost:5432/fittrack_exercises_test',
    );
    expect(() => assertTargetAllowed(target, DEV, true)).toThrow(
      /banco de desenvolvimento/,
    );
  });

  it('ensaio local: só com --allow-local-test e banco terminado em _test', () => {
    const ok = describeTarget('postgres://u:p@localhost/fittrack_deploy_test');
    expect(() => assertTargetAllowed(ok, DEV, true)).not.toThrow();
    const wrongName = describeTarget('postgres://u:p@localhost/fittrack');
    expect(() => assertTargetAllowed(wrongName, DEV, true)).toThrow(/_test/);
  });

  it('host do banco de desenvolvimento (mesmo remoto) conta como local', () => {
    const dev = { host: 'db.interno.exemplo', database: 'app' };
    const target = describeTarget('postgres://u:p@db.interno.exemplo/outro');
    expect(() => assertTargetAllowed(target, dev, false)).toThrow(
      /banco de desenvolvimento/,
    );
  });

  it('--allow-local-test não vale para host remoto', () => {
    expect(() => assertTargetAllowed(describeTarget(NEON), DEV, true)).toThrow(
      /só vale para banco local/,
    );
  });

  it('CONFIRM_DB_HOST ausente ou divergente: recusado', () => {
    const target = describeTarget(NEON);
    expect(() => assertHostConfirmed(target, undefined)).toThrow(
      /Defina CONFIRM_DB_HOST/,
    );
    expect(() =>
      assertHostConfirmed(target, 'ep-outro.us-east-1.aws.neon.tech'),
    ).toThrow(/não confere/);
    expect(() =>
      assertHostConfirmed(target, ' EP-X.us-east-1.aws.neon.tech '),
    ).not.toThrow();
  });

  it('lê do .env só a identidade do banco de desenvolvimento', () => {
    expect(
      devIdentityFromDotEnv(
        'DB_HOST=LocalHost\nDB_PASSWORD=x\nDB_NAME="fittrack"\n',
      ),
    ).toEqual({ host: 'localhost', database: 'fittrack' });
    expect(
      devIdentityFromDotEnv(
        'DATABASE_URL=postgres://u:p@db.dev.exemplo/dev_db',
      ),
    ).toEqual({ host: 'db.dev.exemplo', database: 'dev_db' });
    expect(devIdentityFromDotEnv(null)).toEqual({ host: null, database: null });
  });
});
