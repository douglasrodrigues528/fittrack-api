import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';

import { CreateWorkoutDto } from '../../dto/create-workout.dto';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';

@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(WorkoutEntity)
    private readonly workoutsRepository: Repository<WorkoutEntity>,

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
  });

  await this.cacheManager.set(cacheKey, workouts, 600); // Cache 

  return workouts;
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

  async create(data: CreateWorkoutDto, userId: string) {
    const workout = this.workoutsRepository.create({
      ...data,
      userId,
    });

    const savedWorkout = await this.workoutsRepository.save(workout);

    await this.cacheManager.del(`workouts:${userId}`);

    return savedWorkout;
  }

  async update(
    id: string,
    data: Partial<CreateWorkoutDto>,
    userId: string,
  ) {
    const workout = await this.findById(id, userId);

    Object.assign(workout, data);

    const updatedWorkout = await this.workoutsRepository.save(workout);

    await this.cacheManager.del(`workouts:${userId}`);

    return updatedWorkout;
  }

  async delete(id: string, userId: string) {
    const workout = await this.findById(id, userId);

    await this.workoutsRepository.remove(workout);

    await this.cacheManager.del(`workouts:${userId}`);

    return {
      message: 'Treino removido com sucesso',
    };
  }
}