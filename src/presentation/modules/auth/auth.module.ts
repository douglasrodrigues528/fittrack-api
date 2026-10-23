import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from '../../controllers/auth/auth.controller';
import { AuthService } from '../../../application/services/auth/auth.service';
import { JwtStrategy } from '../../../application/services/auth/jwt.strategy';
import { getJwtSecret } from '../../../shared/config/app-config';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,

    PassportModule,

    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: getJwtSecret(configService),
        signOptions: {
          expiresIn: '1d',
        },
      }),
    }),
  ],

  controllers: [AuthController],

  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}