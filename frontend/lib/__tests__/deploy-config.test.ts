import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import { DEV_API_URL, normalizeApiUrl, requireApiUrlForBuild } from '../api-url';
import { SECURITY_HEADERS } from '../security-headers';
import nextConfig from '../../next.config';

/** Roda o next.config com um ambiente controlado e restaura o original. */
function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

describe('endereço da API no build', () => {
  it('sem NEXT_PUBLIC_API_URL o build de produção falha com mensagem clara', () => {
    assert.throws(() => requireApiUrlForBuild({}), /NEXT_PUBLIC_API_URL não está definida/);
    assert.throws(() => requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: '  ' }), /não está definida/);
  });

  it('com a variável, o build segue (e a barra final sai)', () => {
    assert.equal(
      requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: 'https://fittrack-api.onrender.com/' }),
      'https://fittrack-api.onrender.com',
    );
    // Build local continua possível, desde que explícito.
    assert.equal(requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: 'http://localhost:3000' }), 'http://localhost:3000');
  });

  it('URL inválida ou de outro protocolo: falha', () => {
    assert.throws(() => requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: 'api.exemplo' }), /URL válida/);
    assert.throws(() => requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: 'ftp://api.exemplo' }), /http ou https/);
  });

  it('produção da Vercel exige HTTPS e host público', () => {
    assert.throws(
      () => requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: 'http://api.exemplo', VERCEL_ENV: 'production' }),
      /HTTPS/,
    );
    assert.throws(
      () => requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: 'https://localhost:3000', VERCEL_ENV: 'production' }),
      /não pode apontar/,
    );
    assert.equal(
      requireApiUrlForBuild({ NEXT_PUBLIC_API_URL: 'https://api.exemplo', VERCEL_ENV: 'production' }),
      'https://api.exemplo',
    );
  });

  it('desenvolvimento: sem a variável usa localhost (só no next dev)', () => {
    assert.equal(normalizeApiUrl(undefined), undefined);
    assert.equal(normalizeApiUrl('https://api.exemplo///'), 'https://api.exemplo');
    assert.equal(DEV_API_URL, 'http://localhost:3000');
  });
});

describe('next.config', () => {
  it('build de produção sem a variável: falha; com ela: passa', () => {
    withEnv({ NEXT_PUBLIC_API_URL: undefined, VERCEL_ENV: undefined }, () => {
      assert.throws(() => nextConfig(PHASE_PRODUCTION_BUILD), /NEXT_PUBLIC_API_URL/);
    });
    withEnv({ NEXT_PUBLIC_API_URL: 'https://api.exemplo', VERCEL_ENV: undefined }, () => {
      assert.equal(nextConfig(PHASE_PRODUCTION_BUILD).devIndicators, false);
    });
  });

  it('next dev continua funcionando sem a variável', () => {
    withEnv({ NEXT_PUBLIC_API_URL: undefined }, () => {
      assert.doesNotThrow(() => nextConfig(PHASE_DEVELOPMENT_SERVER));
    });
  });

  it('aplica os cabeçalhos de segurança a todas as páginas', async () => {
    const config = withEnv({ NEXT_PUBLIC_API_URL: 'https://api.exemplo' }, () => nextConfig(PHASE_PRODUCTION_BUILD));
    const rules = await config.headers!();
    assert.deepEqual(rules, [{ source: '/:path*', headers: SECURITY_HEADERS }]);
    const byName = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    assert.deepEqual(byName, {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
    assert.equal(config.poweredByHeader, false);
    // Sem CSP nesta etapa (exige análise das imagens e fontes).
    assert.equal('Content-Security-Policy' in byName, false);
  });
});
