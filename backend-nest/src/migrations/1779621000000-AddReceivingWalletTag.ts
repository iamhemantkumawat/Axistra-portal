import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceivingWalletTag1779621000000 implements MigrationInterface {
  name = 'AddReceivingWalletTag1779621000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "treasury_movements" ADD COLUMN IF NOT EXISTS "receiving_wallet_tag" character varying`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "receiving_wallet_tag" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "receiving_wallet_tag"`);
    await queryRunner.query(`ALTER TABLE "treasury_movements" DROP COLUMN IF EXISTS "receiving_wallet_tag"`);
  }
}
