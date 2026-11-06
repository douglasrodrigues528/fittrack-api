import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';

import { UsersModule } from './presentation/modules/users/users.module';
import { AuthModule } from './presentation/modules/auth/auth.module';
import { WorkoutsModule } from './presentation/modules/workouts/workouts.module';
import { ExercisesModule } from './presentation/modules/exercises/exercises.module';
import { SessionsModule } from './presentation/modules/sessions/sessions.module';
import { OnboardingModule } from './presentation/modules/onboarding/onboarding.module';
import { HealthController } from './presentation/controllers/health/health.controller';
import { isProduction } from './shared/config/app-config';
import {
  resolveConnection,
  typeOrmConnectionOptions,
} from './infra/database/connection-options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    CacheModule.register({
      isGlobal: true,
      ttl: 600,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // synchronize altera o esquema automaticamente: útil só em desenvolvimento.
        // Em produção fica desligado por padrão; use migrations.
        const synchronize =
          configService.get<string>('DB_SYNCHRONIZE') !== undefined
            ? configService.get<string>('DB_SYNCHRONIZE') === 'true'
            : !isProduction(configService);

        // SSL: com DB_SSL=true (ou sslmode na URL) o certificado do banco é validado.
        const connection = resolveConnection({
          DATABASE_URL: configService.get<string>('DATABASE_URL'),
          DB_HOST: configService.get<string>('DB_HOST'),
          DB_PORT: configService.get<string>('DB_PORT'),
          DB_USER: configService.get<string>('DB_USER'),
          DB_PASSWORD: configService.get<string>('DB_PASSWORD'),
          DB_NAME: configService.get<string>('DB_NAME'),
          DB_SSL: configService.get<string>('DB_SSL'),
        });

        return {
          type: 'postgres' as const,
          ...typeOrmConnectionOptions(connection),
          autoLoadEntities: true,
          synchronize,
        };
      },
    }),

    UsersModule,
    AuthModule,
    WorkoutsModule,
    ExercisesModule,
    SessionsModule,
    OnboardingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}