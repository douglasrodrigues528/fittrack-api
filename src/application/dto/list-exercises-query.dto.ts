import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListExercisesQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  muscle?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(120)
  equipment?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  level?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
