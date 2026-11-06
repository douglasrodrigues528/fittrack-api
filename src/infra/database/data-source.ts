import 'reflect-metadata';
import { DataSource } from 'typeorm';

import {
  resolveConnection,
  typeOrmConnectionOptions,
} from './connection-options';
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
 * DataSource usado pela CLI do TypeORM em DESENVOLVIMENTO (`npm run migration:run`).
 * Lê as mesmas variáveis de ambiente da API, inclusive o `.env`.
 * Produção nunca passa por aqui: use `npm run db:prod:migrate` (veja DEPLOY.md).
 */
export default new DataSource({
  type: 'postgres',
  ...typeOrmConnectionOptions(resolveConnection(process.env)),
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
