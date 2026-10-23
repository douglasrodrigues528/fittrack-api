import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OnboardingService } from '../../../application/services/onboarding/onboarding.service';
import { UserEntity } from '../../../infra/database/entities/user.entity';
import { WorkoutSessionEntity } from '../../../infra/database/entities/workout-session.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';
import { OnboardingController } from '../../controllers/onboarding/onboarding.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, WorkoutEntity, WorkoutSessionEntity]),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
