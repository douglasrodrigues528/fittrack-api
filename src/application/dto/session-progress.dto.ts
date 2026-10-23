import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  SET_TYPES,
  type SetType,
} from '../../infra/database/entities/session-set.entity';
import { SessionExerciseDto } from './create-session.dto';

/**
 * Série na tela do treino em andamento. Peso e repetições são o texto digitado
 * (podem estar vazios); `done` indica se a série já foi efetivamente realizada.
 */
export class ProgressSetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  uid!: string;

  @IsIn(SET_TYPES)
  type!: SetType;

  @IsString()
  @MaxLength(12)
  weight!: string;

  @IsString()
  @MaxLength(12)
  reps!: string;

  @IsBoolean()
  done!: boolean;
}

export class ProgressPreviousSetDto {
  @IsString()
  @MaxLength(16)
  type!: string;

  @IsNumber()
  @Min(0)
  @Max(1000)
  weight!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  reps!: number;
}

export class ProgressExerciseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  uid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  exerciseId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProgressSetDto)
  sets!: ProgressSetDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProgressPreviousSetDto)
  previous?: ProgressPreviousSetDto[];
}

export class SessionProgressDto {
  @ApiProperty({ example: 'Treino livre' })
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiProperty({ example: '' })
  @IsString()
  @MaxLength(2000)
  notes!: string;

  @ApiProperty({ example: 90 })
  @IsInt()
  @Min(10)
  @Max(600)
  restSeconds!: number;

  @ApiProperty({ type: [ProgressExerciseDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProgressExerciseDto)
  exercises!: ProgressExerciseDto[];
}

export class StartSessionDto {
  @ApiProperty({
    required: false,
    description:
      'Treino planejado de origem. Sem ele, a sessão é um treino livre.',
  })
  @IsOptional()
  @IsUUID()
  workoutId?: string;

  @ApiProperty({
    required: false,
    description:
      'Início real, quando a sessão começou sem conexão. Padrão: agora.',
  })
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @ApiProperty({ type: SessionProgressDto })
  @ValidateNested()
  @Type(() => SessionProgressDto)
  progress!: SessionProgressDto;
}

export class UpdateProgressDto {
  @ApiProperty({ type: SessionProgressDto })
  @ValidateNested()
  @Type(() => SessionProgressDto)
  progress!: SessionProgressDto;
}

export class FinishSessionDto {
  @ApiProperty({ example: 'Treino livre' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiProperty({
    required: false,
    description: 'Momento em que o usuário finalizou. Padrão: agora.',
  })
  @IsOptional()
  @IsDateString()
  finishedAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({
    type: [SessionExerciseDto],
    description: 'Somente séries realizadas.',
  })
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Conclua pelo menos uma série antes de finalizar o treino.',
  })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SessionExerciseDto)
  exercises!: SessionExerciseDto[];
}
