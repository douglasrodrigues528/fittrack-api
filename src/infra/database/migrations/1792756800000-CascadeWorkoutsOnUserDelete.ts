import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Excluir um usuário passa a excluir também os seus treinos planejados
 * (antes a FK era ON DELETE NO ACTION e a exclusão da conta falhava com erro 500).
 * Só recria a restrição; nenhum dado é alterado.
 */
export class CascadeWorkoutsOnUserDelete1792756800000 implements MigrationInterface {
  name = 'CascadeWorkoutsOnUserDelete1792756800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workouts" DROP CONSTRAINT IF EXISTS "FK_65ff5fd1913246288adad5dc75a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workouts" ADD CONSTRAINT "FK_65ff5fd1913246288adad5dc75a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Se o banco tivesse a FK com outro nome, a antiga (sem CASCADE) continuaria lá ao lado da
    // nova e a exclusão de conta seguiria bloqueada: falha em vez de esconder a divergência.
    const foreignKeys = (await queryRunner.query(
      `SELECT c.conname, c.confdeltype
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid = 'workouts'::regclass
          AND c.confrelid = 'users'::regclass
          AND a.attname = 'userId'`,
    )) as { conname: string; confdeltype: string }[];

    if (foreignKeys.length !== 1 || foreignKeys[0].confdeltype !== 'c') {
      throw new Error(
        `workouts.userId deveria ter uma única FK para users com ON DELETE CASCADE; encontrado: ${JSON.stringify(foreignKeys)}.`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workouts" DROP CONSTRAINT IF EXISTS "FK_65ff5fd1913246288adad5dc75a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workouts" ADD CONSTRAINT "FK_65ff5fd1913246288adad5dc75a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
