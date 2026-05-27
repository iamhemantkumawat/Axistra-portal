import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpenseCodes1779710000000 implements MigrationInterface {
  name = 'AddExpenseCodes1779710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "expense_code" character varying`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_expenses_expense_code" ON "expenses" ("expense_code") WHERE "expense_code" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_expenses_expense_code"`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN IF EXISTS "expense_code"`);
  }
}
