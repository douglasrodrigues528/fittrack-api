import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema da jornada inicial, do limite de treinos planejados e das sessões em andamento.
 *
 * Idempotente e não destrutiva: serve tanto para um banco de produção vazio (cria as tabelas)
 * quanto para um banco que já existia via `synchronize` (só acrescenta o que falta).
 * Nenhum treino, sessão ou exercício é apagado ou reescrito.
 *
 * O catálogo (`exercises`) continua sendo criado/importado por `scripts/sync-exercises.cjs`.
 */
export class JourneyAndSessions1792670400000 implements MigrationInterface {
  name = 'JourneyAndSessions1792670400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ---------- tabelas base (só são criadas se ainda não existirem) ----------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"),
        CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workouts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "description" character varying,
        "exercises" jsonb DEFAULT '[]',
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_5b2319bf64a674d40237dbb1697" PRIMARY KEY ("id"),
        CONSTRAINT "FK_65ff5fd1913246288adad5dc75a" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workout_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "workoutId" uuid,
        "title" character varying(255) NOT NULL,
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "durationSeconds" integer,
        "notes" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_eea00e05dc78d40b55a588c9f57" PRIMARY KEY ("id"),
        CONSTRAINT "FK_b4b5ff8f7c2cb3c3c18e07cc5ce" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_82cab13dc713bfb0cff9bb76c54" FOREIGN KEY ("workoutId")
          REFERENCES "workouts"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_b4b5ff8f7c2cb3c3c18e07cc5c" ON "workout_sessions" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_f2887bdfe9b5bd0ff04f3fa10e" ON "workout_sessions" ("finishedAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "session_sets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "exerciseId" character varying(150),
        "exerciseName" character varying(255) NOT NULL,
        "exerciseOrder" integer NOT NULL,
        "setOrder" integer NOT NULL,
        "type" character varying(16) NOT NULL DEFAULT 'normal',
        "weight" numeric(7,2) NOT NULL,
        "reps" integer NOT NULL,
        CONSTRAINT "PK_78566b25f157fedf3275de3408d" PRIMARY KEY ("id"),
        CONSTRAINT "FK_4907210b1e7eab89792481dc84a" FOREIGN KEY ("sessionId")
          REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_4907210b1e7eab89792481dc84" ON "session_sets" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fa8b227c3c93c592cf7b09a5ef" ON "session_sets" ("exerciseId")`,
    );

    // ---------- novidades desta etapa ----------
    // Jornada inicial (primeira escolha do usuário).
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingChoice" character varying(16)`,
    );

    // Dias da semana do treino planejado (treinos existentes ficam sem dia fixo).
    await queryRunner.query(
      `ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "weekdays" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );

    // Sessões: estado, origem e progresso da sessão em andamento.
    // Sessões já gravadas eram sempre concluídas: recebem o padrão 'completed'.
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" ADD COLUMN IF NOT EXISTS "status" character varying(16) NOT NULL DEFAULT 'completed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" ADD COLUMN IF NOT EXISTS "origin" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" ADD COLUMN IF NOT EXISTS "progress" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    // Uma sessão em andamento ainda não tem fim nem duração.
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" ALTER COLUMN "finishedAt" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" ALTER COLUMN "durationSeconds" DROP NOT NULL`,
    );

    // No máximo uma sessão em andamento por usuário.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workout_sessions_user_in_progress" ON "workout_sessions" ("userId") WHERE "status" = 'in_progress'`,
    );
  }

  /**
   * Desfaz só o que esta etapa acrescentou (índice e colunas novas). As tabelas base não são
   * removidas, e "finishedAt"/"durationSeconds" continuam aceitando nulo para não falhar
   * caso existam sessões descartadas ou em andamento.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_workout_sessions_user_in_progress"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" DROP COLUMN IF EXISTS "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" DROP COLUMN IF EXISTS "progress"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" DROP COLUMN IF EXISTS "origin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_sessions" DROP COLUMN IF EXISTS "status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workouts" DROP COLUMN IF EXISTS "weekdays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "onboardingChoice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "onboardingCompletedAt"`,
    );
  }
}
