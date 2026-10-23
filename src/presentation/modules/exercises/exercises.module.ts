import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExerciseEntity } from '../../../infra/database/entities/exercise.entity';
import { ExercisesService } from '../../../application/services/exercises/exercises.service';
import { ExercisesController } from '../../controllers/exercises/exercises.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExerciseEntity])],
  controllers: [ExercisesController],
  providers: [ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
