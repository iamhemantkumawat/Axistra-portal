import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerProfileFields1779543000000 implements MigrationInterface {
  name = 'AddCustomerProfileFields1779543000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "first_name" character varying`);
    await queryRunner.query(`ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_name" character varying`);
    await queryRunner.query(`ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "address" text`);
    await queryRunner.query(`ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "id_number" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "id_number"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "address"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "last_name"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "first_name"`);
  }
}
