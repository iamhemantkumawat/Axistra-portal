import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletLedger, WalletCode } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';

/**
 * Backfill the new wallet_ledgers from legacy tables on startup.
 * Idempotent: it tags every legacy-imported row with linked_recharge_id + tx_type,
 * and skips entries that already exist.
 */
@Injectable()
export class WalletLedgerMigrator implements OnModuleInit {
  private log = new Logger('WalletLedgerMigrator');

  constructor(
    @InjectRepository(WalletLedger) private ledger: Repository<WalletLedger>,
    @InjectRepository(Recharge) private recharges: Repository<Recharge>,
    @InjectRepository(TreasuryMovement) private movements: Repository<TreasuryMovement>,
  ) {}

  pickWallet(payment_gateway: string, coin: string): WalletCode {
    const g = (payment_gateway || '').toLowerCase();
    if (g.includes('oxapay')) return 'OXAPAY';
    if (g.includes('btcpay')) return 'BTCPAY';
    if (g.includes('binance')) return 'BINANCE';
    if (g.includes('okx')) return 'OKX';
    // Manual / Telegram Manual → guess by coin
    if ((coin || '').toUpperCase() === 'BTC') return 'BTCPAY';
    if ((coin || '').toUpperCase() === 'USDT') return 'OXAPAY';
    return 'MANUAL';
  }

  async onModuleInit() {
    // If we have legacy_imports already, skip.
    const count = await this.ledger.count();
    if (count > 0) {
      this.log.log(`wallet_ledgers already has ${count} rows — skipping migration.`);
      return;
    }
    await this.importRecharges();
    this.log.log('Wallet ledger backfill complete.');
  }

  private async importRecharges() {
    const all = await this.recharges.find();
    this.log.log(`Importing ${all.length} recharges into wallet ledger…`);
    for (const r of all) {
      const wallet = this.pickWallet(r.payment_gateway, r.crypto_coin);
      const amount = (parseFloat(r.crypto_amount || r.amount || '0')).toFixed(8);
      if (parseFloat(amount) <= 0) continue;
      await this.ledger.save(this.ledger.create({
        wallet, coin: (r.crypto_coin || 'USDT').toUpperCase(), network: r.crypto_network,
        amount, tx_type: 'deposit',
        linked_recharge_id: r.id, linked_invoice_id: r.invoice_id,
        tx_hash: r.tx_hash, external_ref: r.recharge_code,
        counterparty: r.magnus_username,
        aed_value_at_event: r.currency === 'AED' ? r.amount : null,
        notes: r.admin_notes,
        event_at: r.payment_date || r.created_at,
      }));
    }
  }
}
