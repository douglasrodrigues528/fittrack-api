import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserEntity } from '../../../infra/database/entities/user.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';
import { WorkoutsController } from '../../controllers/workouts/workouts.controller';
import { WorkoutsService } from '../../../application/services/workouts/workouts.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkoutEntity, UserEntity])],
  controllers: [WorkoutsController],
  providers: [WorkoutsService],
})
export class WorkoutsModule {}