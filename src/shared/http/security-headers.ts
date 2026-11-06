import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Cabeçalhos de segurança de todas as respostas da API (JSON).
 * CSP fica de fora por enquanto: exige análise com o Swagger e os recursos atuais.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function securityHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  next();
}

/** Aplica os cabeçalhos e deixa de anunciar o framework (`X-Powered-By`). */
export function applySecurityHeaders(app: NestExpressApplication) {
  app.disable('x-powered-by');
  app.use(securityHeaders);
}
