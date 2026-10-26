import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Quantas sessões (as mais recentes com o exercício) entram no gráfico e no histórico. */
export class ExerciseProgressQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 60;
}
