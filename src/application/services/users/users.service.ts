import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { DataSource, Not, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { CreateUserDto } from '../../dto/create-user.dto';
import { UpdateUserDto } from '../../dto/update-user.dto';
import { UserEntity } from '../../../infra/database/entities/user.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';

const EMAIL_TAKEN = 'E-mail já cadastrado';

/** Violação de restrição única no PostgreSQL (ex.: e-mail repetido gravado ao mesmo tempo). */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = (error as QueryFailedError & { driverError?: { code?: string } }).driverError;
  return driverError?.code === '23505';
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,

    private readonly dataSource: DataSource,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  findAll() {
    return this.usersRepository.find();
  }

    async findById(id: string) {
    const user = await this.usersRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return user;
  }

  async findByEmailWithPassword(email: string) {
    return this.usersRepository.findOne({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        tokenVersion: true,
        createdAt: true,
      },
    });
  }

  async create(data: CreateUserDto) {
    const userAlreadyExists = await this.usersRepository.findOne({
      where: {
        email: data.email,
      },
    });

    if (userAlreadyExists) {
      throw new ConflictException(EMAIL_TAKEN);
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
    });

    return this.saveUnique(user);
  }

  async update(id: string, data: UpdateUserDto) {
    const user = await this.findById(id);

    if (data.email !== undefined && data.email !== user.email) {
      const taken = await this.usersRepository.findOne({
        where: { email: data.email, id: Not(id) },
      });
      if (taken) throw new ConflictException(EMAIL_TAKEN);
      user.email = data.email;
    }

    // Só estes campos podem mudar; id e createdAt nunca vêm do cliente.
    if (data.name !== undefined) user.name = data.name;
    if (data.password) {
      // Trocar a senha exige a senha atual (um token roubado não basta) e encerra
      // todas as sessões abertas: os tokens emitidos antes deixam de valer.
      const credentials = await this.findCredentials(id);
      if (!data.currentPassword) {
        throw new BadRequestException('Informe a senha atual para trocar a senha.');
      }
      if (!(await bcrypt.compare(data.currentPassword, credentials.password))) {
        throw new ForbiddenException('Senha atual incorreta.');
      }
      user.password = await bcrypt.hash(data.password, 10);
      user.tokenVersion = credentials.tokenVersion + 1;
    }

    await this.saveUnique(user);

    // Relê do banco: a resposta nunca inclui o hash da senha.
    return this.findById(id);
  }

  /** Versão atual dos tokens do usuário, ou null se a conta não existe mais. */
  async getTokenVersion(id: string): Promise<number | null> {
    const user = await this.usersRepository.findOne({
      where: { id },
      select: { id: true, tokenVersion: true },
    });
    return user ? user.tokenVersion : null;
  }

  private async findCredentials(id: string) {
    const user = await this.usersRepository.findOne({
      where: { id },
      select: { id: true, password: true, tokenVersion: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  /** Salva tratando e-mail repetido gravado ao mesmo tempo por outra requisição (409, não 500). */
  private async saveUnique(user: UserEntity) {
    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(EMAIL_TAKEN);
      throw error;
    }
  }

  /**
   * Exclui a conta e todos os dados do usuário. Os treinos planejados são apagados
   * explicitamente na mesma transação (bancos antigos têm a FK sem CASCADE); as sessões
   * e séries saem em cascata pela FK de `workout_sessions`.
   */
  async delete(id: string) {
    await this.findById(id);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(WorkoutEntity).delete({ userId: id });
      await manager.getRepository(UserEntity).delete({ id });
    });

    await this.cacheManager.del(`workouts:${id}`);

    return {
      message: 'Usuário removido com sucesso',
    };
  }
}