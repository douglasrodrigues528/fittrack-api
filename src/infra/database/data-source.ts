import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { ExerciseEntity } from './entities/exercise.entity';
import { SessionSetEntity } from './entities/session-set.entity';
import { UserEntity } from './entities/user.entity';
import { WorkoutSessionEntity } from './entities/workout-session.entity';
import { WorkoutEntity } from './entities/workout.entity';

// Variáveis já definidas no ambiente têm prioridade; o .env é opcional (em produção não existe).
try {
  process.loadEnvFile('.env');
} catch {
  /* sem .env: usa apenas as variáveis do ambiente */
}

/**
 * DataSource usado pela CLI do TypeORM para rodar migrations
 * (`npm run migration:run`). Lê as mesmas variáveis de ambiente da API.
 */
export default new DataSource({
  type: 'postgres',
  ...(process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [
    UserEntity,
    WorkoutEntity,
    WorkoutSessionEntity,
    SessionSetEntity,
    ExerciseEntity,
  ],
  // Em src/ carrega os .ts; no build (dist/) só os .js (ignora os .d.ts gerados).
  migrations: [
    `${__dirname}/migrations/*.${__filename.endsWith('.ts') ? 'ts' : 'js'}`,
  ],
  synchronize: false,
});
