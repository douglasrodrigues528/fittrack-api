import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

/**
 * Intervalo [from, to) em instantes ISO. O app calcula os limites no fuso local do usuário
 * (ex.: meia-noite do dia 1º até a meia-noite do 1º dia do mês seguinte), então o servidor
 * não precisa saber o fuso e nenhum treino muda de dia.
 */
export class CalendarQueryDto {
  @ApiProperty({ example: '2026-10-01T03:00:00.000Z' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-11-01T03:00:00.000Z' })
  @IsISO8601({ strict: true })
  to!: string;
}
