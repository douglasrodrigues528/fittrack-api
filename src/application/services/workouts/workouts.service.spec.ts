import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { UserEntity } from '../../../infra/database/entities/user.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';
import { UpdateWorkoutDto } from '../../dto/update-workout.dto';
import { MAX_PLANNED_WORKOUTS } from './workout-limits';
import { WORKOUT_LIMIT_REACHED, WorkoutsService } from './workouts.service';

describe('WorkoutsService', () => {
  let service: WorkoutsService;

  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn((value: object) => value),
    save: jest.fn((value: object) => Promise.resolve(value)),
    remove: jest.fn(),
  };
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

  // Transação simulada: registra o bloqueio da linha do usuário e usa o mesmo repositório de treinos.
  const userLock = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === UserEntity ? { createQueryBuilder: () => userLock } : repository,
    ),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) => work(manager)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: getRepositoryToken(WorkoutEntity), useValue: repository },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(WorkoutsService);
    userLock.getOne.mockResolvedValue({ id: 'user-1' });
    repository.count.mockResolvedValue(0);
  });

  it('cria o treino com todos os exercícios e o userId do token', async () => {
    const exercises = [
      { exerciseId: 'A', name: 'A', sets: [{ weight: 1, reps: 1 }] },
      { name: 'B', sets: [{ weight: 2, reps: 2 }] },
    ];
    await service.create({ title: 'T', exercises }, 'user-1');
    expect(repository.create).toHaveBeenCalledWith({
      title: 'T',
      description: undefined,
      exercises,
      weekdays: [],
      userId: 'user-1',
    });
    expect(cache.del).toHaveBeenCalledWith('workouts:user-1');
  });

  it('trava a linha do usuário e conta os treinos dentro da mesma transação', async () => {
    await service.create({ title: 'T' }, 'user-1');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(userLock.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(userLock.where).toHaveBeenCalledWith('user.id = :userId', { userId: 'user-1' });
    expect(repository.count).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it(`permite o ${MAX_PLANNED_WORKOUTS}º treino e recusa o seguinte com 409`, async () => {
    repository.count.mockResolvedValue(MAX_PLANNED_WORKOUTS - 1);
    await expect(service.create({ title: 'Sétimo' }, 'user-1')).resolves.toBeDefined();

    repository.save.mockClear();
    cache.del.mockClear();
    repository.count.mockResolvedValue(MAX_PLANNED_WORKOUTS);
    const attempt = service.create({ title: 'Oitavo' }, 'user-1');
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await attempt.catch((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({ code: WORKOUT_LIMIT_REACHED });
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('ordena e remove dias da semana repetidos', async () => {
    await service.create({ title: 'T', weekdays: [5, 1, 5] }, 'user-1');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ weekdays: [1, 5] }));
  });

  it('editar não passa pela contagem de vagas', async () => {
    repository.findOne.mockResolvedValue({ id: 'w1', userId: 'user-1', title: 'A', exercises: [] });
    repository.count.mockResolvedValue(MAX_PLANNED_WORKOUTS);
    await expect(service.update('w1', { title: 'B', weekdays: [2] }, 'user-1')).resolves.toMatchObject({
      title: 'B',
      weekdays: [2],
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('informa as vagas a partir do banco', async () => {
    repository.count.mockResolvedValue(3);
    await expect(service.getQuota('user-1')).resolves.toEqual({ used: 3, limit: 7, remaining: 4 });
  });

  it('atualiza apenas título, descrição e exercícios; nunca userId/id', async () => {
    const stored = { id: 'w1', userId: 'user-1', title: 'Velho', description: 'd', exercises: [] };
    repository.findOne.mockResolvedValue(stored);

    const hostile = {
      title: 'Novo',
      userId: 'atacante',
      id: 'outro',
    } as unknown as UpdateWorkoutDto;
    const result = await service.update('w1', hostile, 'user-1');

    expect(result).toMatchObject({ id: 'w1', userId: 'user-1', title: 'Novo', description: 'd' });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'w1', userId: 'user-1' } });
  });

  it('não encontra (404) treino de outro usuário', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.update('w1', { title: 'x' }, 'user-2')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('w1', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('lista só os treinos do usuário, do mais novo para o mais antigo', async () => {
    cache.get.mockResolvedValue(undefined);
    repository.find.mockResolvedValue([]);
    await service.findAllByUser('user-1');
    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { createdAt: 'DESC' },
    });
  });
});
