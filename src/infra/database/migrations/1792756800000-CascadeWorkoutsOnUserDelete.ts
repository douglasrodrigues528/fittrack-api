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
