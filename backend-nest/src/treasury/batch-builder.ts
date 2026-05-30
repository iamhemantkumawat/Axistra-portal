import { TreasuryBatch } from '../entities/treasury-batch.entity';

const FIAT_CCY = ['AED', 'USD', 'EUR', 'GBP'];

export interface ConversionBatchInput {
  /** Wallet code where the conversion happened (BINANCE / OKX / AED_TREASURY). */
  wallet: string;
  from_coin: string;
  to_coin: string;
  from_amount: number;
  to_amount: number;
  /** Use the external_ref of the existing wallet_ledger pair as the batch_code. */
  batch_code: string;
  event_at: Date;
  notes?: string;
}

/**
 * Pure shape-builder used by both `wallets.service.convert()` and
 * `treasury.service.backfillOrphanConversions()` to keep the legacy
 * single-entry conversion endpoint and the historical backfiller in
 * lock-step with how `treasury.service.recordExchangeConversion()`
 * populates a `treasury_batches` row.
 *
 * NOTE: this function only describes the row.  The caller is responsible
 * for saving it AND for skipping `applyBatchLedger()`, because the
 * wallet_ledger rows are written by the conversion endpoint itself
 * (legacy path) — running `applyBatchLedger` afterwards would create
 * duplicate `-CONV-USDT` / `-CONV-AED` rows.
 */
export function buildConversionBatch(input: ConversionBatchInput): Partial<TreasuryBatch> {
  const wallet = input.wallet.toUpperCase();
  const fromCoin = input.from_coin.toUpperCase();
  const toCoin = input.to_coin.toUpperCase();
  const rate = input.from_amount > 0 ? (input.to_amount / input.from_amount).toFixed(8) : null;
  const isUsdtTarget = toCoin === 'USDT';
  const isFiatTarget = FIAT_CCY.includes(toCoin);
  const dateOnly = input.event_at.toISOString().slice(0, 10);

  const batch: Partial<TreasuryBatch> = {
    batch_code: input.batch_code,
    name: `${wallet} ${fromCoin} → ${toCoin} ${dateOnly}`,
    source_gateway: wallet,
    source_wallet: wallet,
    destination_exchange: wallet,
    destination_wallet: wallet,
    coin: fromCoin,
    received_crypto_amount: input.from_amount.toFixed(8),
    total_crypto_amount: input.from_amount.toFixed(8),
    exchange_received_at: input.event_at,
    settlement_reference: `${input.batch_code} legacy-conversion`,
    notes: input.notes || `${input.from_amount} ${fromCoin} → ${input.to_amount} ${toCoin} on ${wallet}`,
  };

  if (isUsdtTarget) {
    batch.usdt_amount = input.to_amount.toFixed(8);
    batch.usdt_conversion_rate = rate as any;
    batch.usdt_conversion_date = input.event_at;
    batch.usdt_conversion_reference = `${input.batch_code} ${fromCoin}→${toCoin}`;
    batch.status = 'converted_to_usdt';
  } else if (isFiatTarget) {
    batch.crypto_converted = input.from_amount.toFixed(8);
    batch.fiat_received = input.to_amount.toFixed(8);
    batch.fiat_currency = toCoin;
    batch.conversion_rate = rate as any;
    batch.conversion_date = input.event_at;
    batch.status = 'converted_to_aed';
  } else {
    batch.status = 'received_in_exchange';
  }
  return batch;
}
