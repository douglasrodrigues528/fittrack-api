import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Versão dos tokens de acesso (`users.tokenVersion`): trocar a senha incrementa o valor e
 * invalida os tokens emitidos antes. O padrão 0 mantém válidos os usuários e tokens já
 * existentes (tokens sem versão contam como 0).
 *
 * `IF NOT EXISTS` só tolera bancos em que o `synchronize` de desenvolvimento já criou a coluna;
 * em seguida a definição real é conferida e, se divergir, a migration falha (a transação é
 * desfeita) em vez de esconder a diferença.
 */
export class AddUserTokenVersion1792760400000 implements MigrationInterface {
  name = 'AddUserTokenVersion1792760400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0`,
    );

    const [column] = (await queryRunner.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'tokenVersion'`,
    )) as {
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }[];

    if (
      !column ||
      column.data_type !== 'integer' ||
      column.is_nullable !== 'NO' ||
      column.column_default !== '0'
    ) {
      throw new Error(
        `users.tokenVersion existe com definição inesperada: ${JSON.stringify(column ?? null)}. ` +
          'Esperado: integer NOT NULL DEFAULT 0. Corrija a coluna manualmente antes de migrar.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "tokenVersion"`,
    );
  }
}
