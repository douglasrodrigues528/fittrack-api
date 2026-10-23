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
import { isProduction } from './shared/config/app-config';

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
        const databaseUrl = configService.get<string>('DATABASE_URL');
        const useSsl = configService.get<string>('DB_SSL') === 'true';

        // synchronize altera o esquema automaticamente: útil só em desenvolvimento.
        // Em produção fica desligado por padrão; use migrations.
        const synchronize =
          configService.get<string>('DB_SYNCHRONIZE') !== undefined
            ? configService.get<string>('DB_SYNCHRONIZE') === 'true'
            : !isProduction(configService);

        return {
          type: 'postgres' as const,
          ...(databaseUrl
            ? { url: databaseUrl }
            : {
                host: configService.get<string>('DB_HOST'),
                port: Number(configService.get<string>('DB_PORT') ?? 5432),
                username: configService.get<string>('DB_USER'),
                password: configService.get<string>('DB_PASSWORD'),
                database: configService.get<string>('DB_NAME'),
              }),
          ssl: useSsl ? { rejectUnauthorized: false } : false,
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
})
export class AppModule {}