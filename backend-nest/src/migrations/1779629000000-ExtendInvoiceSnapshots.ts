import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendInvoiceSnapshots1779629000000 implements MigrationInterface {
  name = 'ExtendInvoiceSnapshots1779629000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customer_phone" character varying`);
    await queryRunner.query(`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customer_address" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "customer_address"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "customer_phone"`);
  }
}
