import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { DataSource, Repository } from 'typeorm';

import { CreateWorkoutDto } from '../../dto/create-workout.dto';
import { UpdateWorkoutDto } from '../../dto/update-workout.dto';
import { UserEntity } from '../../../infra/database/entities/user.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';
import { MAX_PLANNED_WORKOUTS, toQuota } from './workout-limits';

export const WORKOUT_LIMIT_REACHED = 'WORKOUT_LIMIT_REACHED';

/** Ordena e remove repetições dos dias da semana. */
function normalizeWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays)].sort((a, b) => a - b);
}

@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(WorkoutEntity)
    private readonly workoutsRepository: Repository<WorkoutEntity>,

    private readonly dataSource: DataSource,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async findAllByUser(userId: string) {
  const cacheKey = `workouts:${userId}`;

  const cachedWorkouts =
    await this.cacheManager.get<WorkoutEntity[]>(cacheKey);

  if (cachedWorkouts !== undefined && cachedWorkouts !== null) {
    console.log('Buscando treinos do cache');
    return cachedWorkouts;
  }

  console.log('Buscando treinos do banco');

  const workouts = await this.workoutsRepository.find({
    where: { userId },
    order: { createdAt: 'DESC' },
  });

  await this.cacheManager.set(cacheKey, workouts, 600); // Cache

  return workouts;
}

  /** Vagas de treinos planejados do usuário (sempre contadas no banco, nunca no cache). */
  async getQuota(userId: string) {
    return toQuota(await this.workoutsRepository.count({ where: { userId } }));
  }

  async findById(id: string, userId: string) {
    const workout = await this.workoutsRepository.findOne({
      where: {
        id,
        userId,
      },
    });

    if (!workout) {
      throw new NotFoundException('Treino não encontrado');
    }

    return workout;
  }

  /**
   * Cria um treino planejado respeitando o limite por usuário.
   * A linha do usuário é travada (SELECT ... FOR UPDATE) durante a transação, então
   * requisições simultâneas do mesmo usuário contam e inserem uma de cada vez:
   * nunca passam de MAX_PLANNED_WORKOUTS.
   */
  async create(data: CreateWorkoutDto, userId: string) {
    const savedWorkout = await this.dataSource.transaction(async (manager) => {
      const owner = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .select('user.id')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!owner) {
        throw new UnauthorizedException('Usuário não encontrado');
      }

      const used = await manager.getRepository(WorkoutEntity).count({ where: { userId } });

      if (used >= MAX_PLANNED_WORKOUTS) {
        throw new ConflictException({
          statusCode: 409,
          code: WORKOUT_LIMIT_REACHED,
          message:
            `Você já tem ${MAX_PLANNED_WORKOUTS} treinos planejados, o máximo permitido. ` +
            'Edite um treino existente ou exclua um que não usa mais para liberar uma vaga. ' +
            'Treinos livres e o histórico não contam neste limite.',
          quota: toQuota(used),
        });
      }

      const repository = manager.getRepository(WorkoutEntity);
      const workout = repository.create({
        title: data.title,
        description: data.description,
        exercises: data.exercises ?? [],
        weekdays: normalizeWeekdays(data.weekdays ?? []),
        userId,
      });

      return repository.save(workout);
    });

    await this.cacheManager.del(`workouts:${userId}`);

    return savedWorkout;
  }

  async update(
    id: string,
    data: UpdateWorkoutDto,
    userId: string,
  ) {
    const workout = await this.findById(id, userId);

    // Só estes campos podem mudar; id, userId e createdAt nunca vêm do cliente.
    // Editar não ocupa uma nova vaga: o mesmo registro é atualizado.
    if (data.title !== undefined) workout.title = data.title;
    if (data.description !== undefined) workout.description = data.description;
    if (data.exercises !== undefined) workout.exercises = data.exercises;
    if (data.weekdays !== undefined) workout.weekdays = normalizeWeekdays(data.weekdays);

    const updatedWorkout = await this.workoutsRepository.save(workout);

    await this.cacheManager.del(`workouts:${userId}`);

    return updatedWorkout;
  }

  async delete(id: string, userId: string) {
    const workout = await this.findById(id, userId);

    // A vaga só é liberada quando a exclusão é confirmada pelo banco.
    // O histórico de sessões permanece (workout_sessions.workoutId vira NULL).
    await this.workoutsRepository.remove(workout);

    await this.cacheManager.del(`workouts:${userId}`);

    return {
      message: 'Treino removido com sucesso',
    };
  }
}
