import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnhanceTreasurySettlementFlow1779549000000 implements MigrationInterface {
  name = 'EnhanceTreasurySettlementFlow1779549000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "source_gateway" character varying`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "settlement_reference" character varying`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "transfer_fee_crypto" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "received_crypto_amount" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "exchange_received_at" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "usdt_amount" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "usdt_conversion_rate" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "usdt_conversion_date" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "usdt_conversion_reference" character varying`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "bank_fee_aed" numeric(18,2)`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" ADD COLUMN IF NOT EXISTS "net_bank_deposit_amount" numeric(18,2)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "net_bank_deposit_amount"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "bank_fee_aed"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "usdt_conversion_reference"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "usdt_conversion_date"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "usdt_conversion_rate"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "usdt_amount"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "exchange_received_at"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "received_crypto_amount"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "transfer_fee_crypto"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "settlement_reference"`);
    await queryRunner.query(`ALTER TABLE "treasury_batches" DROP COLUMN IF EXISTS "source_gateway"`);
  }
}
