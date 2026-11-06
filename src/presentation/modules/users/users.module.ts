import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserEntity } from '../../../infra/database/entities/user.entity';
import { UsersController } from '../../controllers/users/users.controller';
import { UsersService } from '../../../application/services/users/users.service';
import {
  SignupLimitService,
  signupLimitFrom,
} from '../../../application/services/users/signup-limit.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],

  controllers: [UsersController],

  providers: [
    UsersService,
    {
      provide: SignupLimitService,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new SignupLimitService(
          signupLimitFrom(configService.get<string>('SIGNUP_LIMIT_PER_HOUR')),
        ),
    },
  ],

  exports: [UsersService],
})
export class UsersModule {}