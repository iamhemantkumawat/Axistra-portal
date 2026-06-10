import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { TreasuryBatch } from '../entities/treasury-batch.entity';
import { WalletLedger } from '../entities/wallet-ledger.entity';

/**
 * Crypto Conversion Register & Source of Funds.
 * Read-only aggregator. For each recharge it stitches the full audit
 * chain: Customer → Invoice → Crypto TX Hash → Exchange Settlement
 * (USDT) → AED Conversion → Wio Bank Deposit. Backed by existing
 * tables — no new schema.
 */
@Injectable()
export class ConversionRegisterService {
  constructor(
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(CryptoTransaction) private cryptoRepo: Repository<CryptoTransaction>,
    @InjectRepository(TreasuryMovement) private movementRepo: Repository<TreasuryMovement>,
    @InjectRepository(TreasuryBatch) private batchRepo: Repository<TreasuryBatch>,
    @InjectRepository(WalletLedger) private ledgerRepo: Repository<WalletLedger>,
  ) {}

  async list(filter: { from?: string; to?: string; status?: string; currency?: string }) {
    const qb = this.rechargeRepo.createQueryBuilder('r').orderBy('r.created_at', 'DESC');
    if (filter.from) qb.andWhere('r.created_at >= :from', { from: filter.from });
    if (filter.to) qb.andWhere('r.created_at <= :to', { to: `${filter.to} 23:59:59` });
    if (filter.status) qb.andWhere('r.status = :status', { status: filter.status });
    if (filter.currency) qb.andWhere('r.currency = :currency', { currency: filter.currency });
    const rows = await qb.getMany();

    // Pre-load related data
    const ids = rows.map((r) => r.id);
    const customerIds = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean)));

    const [customers, invoices, txs, movements] = await Promise.all([
      customerIds.length
        ? this.customerRepo.createQueryBuilder('c').whereInIds(customerIds).getMany()
        : [],
      ids.length
        ? this.invoiceRepo.createQueryBuilder('i').where('i.recharge_id IN (:...ids)', { ids }).getMany()
        : [],
      ids.length
        ? this.cryptoRepo.createQueryBuilder('t').where('t.recharge_id IN (:...ids)', { ids }).getMany()
        : [],
      ids.length
        ? this.movementRepo.createQueryBuilder('m')
            .leftJoinAndSelect(TreasuryBatch, 'b', 'b.id::text = m.treasury_batch_id::text')
            .where('m.recharge_id IN (:...ids)', { ids })
            .select(['m', 'b'])
            .getRawAndEntities()
        : { entities: [], raw: [] },
    ]);

    const cMap: Record<string, Customer> = {};
    customers.forEach((c) => { cMap[c.id] = c; });
    const iMap: Record<string, Invoice> = {};
    invoices.forEach((i) => { iMap[i.recharge_id] = i; });
    const tMap: Record<string, CryptoTransaction[]> = {};
    txs.forEach((t) => {
      tMap[t.recharge_id] = tMap[t.recharge_id] || [];
      tMap[t.recharge_id].push(t);
    });

    // Build movement map (movement + raw batch)
    const mEntries = (movements as any).entities || [];
    const mRaw = (movements as any).raw || [];
    const mvMap: Record<string, any> = {};
    mEntries.forEach((m: TreasuryMovement, idx: number) => {
      const raw = mRaw[idx];
      const batch: any = {};
      if (raw) {
        Object.keys(raw).forEach((k) => {
          if (k.startsWith('b_')) batch[k.slice(2)] = raw[k];
        });
      }
      mvMap[m.recharge_id] = { movement: m, batch: batch.id ? batch : null };
    });

    return Promise.all(rows.map(async (r) => {
      const cust = cMap[r.customer_id] || null;
      const inv = iMap[r.id] || null;
      const txList = tMap[r.id] || [];
      const mv = mvMap[r.id] || {};
      const batch = mv.batch || null;

      // Pull wallet_ledger fallbacks for steps 5-7 when the treasury_batch
      // doesn't carry those fields (operators who did the conversion via
      // Wallet Ledger directly instead of via the batch workflow).
      let usdtLedger: WalletLedger | null = null;
      let aedLedger: WalletLedger | null = null;
      let wioLedger: WalletLedger | null = null;
      const usdtMissing = !batch || !batch.usdt_amount;
      const aedMissing = !batch || !batch.fiat_received;
      const wioMissing = !batch || !batch.bank_reference;
      if (batch && (usdtMissing || aedMissing || wioMissing)) {
        const destExchange = String(batch.destination_exchange || batch.destination_wallet || '').toUpperCase();
        const since = batch.exchange_received_at || batch.created_at;
        if (destExchange && since) {
          const ledgerRows = await this.ledgerRepo
            .createQueryBuilder('l')
            .where("(l.wallet = :ex OR l.wallet = 'WIO_BANK')", { ex: destExchange })
            .andWhere('l.event_at >= :since', { since })
            .orderBy('l.event_at', 'ASC')
            .limit(200)
            .getMany();
          if (usdtMissing) {
            usdtLedger = ledgerRows.find((l) => l.wallet === destExchange && l.tx_type === 'convert_to' && (l.coin || '').toUpperCase() === 'USDT') || null;
          }
          if (aedMissing) {
            aedLedger = ledgerRows.find((l) => l.wallet === destExchange && l.tx_type === 'convert_to' && (l.coin || '').toUpperCase() === 'AED') ||
                        ledgerRows.find((l) => l.wallet === destExchange && l.tx_type === 'cashout' && (l.coin || '').toUpperCase() === 'AED') ||
                        null;
          }
          if (wioMissing) {
            wioLedger = ledgerRows.find((l) => l.wallet === 'WIO_BANK' && l.tx_type === 'bank_deposit') || null;
          }
        }
      }

      return {
        recharge_id: r.id,
        recharge_code: r.recharge_code,
        status: r.status,
        created_at: r.created_at,
        // Step 1: Customer
        customer: cust ? {
          id: cust.id, code: cust.customer_code, name: cust.full_name,
          email: cust.email, country: cust.country, magnus_username: cust.magnus_username,
        } : null,
        // Step 2: Invoice
        invoice: inv ? {
          id: inv.id, number: inv.invoice_number, amount: inv.amount,
          currency: inv.currency, status: inv.status, issue_date: inv.issued_date,
        } : null,
        // Step 3: Crypto Receipt
        crypto_receipt: {
          fiat_amount: r.amount,
          fiat_currency: r.currency,
          coin: r.crypto_coin,
          network: r.crypto_network,
          amount: r.crypto_amount,
          tx_hash: r.tx_hash,
          wallet_address: r.wallet_address,
          payment_gateway: r.payment_gateway,
          payment_date: r.payment_date,
          additional_txs: txList.length,
        },
        // Step 4: Exchange settlement (sweep from gateway → exchange)
        exchange_settlement: batch ? {
          batch_code: batch.batch_code,
          source_gateway: batch.source_gateway,
          destination_exchange: batch.destination_exchange,
          settlement_tx_hash: batch.settlement_tx_hash,
          received_amount: batch.received_crypto_amount,
          received_at: batch.exchange_received_at,
        } : null,
        // Step 5: Conversion to USDT
        usdt_conversion: (batch && batch.usdt_amount) ? {
          usdt_amount: batch.usdt_amount,
          rate: batch.usdt_conversion_rate,
          date: batch.usdt_conversion_date,
          reference: batch.usdt_conversion_reference,
        } : usdtLedger ? {
          usdt_amount: Math.abs(parseFloat(usdtLedger.amount)).toFixed(8),
          rate: usdtLedger.rate_used || null,
          date: usdtLedger.event_at,
          reference: usdtLedger.external_ref || usdtLedger.tx_hash,
        } : null,
        // Step 6: AED / Fiat sale
        fiat_conversion: (batch && batch.fiat_received) ? {
          fiat_received: batch.fiat_received,
          fiat_currency: batch.fiat_currency,
          rate: batch.conversion_rate,
          date: batch.conversion_date,
          crypto_sold: batch.crypto_converted,
          reference: batch.batch_code,
        } : aedLedger ? {
          fiat_received: Math.abs(parseFloat(aedLedger.amount)).toFixed(2),
          fiat_currency: aedLedger.coin,
          rate: aedLedger.rate_used || null,
          date: aedLedger.event_at,
          crypto_sold: null,
          reference: aedLedger.external_ref || aedLedger.tx_hash,
        } : null,
        // Step 7: Wio Bank deposit
        wio_deposit: (batch && batch.bank_reference) ? {
          bank_name: batch.bank_name,
          reference: batch.bank_reference,
          deposit_date: batch.bank_deposit_date,
          gross_amount: batch.fiat_received,
          fee_aed: batch.bank_fee_aed,
          net_amount: batch.net_bank_deposit_amount,
          currency: batch.fiat_currency || 'AED',
        } : wioLedger ? {
          bank_name: 'Wio Bank',
          reference: wioLedger.external_ref || wioLedger.tx_hash,
          deposit_date: wioLedger.event_at,
          gross_amount: parseFloat(wioLedger.amount).toFixed(2),
          fee_aed: 0,
          net_amount: parseFloat(wioLedger.amount).toFixed(2),
          currency: wioLedger.coin,
        } : null,
      };
    }));
  }

  async summary(filter: { from?: string; to?: string }) {
    const rows = await this.list(filter);
    const total = rows.length;
    const fullyReconciled = rows.filter((r) => r.wio_deposit).length;
    const inExchange = rows.filter((r) => r.exchange_settlement && !r.wio_deposit).length;
    const pendingSweep = rows.filter((r) => !r.exchange_settlement && r.crypto_receipt.tx_hash).length;
    const noTxYet = rows.filter((r) => !r.crypto_receipt.tx_hash).length;
    const sumNetAed = rows.reduce((s, r) => s + Number(r.wio_deposit?.net_amount || 0), 0);
    const sumGrossAed = rows.reduce((s, r) => s + Number(r.fiat_conversion?.fiat_received || 0), 0);
    return {
      total_chains: total,
      fully_reconciled: fullyReconciled,
      pending_in_exchange: inExchange,
      pending_sweep: pendingSweep,
      awaiting_payment: noTxYet,
      total_gross_aed: sumGrossAed,
      total_net_aed: sumNetAed,
    };
  }
}
