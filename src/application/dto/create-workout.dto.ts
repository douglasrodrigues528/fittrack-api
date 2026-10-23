import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class WorkoutSetDto {
  @ApiProperty({
    example: 40,
  })
  @IsNumber()
  @Min(0)
  @Max(1000)
  weight!: number;

  @ApiProperty({
    example: 12,
  })
  @IsInt()
  @Min(1)
  @Max(1000)
  reps!: number;
}

class WorkoutExerciseDto {
  @ApiProperty({
    example: 'Supino reto',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    example: 'Alternate_Hammer_Curl',
    description: 'ID opcional do exercicio no catalogo global.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  exerciseId?: string;

  @ApiProperty({
    example: [
      {
        weight: 40,
        reps: 12,
      },
      {
        weight: 45,
        reps: 10,
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Cada exercício precisa ter pelo menos uma série.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetDto)
  sets!: WorkoutSetDto[];
}

export class CreateWorkoutDto {
  @ApiProperty({
    example: 'Treino de Peito',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiProperty({
    example: 'Supino e crucifixo',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    required: false,
    example: [
      {
        name: 'Supino reto',
        sets: [
          {
            weight: 40,
            reps: 12,
          },
          {
            weight: 45,
            reps: 10,
          },
        ],
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseDto)
  exercises?: WorkoutExerciseDto[];

  @ApiProperty({
    required: false,
    example: [1, 4],
    description: 'Dias da semana do treino (0 = domingo … 6 = sábado).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];
}