import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGatewayCryptoDetails1779636000000 implements MigrationInterface {
  name = 'AddGatewayCryptoDetails1779636000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "gateway_invoice_id" character varying`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "gateway_track_id" character varying`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "gateway_tx_status" character varying`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "sender_address" character varying`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "sent_amount" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "sent_value" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "received_amount" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "received_value" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "gateway_rate" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "confirmations" character varying`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "auto_convert_amount" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "auto_convert_currency" character varying`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "final_usdt_amount" numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" ADD COLUMN IF NOT EXISTS "raw_gateway_payload" text`);
    await queryRunner.query(`ALTER TABLE "treasury_movements" ADD COLUMN IF NOT EXISTS "source_currency_summary" text`);
    await queryRunner.query(`ALTER TABLE "treasury_movements" ADD COLUMN IF NOT EXISTS "source_transaction_details" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "treasury_movements" DROP COLUMN IF EXISTS "source_transaction_details"`);
    await queryRunner.query(`ALTER TABLE "treasury_movements" DROP COLUMN IF EXISTS "source_currency_summary"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "raw_gateway_payload"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "final_usdt_amount"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "auto_convert_currency"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "auto_convert_amount"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "confirmations"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "gateway_rate"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "received_value"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "received_amount"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "sent_value"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "sent_amount"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "sender_address"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "gateway_tx_status"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "gateway_track_id"`);
    await queryRunner.query(`ALTER TABLE "crypto_transactions" DROP COLUMN IF EXISTS "gateway_invoice_id"`);
  }
}
