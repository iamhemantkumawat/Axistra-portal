import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVendorDefaults1795700000000 implements MigrationInterface {
  name = 'AddVendorDefaults1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "default_vendor_wallet" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "default_currency" character varying(8)`);
    await queryRunner.query(`ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "default_network" character varying(24)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "default_network"`);
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "default_currency"`);
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "default_vendor_wallet"`);
  }
}
