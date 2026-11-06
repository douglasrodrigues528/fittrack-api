/** Endereço da API em desenvolvimento (`next dev`), quando NEXT_PUBLIC_API_URL não está definida. */
export const DEV_API_URL = 'http://localhost:3000';

/** Tira espaços e barras finais: `https://api.exemplo/` vira `https://api.exemplo`. */
export function normalizeApiUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim().replace(/\/+$/, '');
  return value ? value : undefined;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i;

/**
 * Conferida no `next build`: o endereço da API entra no código nesse momento, então um build
 * sem ele apontaria em silêncio para localhost. Na produção da Vercel exige HTTPS e host público.
 */
export function requireApiUrlForBuild(env: Record<string, string | undefined>): string {
  const value = normalizeApiUrl(env.NEXT_PUBLIC_API_URL);
  if (!value) {
    throw new Error(
      'NEXT_PUBLIC_API_URL não está definida. O build de produção precisa do endereço público da API ' +
        '(ex.: https://fittrack-api.onrender.com). Na Vercel: Settings → Environment Variables. ' +
        'Para um build local: NEXT_PUBLIC_API_URL=http://localhost:3000 npm run build.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL não é uma URL válida: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`NEXT_PUBLIC_API_URL precisa usar http ou https: ${value}`);
  }
  if (env.VERCEL_ENV === 'production') {
    if (url.protocol !== 'https:') {
      throw new Error(`Em produção NEXT_PUBLIC_API_URL precisa usar HTTPS: ${value}`);
    }
    if (LOCAL_HOST.test(url.hostname)) {
      throw new Error(`Em produção NEXT_PUBLIC_API_URL não pode apontar para ${url.hostname}.`);
    }
  }
  return value;
}
