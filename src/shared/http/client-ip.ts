import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { isProduction } from '../config/app-config';

/**
 * IP do cliente para os limites por IP (login e cadastro). Em produção atrás de proxy,
 * sem TRUST_PROXY todos os clientes teriam o IP do proxy (um bloqueio pararia o site
 * inteiro): nesse caso devolve null e o limite por IP fica desligado.
 */
export function clientIp(
  request: Request,
  configService: ConfigService,
): string | null {
  const trustsProxy = Boolean(configService.get<string>('TRUST_PROXY'));
  if (isProduction(configService) && !trustsProxy) return null;
  return request.ip ?? null;
}
