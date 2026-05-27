import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGatewaySettlementFlow1779510000000 implements MigrationInterface {
  name = 'AddGatewaySettlementFlow1779510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_webhooks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source" character varying NOT NULL, "external_event_id" character varying, "gateway_invoice_id" character varying, "tx_hash" character varying, "recharge_id" character varying, "processed" boolean NOT NULL DEFAULT false, "error_message" text, "raw_payload" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_payment_webhooks" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_webhooks_event" ON "payment_webhooks" ("external_event_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_webhooks_invoice" ON "payment_webhooks" ("gateway_invoice_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_webhooks_tx" ON "payment_webhooks" ("tx_hash")`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "treasury_batches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "batch_code" character varying NOT NULL, "name" character varying NOT NULL, "period_start" TIMESTAMP, "period_end" TIMESTAMP, "status" character varying NOT NULL DEFAULT 'open', "source_wallet" character varying, "destination_exchange" character varying, "destination_wallet" character varying, "settlement_tx_hash" character varying, "coin" character varying, "network" character varying, "total_crypto_amount" numeric(18,8), "total_invoice_amount" numeric(18,2), "invoice_currency" character varying, "crypto_converted" numeric(18,8), "conversion_rate" numeric(12,4), "fiat_received" numeric(18,2), "fiat_currency" character varying, "conversion_date" TIMESTAMP, "bank_name" character varying, "bank_reference" character varying, "bank_deposit_date" TIMESTAMP, "notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_treasury_batches_batch_code" UNIQUE ("batch_code"), CONSTRAINT "PK_treasury_batches" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_treasury_batches_batch_code" ON "treasury_batches" ("batch_code")`);

    await queryRunner.query(`ALTER TABLE "treasury_movements" ADD COLUMN IF NOT EXISTS "treasury_batch_id" character varying`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_d30f6a483a032bc38d519047ad"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_d30f6a483a032bc38d519047ad" ON "crypto_transactions" ("tx_hash")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_d30f6a483a032bc38d519047ad"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_d30f6a483a032bc38d519047ad" ON "crypto_transactions" ("tx_hash")`);
    await queryRunner.query(`ALTER TABLE "treasury_movements" DROP COLUMN IF EXISTS "treasury_batch_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_treasury_batches_batch_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "treasury_batches"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_webhooks_tx"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_webhooks_invoice"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_webhooks_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_webhooks"`);
  }
}
