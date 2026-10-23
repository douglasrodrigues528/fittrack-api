import type { ConfigService } from '@nestjs/config';

const DEV_FALLBACK_JWT_SECRET = 'jwt-secret-key';

export function isProduction(config: ConfigService): boolean {
  return config.get<string>('NODE_ENV') === 'production';
}

/**
 * Segredo do JWT vem SEMPRE do ambiente. Em desenvolvimento ainda aceita o valor
 * antigo (com aviso) para não invalidar o seu ambiente local; em produção a
 * aplicação se recusa a subir sem um segredo próprio e forte.
 */
export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');

  if (isProduction(config)) {
    if (!secret || secret === DEV_FALLBACK_JWT_SECRET || secret.length < 32) {
      throw new Error(
        'JWT_SECRET ausente ou fraco. Em produção defina um segredo aleatório com pelo menos 32 caracteres.',
      );
    }
    return secret;
  }

  if (!secret) {
    console.warn(
      '[AVISO] JWT_SECRET não definido; usando o valor padrão de desenvolvimento. Defina JWT_SECRET no .env.',
    );
    return DEV_FALLBACK_JWT_SECRET;
  }
  return secret;
}

/** Lista de origens permitidas no CORS, separadas por vírgula em CORS_ORIGINS. */
export function getCorsOrigins(config: ConfigService): string[] {
  const raw = config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3001';
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
