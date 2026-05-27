import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixExchangeWalletGatewayRows1779700000000 implements MigrationInterface {
  name = 'FixExchangeWalletGatewayRows1779700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE recharges r
      SET payment_gateway = CASE
        WHEN LOWER(tm.receiving_wallet_tag) LIKE '%binance%' THEN 'Binance'
        WHEN LOWER(tm.receiving_wallet_tag) LIKE '%okx%' THEN 'OKX'
        ELSE r.payment_gateway
      END,
      crypto_coin = COALESCE(ct.coin, r.crypto_coin),
      crypto_network = COALESCE(ct.network, r.crypto_network),
      crypto_amount = COALESCE(ct.crypto_amount, r.crypto_amount)
      FROM treasury_movements tm
      LEFT JOIN crypto_transactions ct ON ct.recharge_id = r.id::text
      WHERE tm.recharge_id = r.id::text
        AND r.payment_gateway = 'Telegram Manual'
        AND (LOWER(tm.receiving_wallet_tag) LIKE '%binance%' OR LOWER(tm.receiving_wallet_tag) LIKE '%okx%')
    `);

    await queryRunner.query(`
      UPDATE invoices i
      SET payment_method = r.payment_gateway,
          crypto_coin = r.crypto_coin,
          crypto_network = r.crypto_network
      FROM recharges r
      WHERE i.id::text = r.invoice_id
        AND r.payment_gateway IN ('Binance', 'OKX')
    `);

    await queryRunner.query(`
      UPDATE crypto_transactions
      SET final_usdt_amount = NULL,
          auto_convert_amount = NULL,
          auto_convert_currency = NULL
      WHERE UPPER(coin) <> 'USDT'
        AND final_usdt_amount IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE treasury_movements tm
      SET total_usdt_received = 0,
          source_currency_summary = source.summary
      FROM (
        SELECT recharge_id, STRING_AGG(total_amount || ' ' || coin_network, ', ' ORDER BY coin_network) AS summary
        FROM (
          SELECT
            recharge_id,
            TRIM(COALESCE(coin, 'Crypto') || ' ' || COALESCE(network, '')) AS coin_network,
            SUM(crypto_amount)::text AS total_amount
          FROM crypto_transactions
          GROUP BY recharge_id, TRIM(COALESCE(coin, 'Crypto') || ' ' || COALESCE(network, ''))
        ) grouped
        GROUP BY recharge_id
      ) source
      WHERE tm.recharge_id = source.recharge_id
        AND EXISTS (
          SELECT 1
          FROM recharges r
          WHERE r.id::text = tm.recharge_id
            AND r.payment_gateway IN ('Binance', 'OKX')
            AND UPPER(r.crypto_coin) <> 'USDT'
        )
    `);
  }

  public async down(): Promise<void> {
    // Data correction only; no safe automatic rollback.
  }
}
