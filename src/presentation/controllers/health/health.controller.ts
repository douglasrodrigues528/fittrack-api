import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

export const HEALTH_RESPONSE = { status: 'ok' } as const;

/**
 * Verificação de vida usada pela hospedagem (Render). Responde sem autenticação e
 * NÃO consulta o banco: chamadas frequentes não podem manter o PostgreSQL (Neon)
 * acordado nem consumir a cota gratuita dele.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  check() {
    return HEALTH_RESPONSE;
  }
}
