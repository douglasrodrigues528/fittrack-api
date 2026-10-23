import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';

import { UsersService } from './users.service';
import { UserEntity } from '../../../infra/database/entities/user.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';

describe('UsersService', () => {
  let service: UsersService;

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  // Transação simulada: registra as exclusões feitas em cada tabela, na ordem.
  const deletions: [string, object][] = [];
  const manager = {
    getRepository: jest.fn((entity: unknown) => ({
      delete: jest.fn((where: object) => {
        deletions.push([
          entity === WorkoutEntity ? 'workouts' : 'users',
          where,
        ]);
        return Promise.resolve({ affected: 1 });
      }),
    })),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const cache = { del: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockRepository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = moduleRef.get<UsersService>(UsersService);

    jest.clearAllMocks();
    deletions.length = 0;
  });

  it('exclui a conta apagando antes os treinos, numa única transação', async () => {
    mockRepository.findOne.mockResolvedValue({ id: 'u1', email: 'a@a.com' });

    await expect(service.delete('u1')).resolves.toEqual({
      message: 'Usuário removido com sucesso',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(deletions).toEqual([
      ['workouts', { userId: 'u1' }],
      ['users', { id: 'u1' }],
    ]);
    expect(cache.del).toHaveBeenCalledWith('workouts:u1');
  });

  it('A3: recusa trocar para um e-mail de outra conta com 409, sem salvar', async () => {
    mockRepository.findOne
      .mockResolvedValueOnce({ id: 'u1', email: 'a@a.com', name: 'A' }) // findById
      .mockResolvedValueOnce({ id: 'u2', email: 'b@b.com' }); // e-mail já usado
    await expect(
      service.update('u1', { email: 'b@b.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('A3: e-mail gravado ao mesmo tempo por outra conta (violação única) vira 409, não 500', async () => {
    mockRepository.findOne
      .mockResolvedValueOnce({ id: 'u1', email: 'a@a.com', name: 'A' })
      .mockResolvedValueOnce(null);
    const unique = new QueryFailedError(
      'UPDATE',
      [],
      new Error('duplicate key'),
    );
    (unique as unknown as { driverError: { code: string } }).driverError = {
      code: '23505',
    };
    mockRepository.save.mockRejectedValueOnce(unique);
    await expect(
      service.update('u1', { email: 'b@b.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('A3: manter o próprio e-mail não consulta duplicidade; resposta relida do banco', async () => {
    const stored = { id: 'u1', email: 'a@a.com', name: 'A' };
    mockRepository.findOne.mockResolvedValue(stored);
    mockRepository.save.mockResolvedValue(stored);
    await service.update('u1', { email: 'a@a.com', name: 'Novo' });
    expect(mockRepository.findOne).toHaveBeenCalledTimes(2); // findById antes e depois de salvar
    const lookups = mockRepository.findOne.mock.calls as [
      { where: Record<string, unknown> },
    ][];
    expect(lookups.some(([options]) => options.where.email === 'a@a.com')).toBe(
      false,
    );
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Novo' }),
    );
  });

  describe('A4: troca de senha', () => {
    const stored = { id: 'u1', email: 'a@a.com', name: 'A' };

    async function credentials(password: string, tokenVersion = 3) {
      return {
        id: 'u1',
        password: await bcrypt.hash(password, 4),
        tokenVersion,
      };
    }

    it('sem a senha atual: 400 e nada é salvo', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce({ ...stored })
        .mockResolvedValueOnce(await credentials('antiga-123'));
      await expect(
        service.update('u1', { password: 'nova-12345' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('senha atual errada: 403 e nada é salvo', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce({ ...stored })
        .mockResolvedValueOnce(await credentials('antiga-123'));
      await expect(
        service.update('u1', {
          password: 'nova-12345',
          currentPassword: 'chute',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('senha atual correta: grava o novo hash e incrementa a versão dos tokens', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce({ ...stored })
        .mockResolvedValueOnce(await credentials('antiga-123', 3))
        .mockResolvedValueOnce({ ...stored });
      mockRepository.save.mockImplementation((user: object) =>
        Promise.resolve(user),
      );
      await service.update('u1', {
        password: 'nova-12345',
        currentPassword: 'antiga-123',
      });
      const [[saved]] = mockRepository.save.mock.calls as [
        { password: string; tokenVersion: number },
      ][];
      expect(saved.tokenVersion).toBe(4);
      expect(await bcrypt.compare('nova-12345', saved.password)).toBe(true);
    });

    it('alterar só o nome não mexe na senha nem na versão dos tokens', async () => {
      mockRepository.findOne.mockResolvedValue({ ...stored });
      mockRepository.save.mockImplementation((user: object) =>
        Promise.resolve(user),
      );
      await service.update('u1', { name: 'B' });
      const [[saved]] = mockRepository.save.mock.calls as [object][];
      expect(saved).not.toHaveProperty('tokenVersion');
      expect(saved).not.toHaveProperty('password');
    });
  });

  it('não abre transação para usuário inexistente', async () => {
    mockRepository.findOne.mockResolvedValue(null);
    await expect(service.delete('x')).rejects.toBeInstanceOf(NotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('deve listar usuários', async () => {
    const users = [
      {
        id: '1',
        name: 'Douglas',
        email: 'doug@email.com',
        createdAt: new Date(),
      },
    ];

    mockRepository.find.mockResolvedValue(users);

    const result = await service.findAll();

    expect(result).toEqual(users);
    expect(mockRepository.find).toHaveBeenCalled();
  });

  it('deve impedir cadastro com email duplicado', async () => {
    mockRepository.findOne.mockResolvedValue({
      id: '1',
      email: 'doug@email.com',
    });

    await expect(
      service.create({
        name: 'Douglas',
        email: 'doug@email.com',
        password: '123456',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deve criar usuário com sucesso', async () => {
    const userData = {
      name: 'Douglas',
      email: 'douglas@email.com',
      password: '123456',
    };

    const createdUser = {
      id: '1',
      ...userData,
      createdAt: new Date(),
    };

    mockRepository.findOne.mockResolvedValue(null);
    mockRepository.create.mockReturnValue(createdUser);
    mockRepository.save.mockResolvedValue(createdUser);

    const result = await service.create(userData);

    expect(result).toEqual(createdUser);
    expect(mockRepository.create).toHaveBeenCalled();
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
