import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SessionsService } from '../../../application/services/sessions/sessions.service';
import { SessionSetEntity } from '../../../infra/database/entities/session-set.entity';
import { WorkoutSessionEntity } from '../../../infra/database/entities/workout-session.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';
import { SessionsController } from '../../controllers/sessions/sessions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkoutSessionEntity, SessionSetEntity, WorkoutEntity]),
  ],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
