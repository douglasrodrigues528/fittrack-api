import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { OnboardingChoice } from '../../dto/complete-onboarding.dto';
import { UserEntity } from '../../../infra/database/entities/user.entity';
import { WorkoutSessionEntity } from '../../../infra/database/entities/workout-session.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';
import { resolveOrigin } from '../sessions/session-view';
import { toQuota } from '../workouts/workout-limits';

/**
 * Estado da jornada inicial, calculado a partir dos dados do usuário no banco
 * (não depende do navegador). Quem já tem treinos ou sessões não volta a ver as boas-vindas.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,

    @InjectRepository(WorkoutEntity)
    private readonly workoutsRepository: Repository<WorkoutEntity>,

    @InjectRepository(WorkoutSessionEntity)
    private readonly sessionsRepository: Repository<WorkoutSessionEntity>,
  ) {}

  async getState(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const [plannedCount, completedSessions, active] = await Promise.all([
      this.workoutsRepository.count({ where: { userId } }),
      this.sessionsRepository.count({ where: { userId, status: 'completed' } }),
      this.sessionsRepository.findOne({
        where: { userId, status: 'in_progress' },
      }),
    ]);

    const onboardingCompleted =
      user.onboardingCompletedAt !== null ||
      plannedCount > 0 ||
      completedSessions > 0 ||
      active !== null;

    return {
      onboardingCompleted,
      choice: user.onboardingChoice,
      plannedWorkouts: toQuota(plannedCount),
      completedSessions,
      activeSession: active
        ? {
            id: active.id,
            title: active.title,
            origin: resolveOrigin(active),
            workoutId: active.workoutId,
            startedAt: active.startedAt,
          }
        : null,
    };
  }

  /** Registra a primeira escolha (só a primeira; chamadas repetidas não sobrescrevem). */
  async complete(userId: string, choice: OnboardingChoice) {
    await this.usersRepository.update(
      { id: userId, onboardingCompletedAt: IsNull() },
      { onboardingCompletedAt: new Date(), onboardingChoice: choice },
    );
    return this.getState(userId);
  }
}
