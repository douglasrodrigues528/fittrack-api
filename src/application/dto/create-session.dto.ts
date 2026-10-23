import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

import { SET_TYPES, type SetType } from '../../infra/database/entities/session-set.entity';

export class SessionSetDto {
  @ApiProperty({ enum: SET_TYPES, example: 'normal' })
  @IsIn(SET_TYPES)
  type!: SetType;

  @ApiProperty({ example: 40 })
  @IsNumber()
  @Min(0)
  @Max(1000)
  weight!: number;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  @Max(1000)
  reps!: number;
}

export class SessionExerciseDto {
  @ApiProperty({ required: false, example: 'Barbell_Bench_Press_-_Medium_Grip' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  exerciseId?: string;

  @ApiProperty({ example: 'Supino reto' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ type: [SessionSetDto], description: 'Somente séries concluídas.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SessionSetDto)
  sets!: SessionSetDto[];
}

export class CreateSessionDto {
  @ApiProperty({ required: false, description: 'Rotina de origem (opcional).' })
  @IsOptional()
  @IsUUID()
  workoutId?: string;

  @ApiProperty({ example: 'Treino A - Peito' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiProperty({ example: '2026-10-20T20:00:00.000Z' })
  @IsDateString()
  startedAt!: string;

  @ApiProperty({ example: '2026-10-20T20:55:00.000Z' })
  @IsDateString()
  finishedAt!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [SessionExerciseDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SessionExerciseDto)
  exercises!: SessionExerciseDto[];
}

export class PreviousExerciseRefDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  exerciseId?: string;

  @ApiProperty({ example: 'Supino reto' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

export class PreviousSetsQueryDto {
  @ApiProperty({ type: [PreviousExerciseRefDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PreviousExerciseRefDto)
  exercises!: PreviousExerciseRefDto[];
}
