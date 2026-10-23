import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { CreateUserDto } from '../../dto/create-user.dto';
import { UpdateUserDto } from '../../dto/update-user.dto';
import { UserEntity } from '../../../infra/database/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
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
      throw new ConflictException('E-mail já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
    });

    return this.usersRepository.save(user);
  }

  async update(id: string, data: UpdateUserDto) {
  const user = await this.findById(id);

  if (data.password) {
    data.password = await bcrypt.hash(data.password, 10);
  }

  Object.assign(user, data);

  return this.usersRepository.save(user);
}

  async delete(id: string) {
    const user = await this.findById(id);

    await this.usersRepository.remove(user);

    return {
      message: 'Usuário removido com sucesso',
    };
  }
}