import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { MagnusSyncLog } from '../entities/magnus-sync-log.entity';
import { ReceivingWallet } from '../entities/receiving-wallet.entity';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { MagnusService } from '../magnus/magnus.service';
import { FxService } from '../fx/fx.service';
import { WalletsService } from '../wallets/wallets.service';
import { OnchainService } from '../onchain/onchain.service';

@Injectable()
export class RechargesService implements OnModuleInit {
  private readonly logger = new Logger('Recharges');
  private refreshTimer: NodeJS.Timeout | null = null;
  constructor(
    @InjectRepository(Recharge) private repo: Repository<Recharge>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(CryptoTransaction) private cryptoRepo: Repository<CryptoTransaction>,
    @InjectRepository(TreasuryMovement) private treasuryRepo: Repository<TreasuryMovement>,
    @InjectRepository(MagnusSyncLog) private magnusLogRepo: Repository<MagnusSyncLog>,
    @InjectRepository(ReceivingWallet) private receivingWalletRepo: Repository<ReceivingWallet>,
    @InjectRepository(WalletLedger) private walletLedgerRepo: Repository<WalletLedger>,
    private audit: AuditService,
    private invoiceSvc: InvoicesService,
    private magnusSvc: MagnusService,
    private fxSvc: FxService,
    private wallets: WalletsService,
    private onchain: OnchainService,
  ) {}

  onModuleInit() {
    // Daily refresh of unconfirmed on-chain TX hashes.
    const ONE_DAY = 24 * 60 * 60 * 1000;
    // Kick off an initial pass shortly after boot (let DB warm up first).
    setTimeout(() => this.refreshUnverifiedOnchainTxs().catch((e) => this.logger.warn(`Onchain refresh failed: ${e?.message}`)), 60 * 1000);
    this.refreshTimer = setInterval(() => {
      this.refreshUnverifiedOnchainTxs().catch((e) => this.logger.warn(`Onchain refresh failed: ${e?.message}`));
    }, ONE_DAY);
  }

  /**
   * Gap-aware next recharge code. Walks current month's prefix and returns
   * the smallest available NNNNN slot. Falls back to MAX + 1.
   */
  private async nextCode() {
    const now = new Date();
    const prefix = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const pattern = `RCH-${prefix}-%`;
    const rows = await this.repo
      .createQueryBuilder('r')
      .select('r.recharge_code', 'recharge_code')
      .where('r.recharge_code LIKE :p', { p: pattern })
      .getRawMany<{ recharge_code: string }>();
    const used = new Set<number>();
    for (const r of rows) {
      const m = String(r.recharge_code || '').match(/(\d+)$/);
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 1;
    while (used.has(n)) n += 1;
    return `RCH-${prefix}-${String(n).padStart(5, '0')}`;
  }

  /**
   * Gap-aware customer code. Smallest free AXC-NNNNN. Used by the webhook
   * auto-creator path; the regular customers.service uses the same algorithm.
   */
  private async nextCustomerCode() {
    const rows = await this.customerRepo
      .createQueryBuilder('c')
      .select('c.customer_code', 'customer_code')
      .where('c.customer_code LIKE :p', { p: 'AXC-%' })
      .getRawMany<{ customer_code: string }>();
    const used = new Set<number>();
    for (const r of rows) {
      const m = String(r.customer_code || '').match(/(\d+)$/);
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 1;
    while (used.has(n)) n += 1;
    return `AXC-${String(n).padStart(5, '0')}`;
  }

  private isWithinInvoiceRefreshWindow(invoice?: Invoice | null) {
    if (!invoice) return false;
    const anchor = invoice.issued_date || invoice.created_at;
    if (!anchor) return false;
    const stamp = new Date(anchor);
    if (Number.isNaN(stamp.getTime())) return false;
    return Date.now() - stamp.getTime() <= 7 * 24 * 60 * 60 * 1000;
  }

  async list(query?: { search?: string; status?: string }) {
    const qb = this.repo.createQueryBuilder('r').leftJoinAndSelect('r.customer', 'c').orderBy('r.created_at', 'DESC');
    if (query?.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query?.search) {
      const s = `%${query.search}%`;
      qb.andWhere('(r.recharge_code ILIKE :s OR r.tx_hash ILIKE :s OR r.invoice_number ILIKE :s OR r.magnus_username ILIKE :s OR c.full_name ILIKE :s)', { s });
    }
    return qb.getMany();
  }

  async get(id: string) {
    const r = await this.repo.findOne({ where: { id }, relations: ['customer'] });
    if (!r) throw new NotFoundException();
    const crypto_tx = await this.cryptoRepo.find({ where: { recharge_id: id }, order: { created_at: 'DESC' } });
    const treasury = await this.treasuryRepo.findOne({ where: { recharge_id: id } });
    const invoice = r.invoice_id ? await this.invoiceRepo.findOne({ where: { id: r.invoice_id } }) : null;
    return { ...r, crypto_transactions: crypto_tx, treasury, invoice };
  }

  async create(data: any, actor?: any) {
    const customer = await this.customerRepo.findOne({ where: { id: data.customer_id } });
    if (!customer) throw new BadRequestException('Customer not found');
    // Detect the receiving wallet → gateway override
    const detected = await this.detectGatewayFromAddress(data.wallet_address);
    const gateway = this.resolveGateway(data.payment_gateway, detected);
    if (gateway === 'Manual') throw new BadRequestException('Manual gateway is no longer supported. Pick Binance, OKX, OxaPay, or BTCPay.');

    // Retry-on-duplicate guard: in rare races, two webhooks can claim the
    // same code/number before we save. Loop a few times with a fresh code
    // each attempt.
    let lastErr: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = await this.nextCode();
      const invoice = await this.invoiceSvc.createForRecharge({
        customer,
        amount: data.amount,
        currency: data.currency || 'USD',
        payment_method: gateway,
        crypto_coin: data.crypto_coin,
        crypto_network: data.crypto_network,
        tx_hash: data.tx_hash,
      });
      const r = this.repo.create({
        recharge_code: code,
        customer_id: customer.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        magnus_username: data.magnus_username || customer.magnus_username,
        amount: data.amount,
        currency: data.currency || 'USD',
        // crypto_amount must reflect ACTUAL coin received — never fall back
        // to fiat `amount` (would make a $232 EUR invoice look like 232 BTC).
        // For off-chain / Binance internal credits the admin can leave it
        // blank; we record `0` then.
        crypto_amount: this.isPositiveNumber(data.crypto_amount) ? data.crypto_amount : '0',
        crypto_coin: data.crypto_coin || 'USDT',
        crypto_network: data.crypto_network || 'TRC20',
        wallet_address: data.wallet_address,
        tx_hash: data.tx_hash,
        payment_gateway: gateway,
        payment_date: data.payment_date || new Date(),
        admin_notes: data.admin_notes,
        status: 'pending_payment',
      });
      try {
        const saved = await this.repo.save(r);
        invoice.recharge_id = saved.id;
        await this.invoiceRepo.save(invoice);

        // Auto-create initial empty treasury movement so chain steps can be filled
        const tm = this.treasuryRepo.create({
          recharge_id: saved.id,
          customer_id: customer.id,
          total_usdt_received: saved.crypto_amount,
          receiving_wallet: saved.wallet_address,
          receiving_wallet_tag: data.wallet_tag,
          receive_tx_hash: saved.tx_hash,
        });
        await this.treasuryRepo.save(tm);

        await this.audit.log({
          actor_id: actor?.id, actor_email: actor?.email,
          action: 'create_recharge', entity_type: 'recharge', entity_id: saved.id,
          details: `Created recharge ${saved.recharge_code} for ${customer.customer_code} amount ${saved.amount} ${saved.currency}`,
        });

        // When the admin supplies a real on-chain TX (missed-webhook backfill),
        // also create the crypto_transactions row + wallet ledger entry. Without
        // this, Treasury "Verify with mempool" returns "No BTC transaction found"
        // and the BTCPay/OxaPay Wallet Ledger never sees the deposit.
        if (saved.tx_hash && this.isPositiveNumber(saved.crypto_amount)) {
          try {
            const dupTx = await this.cryptoRepo.findOne({ where: { tx_hash: saved.tx_hash } });
            if (!dupTx) {
              const tx = this.cryptoRepo.create({
                recharge_id: saved.id, customer_id: customer.id,
                crypto_amount: saved.crypto_amount,
                coin: saved.crypto_coin,
                network: saved.crypto_network,
                receiving_wallet: saved.wallet_address,
                tx_hash: saved.tx_hash,
                received_amount: saved.crypto_amount,
                status: 'received',
                notes: `${gateway} manual backfill (missed webhook)`,
              });
              const savedTx = await this.cryptoRepo.save(tx);
              this.kickoffOnchainVerify(savedTx);
              await this.wallets.recordRechargeDeposit({
                recharge_id: saved.id,
                invoice_id: saved.invoice_id,
                payment_gateway: gateway,
                coin: saved.crypto_coin,
                network: saved.crypto_network,
                amount: String(saved.crypto_amount || '0'),
                tx_hash: saved.tx_hash,
                external_ref: saved.recharge_code,
                counterparty: saved.magnus_username,
                event_at: saved.payment_date,
                notes: `${gateway} manual backfill`,
              }, actor);
            }
          } catch (txErr) {
            this.logger.warn(`Manual TX backfill failed for ${saved.recharge_code}: ${(txErr as any)?.message}`);
          }
        }

        return saved;
      } catch (err: any) {
        const msg = String(err?.message || '');
        const isDupe = msg.includes('duplicate key') || msg.includes('UQ_') || err?.code === '23505';
        if (!isDupe || attempt === 4) {
          lastErr = err;
          // Roll back the invoice that we created in this attempt
          try { await this.invoiceRepo.delete(invoice.id); } catch { /* ignore */ }
          break;
        }
        // Same prefix collided — drop the orphan invoice and try again
        try { await this.invoiceRepo.delete(invoice.id); } catch { /* ignore */ }
        this.logger.warn(`Recharge code/invoice collision on attempt ${attempt + 1}: ${msg}`);
      }
    }
    throw lastErr || new BadRequestException('Could not allocate a unique recharge code');
  }

  // ──────────────────────────────────────────────────────────────────────
  // Split recharges
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Create N sibling recharges from a single on-chain TX shared between
   * multiple Magnus accounts (e.g. 0.0036 BTC arrives, half goes to
   * Martello, half to joker).
   *
   * Guarantees:
   *   • All siblings carry the SAME `split_group_id`, with `split_index`
   *     1..N and `split_total` = N.
   *   • The wallet ledger sees the deposit **once** (via the dedupe-by
   *     tx_hash guard in `recordRechargeDeposit`). The remaining siblings
   *     get linked via a `linked_recharges` JSON note on the ledger row.
   *   • If the sum of share crypto_amounts overshoots the user-provided
   *     `total_crypto_amount` by more than 1 sat (1e-8) we throw — the
   *     UI must round inside the boundary before submitting.
   *   • Idempotent on `tx_hash`: if the TX is already split into the
   *     same set of siblings we no-op and return the existing group.
   */
  async createSplit(data: {
    tx_hash: string;
    total_crypto_amount: string;
    crypto_coin?: string;
    crypto_network?: string;
    wallet_address?: string;
    wallet_tag?: string;
    payment_gateway?: string;
    payment_date?: any;
    admin_notes?: string;
    splits: Array<{
      customer_id?: string;
      magnus_username?: string;
      amount: string;
      currency?: string;
      crypto_share?: string;
    }>;
  }, actor?: any) {
    const tx = (data.tx_hash || '').trim();
    if (!tx) throw new BadRequestException('tx_hash is required for a split recharge');
    if (!Array.isArray(data.splits) || data.splits.length < 2) {
      throw new BadRequestException('A split needs at least 2 customer rows');
    }
    if (!this.isPositiveNumber(data.total_crypto_amount)) {
      throw new BadRequestException('total_crypto_amount must be > 0');
    }

    // Short-circuit if this tx is already a split — return the existing group
    const existing = await this.repo.find({ where: { tx_hash: tx } });
    if (existing.length > 0 && existing[0].split_group_id) {
      this.logger.log(`Split tx ${tx} already recorded as group ${existing[0].split_group_id} — returning ${existing.length} sibling(s)`);
      return { group_id: existing[0].split_group_id, siblings: existing, idempotent: true };
    }
    if (existing.length > 0) {
      throw new BadRequestException(`tx_hash ${tx} is already used by recharge ${existing[0].recharge_code} (non-split). Split aborted.`);
    }

    const totalBtc = parseFloat(data.total_crypto_amount);
    const sumShares = data.splits.reduce((s, r) => s + (parseFloat(r.crypto_share || '0') || 0), 0);
    if (sumShares > totalBtc + 1e-8) {
      throw new BadRequestException(`Sum of shares (${sumShares.toFixed(8)}) exceeds total (${totalBtc.toFixed(8)})`);
    }

    // Auto-derive equal shares if any are missing
    const N = data.splits.length;
    const equalShare = (totalBtc / N).toFixed(8);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomUUID } = require('crypto');
    const groupId: string = randomUUID();
    const gateway = this.resolveGateway(data.payment_gateway, await this.detectGatewayFromAddress(data.wallet_address));
    if (gateway === 'Manual') throw new BadRequestException('Manual gateway is not supported. Pick Binance, OKX, OxaPay, or BTCPay.');

    const created: Recharge[] = [];
    for (let i = 0; i < data.splits.length; i += 1) {
      const split = data.splits[i];
      const customer = await this.resolveCustomerForSplit(split);
      const shareCrypto = this.isPositiveNumber(split.crypto_share) ? split.crypto_share! : equalShare;

      // Build the per-sibling recharge via the same `create()` flow so we
      // get a fresh invoice + treasury_movement + audit log per row.
      // We pass an empty crypto_amount for siblings #2..N so `create()` does
      // NOT call recordRechargeDeposit a second time; we then patch the
      // split markers + crypto_amount + manual ledger linkage below.
      const isFirst = i === 0;
      const sibling = await this.create({
        customer_id: customer.id,
        magnus_username: split.magnus_username || customer.magnus_username,
        amount: split.amount,
        currency: split.currency || 'EUR',
        // Only the first sibling carries the crypto_amount so the deposit
        // is booked in the ledger exactly once. Siblings #2..N start with
        // '0' so they don't trigger a duplicate ledger row. We patch the
        // real share AFTER save() so per-recharge crypto_amount is accurate.
        crypto_amount: isFirst ? shareCrypto : '0',
        crypto_coin: data.crypto_coin || 'BTC',
        crypto_network: data.crypto_network || 'BTC',
        wallet_address: data.wallet_address,
        wallet_tag: data.wallet_tag,
        payment_gateway: gateway,
        payment_date: data.payment_date || new Date(),
        // tx_hash on the first sibling only — siblings get the same hash
        // patched in below (after the ledger row is created), so the
        // dedupe guard does not block them.
        tx_hash: isFirst ? tx : null,
        admin_notes: data.admin_notes
          ? `${data.admin_notes} [split ${i + 1}/${N}]`
          : `Split ${i + 1}/${N} of TX ${tx.slice(0, 12)}…`,
      }, actor);

      sibling.split_group_id = groupId;
      sibling.split_index = i + 1;
      sibling.split_total = N;
      sibling.tx_hash = tx;
      // Patch real crypto_amount (the create() call left siblings #2..N at 0)
      sibling.crypto_amount = shareCrypto;
      await this.repo.save(sibling);

      // Patch the treasury_movement so the recorded total_usdt_received
      // matches the share (otherwise siblings #2..N have 0 in treasury).
      await this.treasuryRepo.update({ recharge_id: sibling.id }, {
        total_usdt_received: shareCrypto,
        receive_tx_hash: tx,
      });

      created.push(sibling);
    }

    // Attach split-group context to the single ledger deposit row (sibling #1)
    try {
      const ledgerRow = await this.walletLedgerRepo.findOne({
        where: { tx_hash: tx, tx_type: 'deposit' as any },
      });
      if (ledgerRow) {
        const allRefs = created.map((c) => c.recharge_code).join(', ');
        ledgerRow.external_ref = `SPLIT-${groupId.slice(0, 8)} (${allRefs})`;
        ledgerRow.notes = `Split ${N}-way: ${created.map((c) => `${c.magnus_username}=${c.amount} ${c.currency}`).join(' | ')}`;
        await this.walletLedgerRepo.save(ledgerRow);
      }
    } catch (e) {
      this.logger.warn(`Could not attach split context to ledger row for ${tx}: ${(e as any)?.message}`);
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_split_recharge', entity_type: 'recharge', entity_id: created[0].id,
      details: `Split ${N}-way (group ${groupId}) for TX ${tx}: ${created.map((c) => c.recharge_code).join(', ')}`,
    });

    return { group_id: groupId, siblings: created, idempotent: false };
  }

  /**
   * Backfill helper for the iter-26 incident: existing recharge `id` is the
   * first half of a split; this endpoint creates the missing sibling(s)
   * WITHOUT triggering a duplicate ledger row. Use it when the bot only
   * recorded one half of a 1/N split.
   */
  async addSplitSibling(rechargeId: string, data: {
    magnus_username?: string;
    customer_id?: string;
    amount: string;
    currency?: string;
    crypto_share?: string;
    split_total?: number;
  }, actor?: any) {
    const existing = await this.repo.findOne({ where: { id: rechargeId } });
    if (!existing) throw new NotFoundException('Source recharge not found');
    if (!existing.tx_hash) throw new BadRequestException('Source recharge has no tx_hash');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomUUID } = require('crypto');
    const groupId = existing.split_group_id || randomUUID();
    let total = existing.split_total || data.split_total || 2;
    const currentSiblings = await this.repo.find({ where: { tx_hash: existing.tx_hash } });
    if (currentSiblings.length >= total) {
      total = currentSiblings.length + 1;
    }

    // Promote the existing recharge to a split group if it wasn't already
    if (!existing.split_group_id) {
      existing.split_group_id = groupId;
      existing.split_index = 1;
      existing.split_total = total;
      await this.repo.save(existing);
    }

    const customer = await this.resolveCustomerForSplit({
      customer_id: data.customer_id,
      magnus_username: data.magnus_username,
    });

    const sibling = await this.create({
      customer_id: customer.id,
      magnus_username: data.magnus_username || customer.magnus_username,
      amount: data.amount,
      currency: data.currency || existing.currency,
      crypto_amount: '0', // never create a duplicate ledger row
      crypto_coin: existing.crypto_coin,
      crypto_network: existing.crypto_network,
      wallet_address: existing.wallet_address,
      payment_gateway: existing.payment_gateway,
      payment_date: existing.payment_date,
      tx_hash: null, // patched below
      admin_notes: `Backfilled split sibling of ${existing.recharge_code} (TX ${existing.tx_hash.slice(0, 12)}…)`,
    }, actor);

    const nextIndex = currentSiblings.length + 1;
    sibling.split_group_id = groupId;
    sibling.split_index = nextIndex;
    sibling.split_total = total;
    sibling.tx_hash = existing.tx_hash;
    sibling.crypto_amount = data.crypto_share || '0';
    await this.repo.save(sibling);
    await this.treasuryRepo.update({ recharge_id: sibling.id }, {
      total_usdt_received: data.crypto_share || '0',
      receive_tx_hash: existing.tx_hash,
    });

    // Update ALL siblings' split_total so they agree
    await this.repo.update({ split_group_id: groupId }, { split_total: total });

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'backfill_split_sibling', entity_type: 'recharge', entity_id: sibling.id,
      details: `Added split sibling ${sibling.recharge_code} (${nextIndex}/${total}) for ${existing.recharge_code} TX ${existing.tx_hash}`,
    });

    return { sibling, group_id: groupId };
  }

  private async resolveCustomerForSplit(split: { customer_id?: string; magnus_username?: string }): Promise<Customer> {
    if (split.customer_id) {
      const c = await this.customerRepo.findOne({ where: { id: split.customer_id } });
      if (c) return c;
    }
    if (split.magnus_username) {
      const c = await this.customerRepo
        .createQueryBuilder('c')
        .where('LOWER(c.magnus_username) = LOWER(:u)', { u: split.magnus_username })
        .getOne();
      if (c) return c;
    }
    throw new BadRequestException(`No customer found for split row (magnus_username=${split.magnus_username || '—'})`);
  }

  /**
   * Idempotently heal a TX whose split siblings were recorded as
   * independent recharges (each booked its own ledger row, often into
   * the WRONG wallet — e.g. a Binance TX showing up partly on BTCPAY).
   *
   * Picks the ledger row sitting on `primary_wallet` (auto-detected from
   * the receiving address if not provided) as the canonical one. Sets
   * its amount to the SUM of all sibling shares (the true on-chain
   * deposit), wipes every other ledger row sharing the same tx_hash,
   * and stamps split_group_id / split_index / split_total on each
   * recharge so they show as a group in the UI.
   *
   * Safe to re-run: detects when the group is already healed and
   * returns { healed: false, group_id } without further mutation.
   */
  async healSplitByTxHash(body: { tx_hash: string; primary_wallet?: string }, actor?: any) {
    const tx = (body.tx_hash || '').trim();
    if (!tx) throw new BadRequestException('tx_hash is required');

    const siblings = await this.repo.find({ where: { tx_hash: tx }, order: { created_at: 'ASC' } });
    if (siblings.length < 2) {
      throw new BadRequestException(`Only ${siblings.length} recharge(s) found for TX ${tx} — need at least 2 to heal`);
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomUUID } = require('crypto');
    const N = siblings.length;
    const totalCrypto = siblings.reduce((s, r) => s + (parseFloat(r.crypto_amount || '0') || 0), 0);
    const totalFiat = siblings.reduce((s, r) => s + (parseFloat(r.amount || '0') || 0), 0);

    const ledgerRows = await this.walletLedgerRepo.find({ where: { tx_hash: tx, tx_type: 'deposit' as any } });
    if (ledgerRows.length === 0) {
      throw new BadRequestException(`No deposit ledger rows for TX ${tx} — nothing to heal`);
    }

    // Pick the primary ledger row: explicit override > detected wallet > first row by event_at
    let primaryWallet = body.primary_wallet;
    if (!primaryWallet) {
      const firstWalletAddr = siblings.find((s) => s.wallet_address)?.wallet_address;
      if (firstWalletAddr) {
        const detected = await this.detectGatewayFromAddress(firstWalletAddr);
        if (detected) {
          primaryWallet = ({ Binance: 'BINANCE', OKX: 'OKX', OxaPay: 'OXAPAY', BTCPay: 'BTCPAY' } as any)[detected] || null;
        }
      }
    }
    let primary = primaryWallet ? ledgerRows.find((r) => r.wallet === primaryWallet) : null;
    if (!primary) primary = ledgerRows.sort((a, b) => +new Date(a.event_at || 0) - +new Date(b.event_at || 0))[0];
    const otherLedgerRows = ledgerRows.filter((r) => r.id !== primary!.id);

    const alreadyHealed = siblings.every((s) => s.split_group_id)
      && siblings.every((s) => s.split_total === N)
      && Math.abs(parseFloat(primary.amount || '0') - totalCrypto) < 1e-9
      && otherLedgerRows.length === 0;
    if (alreadyHealed) {
      return { healed: false, group_id: siblings[0].split_group_id, siblings: siblings.length, total_crypto: totalCrypto };
    }

    const groupId = siblings.find((s) => s.split_group_id)?.split_group_id || randomUUID();
    // Stamp split markers
    for (let i = 0; i < siblings.length; i += 1) {
      siblings[i].split_group_id = groupId;
      siblings[i].split_index = i + 1;
      siblings[i].split_total = N;
      await this.repo.save(siblings[i]);
    }

    // Bump primary ledger row to the actual on-chain total
    const refsList = siblings.map((s) => s.recharge_code).join(', ');
    const counterpartiesList = siblings.map((s) => `${s.magnus_username}=${s.amount} ${s.currency}`).join(' | ');
    primary.amount = totalCrypto.toFixed(8);
    primary.external_ref = `SPLIT-${groupId.slice(0, 8)} (${refsList})`;
    primary.counterparty = siblings.map((s) => s.magnus_username).join(' + ');
    primary.notes = `Healed split ${N}-way: ${counterpartiesList}`;
    await this.walletLedgerRepo.save(primary);

    // Wipe the duplicate ledger rows on other wallets
    for (const dup of otherLedgerRows) {
      await this.walletLedgerRepo.delete(dup.id);
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'heal_split_recharge', entity_type: 'recharge', entity_id: siblings[0].id,
      details: `Healed TX ${tx} (${N}-way): group ${groupId}, total=${totalCrypto.toFixed(8)} ${siblings[0].crypto_coin}, fiat=${totalFiat.toFixed(2)} ${siblings[0].currency}; removed ${otherLedgerRows.length} dup ledger row(s)`,
    });

    return {
      healed: true,
      group_id: groupId,
      siblings_count: N,
      total_crypto: totalCrypto,
      total_fiat: totalFiat,
      primary_wallet: primary.wallet,
      removed_duplicate_ledger_rows: otherLedgerRows.length,
    };
  }

  /**
   * Bulk healing — discovers every tx_hash with > 1 recharge and runs
   * healSplitByTxHash on each. Use this once to fix a database that
   * never went through the proper split endpoint. Idempotent.
   */
  async healAllSplits(actor?: any) {
    const rows = await this.repo
      .createQueryBuilder('r')
      .select('r.tx_hash', 'tx_hash')
      .addSelect('COUNT(*)', 'cnt')
      .where('r.tx_hash IS NOT NULL')
      .andWhere("r.tx_hash <> ''")
      .groupBy('r.tx_hash')
      .having('COUNT(*) > 1')
      .getRawMany<{ tx_hash: string; cnt: string }>();
    const results = [] as any[];
    for (const row of rows) {
      try {
        const result = await this.healSplitByTxHash({ tx_hash: row.tx_hash }, actor);
        results.push({ tx_hash: row.tx_hash, ...result });
      } catch (e) {
        results.push({ tx_hash: row.tx_hash, error: (e as any)?.message });
      }
    }
    return { processed: rows.length, results };
  }

  async createFromGatewayPayment(data: any, actor?: any) {
    const customer = await this.findOrCreateCustomerFromPayment(data);
    const existingTx = data.tx_hash?.trim()
      ? await this.cryptoRepo.findOne({ where: { tx_hash: data.tx_hash.trim() } })
      : null;
    if (existingTx) return this.applyGatewayPayment(existingTx.recharge_id, data, actor);

    // Merge into a matching PENDING placeholder if one exists. This
    // avoids creating duplicate rows when a Telegram bot first announces
    // a payment (no tx_hash) and then the actual on-chain TX webhook
    // arrives — we now update the placeholder instead of forking a new
    // recharge that would later show as "Pending Payment" forever.
    const pendingMatch = await this.findPendingMergeCandidate(customer.id, data);
    if (pendingMatch) {
      this.logger.log(`Merging incoming gateway payment into pending recharge ${pendingMatch.recharge_code} (customer=${customer.customer_code}, amount=${data.amount} ${data.currency || ''})`);
      const merged = await this.applyGatewayPayment(pendingMatch.id, data, actor);
      if (data.magnus_credit_added || data.magnus_reference_id) {
        const latest = await this.repo.findOne({ where: { id: pendingMatch.id } });
        if (latest?.tx_hash) {
          await this.syncMagnus(pendingMatch.id, {
            magnus_credit_added: data.magnus_credit_added || data.amount,
            magnus_reference_id: data.magnus_reference_id,
          }, actor);
        }
      }
      return merged;
    }

    const recharge = await this.create({
      customer_id: customer.id,
      magnus_username: data.magnus_username || customer.magnus_username,
      amount: data.amount,
      currency: data.currency || 'USD',
      crypto_amount: '0',
      crypto_coin: data.crypto_coin || data.coin || 'BTC',
      crypto_network: data.crypto_network || data.network || data.coin || 'BTC',
      wallet_address: data.wallet_address || data.receiving_wallet,
      payment_gateway: data.payment_gateway || this.inferGatewayFromWallet(data) || 'Binance',
      payment_date: data.payment_date || data.paid_at || new Date(),
      admin_notes: data.admin_notes,
    }, actor);

    if (data.tx_hash || data.gateway_transactions?.length) {
      await this.addGatewayCryptoTx(recharge.id, { ...data, received_wallet: data.received_wallet, wallet_tag: data.wallet_tag }, actor);
    }
    if (data.magnus_credit_added || data.magnus_reference_id) {
      const latest = await this.repo.findOne({ where: { id: recharge.id } });
      if (latest?.tx_hash) {
        await this.syncMagnus(recharge.id, {
          magnus_credit_added: data.magnus_credit_added || data.amount,
          magnus_reference_id: data.magnus_reference_id,
        }, actor);
      } else if (latest) {
        latest.magnus_credit_added = data.magnus_credit_added || data.amount;
        latest.magnus_reference_id = data.magnus_reference_id || `MAG-WEBHOOK-${Date.now()}`;
        latest.magnus_credited_at = new Date();
        latest.status = 'mismatch';
        latest.reconciliation_note = 'Magnus credit reported by webhook, but customer payment TX hash is missing';
        await this.repo.save(latest);
      }
    }
    return this.get(recharge.id);
  }

  /**
   * Find a pending recharge that an incoming webhook should attach itself
   * to instead of forking a duplicate. Matches by customer + amount +
   * currency, prefers the row that already has no tx_hash, restricted to
   * the last 30 days so we never reopen ancient placeholders.
   */
  private async findPendingMergeCandidate(customerId: string, data: any) {
    const amount = parseFloat(String(data.amount || '0'));
    if (!customerId || !Number.isFinite(amount) || amount <= 0) return null;
    const currency = String(data.currency || 'USD').toUpperCase();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.customer_id = :customer', { customer: customerId })
      .andWhere('r.status = :pending', { pending: 'pending_payment' })
      .andWhere('UPPER(r.currency) = :currency', { currency })
      .andWhere('ABS(r.amount::numeric - :amount::numeric) < 0.01', { amount })
      .andWhere("(r.tx_hash IS NULL OR r.tx_hash = '')")
      .andWhere('r.created_at >= :since', { since })
      .orderBy('r.created_at', 'DESC');
    return qb.getOne();
  }

  async applyGatewayPayment(rechargeId: string, data: any, actor?: any) {
    const recharge = await this.repo.findOne({ where: { id: rechargeId } });
    if (!recharge) throw new NotFoundException('Recharge not found');

    if (data.wallet_address && !recharge.wallet_address) recharge.wallet_address = data.wallet_address;
    if (data.payment_date) recharge.payment_date = data.payment_date;
    if (data.admin_notes) {
      recharge.admin_notes = recharge.admin_notes
        ? `${recharge.admin_notes}\n${data.admin_notes}`
        : data.admin_notes;
    }
    await this.repo.save(recharge);

    let existingTx = null;
    if (data.tx_hash?.trim()) {
      existingTx = await this.cryptoRepo.findOne({ where: { tx_hash: data.tx_hash.trim() } });
      if (!existingTx) {
        await this.addGatewayCryptoTx(recharge.id, data, actor);
      } else if (data.gateway_transactions?.length) {
        await this.addGatewayCryptoTx(recharge.id, data, actor);
      }
    } else if (data.gateway_transactions?.length) {
      await this.addGatewayCryptoTx(recharge.id, data, actor);
    }

    const latest = await this.repo.findOne({ where: { id: recharge.id } });
    if (!latest) throw new NotFoundException('Recharge not found after update');

    if ((data.paid || data.magnus_credit_added || data.magnus_reference_id) && latest.tx_hash) {
      const needsMagnusSync = !latest.magnus_credited_at
        || latest.status === 'mismatch'
        || (data.magnus_reference_id && data.magnus_reference_id !== latest.magnus_reference_id);
      if (needsMagnusSync) {
        await this.syncMagnus(recharge.id, {
          magnus_credit_added: data.magnus_credit_added || latest.amount,
          magnus_reference_id: data.magnus_reference_id,
        }, actor);
      }
    }

    return this.get(recharge.id);
  }

  async ensureCustomerFromGatewayPayment(data: any, actor?: any) {
    const customer = await this.findOrCreateCustomerFromPayment(data);
    await this.audit.log({
      actor_id: actor?.id,
      actor_email: actor?.email,
      action: 'ensure_customer_from_webhook',
      entity_type: 'customer',
      entity_id: customer.id,
      details: `Ensured customer ${customer.customer_code} from ${data.payment_gateway || 'gateway'} invoice event`,
    });
    return customer;
  }

  /**
   * Hard-delete a recharge AND its entire downstream chain:
   *   crypto_transactions + treasury_movement + wallet_ledger rows + linked invoice.
   * Use this to clean up test data. Audit-logged.
   */
  async delete(id: string, actor?: any) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    // Wallet ledger rows tagged with this recharge (deposits, expenses, etc.)
    await this.walletLedgerRepo.delete({ linked_recharge_id: id });
    // Treasury-movement fan-out ledger rows (external_ref-tagged)
    await this.wallets.dropMovementLedger(id);
    // Crypto transactions (children)
    await this.cryptoRepo.delete({ recharge_id: id });
    // Treasury movement (1:1)
    await this.treasuryRepo.delete({ recharge_id: id });
    // Magnus sync logs (audit trail of this recharge's Magnus credits)
    await this.magnusLogRepo.delete({ recharge_id: id });
    // The linked invoice (auto-created with the recharge)
    if (r.invoice_id) {
      try { await this.invoiceRepo.delete(r.invoice_id); } catch { /* ignore if already gone */ }
    }
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_recharge', entity_type: 'recharge', entity_id: id,
      details: `Deleted recharge ${r.recharge_code} and its full chain`,
    });
    return { success: true, recharge_code: r.recharge_code };
  }

  async updateStatus(id: string, status: string, note?: string, actor?: any) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    if (!['refunded', 'failed'].includes(status)) {
      throw new BadRequestException('Recharge chain statuses advance only from recorded payment, Magnus, OKX, and Wio evidence');
    }
    r.status = status as any;
    r.reconciled = false;
    if (note) r.reconciliation_note = note;
    const saved = await this.repo.save(r);
    if (r.invoice_id) {
      const invoice = await this.invoiceRepo.findOne({ where: { id: r.invoice_id } });
      if (invoice && this.isWithinInvoiceRefreshWindow(invoice)) {
        invoice.status = status;
        await this.invoiceRepo.save(invoice);
      }
    }
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_recharge_status', entity_type: 'recharge', entity_id: id,
      details: `Status -> ${status}${note ? ' | ' + note : ''}`,
    });
    return saved;
  }

  async addCryptoTx(id: string, data: any, actor?: any) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    const invoice = r.invoice_id ? await this.invoiceRepo.findOne({ where: { id: r.invoice_id } }) : null;
    if (!invoice) throw new BadRequestException('Invoice is required before recording payment');
    if (Math.abs(parseFloat(invoice.amount) - parseFloat(r.amount)) >= 0.01) {
      throw new BadRequestException('Invoice amount does not match recharge amount');
    }
    if (!data.tx_hash?.trim()) throw new BadRequestException('Payment TX hash is required');
    // Either an on-chain receiving address OR an explicit ledger wallet code must be present.
    if (!data.receiving_wallet?.trim() && !data.received_wallet) {
      throw new BadRequestException('Either receiving address or destination wallet (Binance/OKX/…) is required');
    }
    if (!this.isPositiveNumber(data.crypto_amount || r.crypto_amount)) throw new BadRequestException('Crypto amount must be greater than zero');
    // AED values: auto-compute from FX feed if not provided
    const aed = await this.resolveAedValues(data, r);
    const existingTx = await this.cryptoRepo.findOne({ where: { tx_hash: data.tx_hash.trim() } });
    if (existingTx) throw new BadRequestException('Payment TX hash is already recorded');
    const tx = this.cryptoRepo.create({
      recharge_id: id, customer_id: r.customer_id,
      crypto_amount: data.crypto_amount || r.crypto_amount,
      coin: data.coin || r.crypto_coin,
      network: data.network || r.crypto_network,
      receiving_wallet: data.receiving_wallet || data.received_wallet,
      receiving_wallet_tag: data.received_wallet || data.wallet_tag,
      tx_hash: data.tx_hash.trim(),
      wallet_balance_after: data.wallet_balance_after,
      aed_rate_at_payment: aed.rate,
      aed_value: aed.value,
      // Capture auto-conversion data when the gateway already swapped to USDT
      // (OxaPay flow). The original coin stays in `coin`/`crypto_amount`; the
      // converted USDT lands in `final_usdt_amount`.
      received_amount: data.received_amount || data.crypto_amount || r.crypto_amount,
      final_usdt_amount: data.final_usdt_amount || undefined,
      status: 'received',
      notes: data.notes,
    });
    const saved = await this.cryptoRepo.save(tx);
    if (!r.tx_hash) r.tx_hash = saved.tx_hash;
    r.status = 'payment_received';
    await this.repo.save(r);
    invoice.tx_hash = saved.tx_hash;
    invoice.status = 'paid';
    await this.invoiceRepo.save(invoice);
    this.kickoffOnchainVerify(saved);
    const treasury = await this.treasuryRepo.findOne({ where: { recharge_id: id } });
    if (treasury) {
      treasury.total_usdt_received = saved.crypto_amount;
      treasury.receiving_wallet = saved.receiving_wallet;
      treasury.receive_tx_hash = saved.tx_hash;
      await this.treasuryRepo.save(treasury);
    }
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'add_crypto_tx', entity_type: 'recharge', entity_id: id,
      details: `Crypto TX recorded ${saved.tx_hash}`,
    });
    // Determine ledger row coin/amount: if the gateway auto-converted to USDT,
    // the wallet balance reflects USDT; the original coin is kept for audit.
    const manualAutoConverted = !!(saved.final_usdt_amount && (saved.coin || '').toUpperCase() !== 'USDT');
    const ledgerAmount = manualAutoConverted ? saved.final_usdt_amount : saved.crypto_amount;
    const ledgerCoin = manualAutoConverted ? 'USDT' : (saved.coin || r.crypto_coin);
    await this.wallets.recordRechargeDeposit({
      recharge_id: id,
      invoice_id: r.invoice_id,
      payment_gateway: r.payment_gateway,
      coin: ledgerCoin,
      network: saved.network || r.crypto_network,
      amount: String(ledgerAmount || '0'),
      original_coin: manualAutoConverted ? saved.coin : undefined,
      original_amount: manualAutoConverted ? String(saved.crypto_amount || '0') : undefined,
      tx_hash: saved.tx_hash,
      external_ref: r.recharge_code,
      counterparty: r.magnus_username,
      aed_value: saved.aed_value,
      event_at: r.payment_date,
      notes: `${r.payment_gateway} manual deposit`,
      received_wallet: data.received_wallet,
      wallet_tag: data.wallet_tag,
    }, actor);
    return saved;
  }

  private gatewayTransactions(data: any, recharge: Recharge) {
    if (Array.isArray(data.gateway_transactions) && data.gateway_transactions.length) {
      return data.gateway_transactions.map((tx: any) => ({
        tx_hash: tx.tx_hash,
        crypto_amount: tx.received_amount || tx.sent_amount || tx.value || data.crypto_amount || recharge.crypto_amount,
        coin: tx.currency || data.coin || data.crypto_coin || recharge.crypto_coin,
        network: tx.network || data.network || data.crypto_network || recharge.crypto_network,
        receiving_wallet: tx.address || data.receiving_wallet || data.wallet_address || recharge.wallet_address,
        sender_address: tx.sender_address,
        gateway_tx_status: tx.status,
        sent_amount: tx.sent_amount,
        sent_value: tx.sent_value,
        received_amount: tx.received_amount,
        received_value: tx.value,
        gateway_rate: tx.rate,
        confirmations: tx.confirmations,
        auto_convert_amount: tx.auto_convert_amount,
        auto_convert_currency: tx.auto_convert_currency,
        final_usdt_amount: tx.final_usdt_amount,
        gateway_track_id: data.gateway_track_id,
        raw_gateway_payload: tx.raw ? JSON.stringify(tx.raw) : undefined,
        payment_date: this.parseDate(tx.date) || data.payment_date || data.paid_at || new Date(),
      }));
    }

    return [{
      tx_hash: data.tx_hash,
      crypto_amount: data.crypto_amount || recharge.crypto_amount,
      coin: data.coin || data.crypto_coin || recharge.crypto_coin,
      network: data.network || data.crypto_network || recharge.crypto_network,
      receiving_wallet: data.receiving_wallet || data.wallet_address || recharge.wallet_address,
      // Either the client tells us the auto-converted USDT directly (OxaPay manual entry)
      // or we infer it for USDT-native payments (1:1).
      final_usdt_amount: data.final_usdt_amount
        ? String(data.final_usdt_amount)
        : (String(data.coin || data.crypto_coin || recharge.crypto_coin).toUpperCase() === 'USDT'
          ? String(data.crypto_amount || recharge.crypto_amount || '')
          : undefined),
      received_amount: data.received_amount || data.crypto_amount || recharge.crypto_amount,
      gateway_track_id: data.gateway_track_id,
      payment_date: data.payment_date || data.paid_at || new Date(),
    }];
  }

  private parseDate(value: any) {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value < 10000000000 ? value * 1000 : value);
    if (/^\d+$/.test(String(value))) {
      const n = Number(value);
      return new Date(n < 10000000000 ? n * 1000 : n);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private sourceSummary(transactions: CryptoTransaction[]) {
    const groups = new Map<string, number>();
    for (const tx of transactions) {
      const key = `${tx.coin || 'Crypto'} ${tx.network || ''}`.trim();
      groups.set(key, (groups.get(key) || 0) + parseFloat(tx.crypto_amount || '0'));
    }
    return [...groups.entries()]
      .map(([key, value]) => `${value.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${key}`)
      .join(', ');
  }

  private sumFinalUsdt(transactions: CryptoTransaction[]) {
    return transactions.reduce((sum, tx) => {
      const finalUsdt = parseFloat(tx.final_usdt_amount || '0');
      if (Number.isFinite(finalUsdt) && finalUsdt > 0) return sum + finalUsdt;
      if ((tx.coin || '').toUpperCase() === 'USDT') return sum + parseFloat(tx.received_amount || tx.crypto_amount || '0');
      return sum;
    }, 0);
  }

  private async addGatewayCryptoTx(id: string, data: any, actor?: any) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    const invoice = r.invoice_id ? await this.invoiceRepo.findOne({ where: { id: r.invoice_id } }) : null;
    if (!invoice) throw new BadRequestException('Invoice is required before recording payment');

    const incoming = this.gatewayTransactions(data, r)
      .filter((tx) => tx.tx_hash?.trim() && this.isPositiveNumber(tx.crypto_amount));
    if (!incoming.length) throw new BadRequestException('At least one payment TX hash and crypto amount is required');

    const aed = await this.resolveAedValues(data, r);
    const savedTransactions: CryptoTransaction[] = [];

    for (const item of incoming) {
      const existingTx = await this.cryptoRepo.findOne({ where: { tx_hash: item.tx_hash.trim() } });
      if (existingTx) {
        let changed = false;
        for (const key of [
          'gateway_tx_status', 'sender_address', 'sent_amount', 'sent_value', 'received_amount',
          'received_value', 'gateway_rate', 'confirmations', 'auto_convert_amount',
          'auto_convert_currency', 'final_usdt_amount', 'raw_gateway_payload',
        ]) {
          if ((item as any)[key] !== undefined && (existingTx as any)[key] !== (item as any)[key]) {
            (existingTx as any)[key] = (item as any)[key];
            changed = true;
          }
        }
        if (changed) await this.cryptoRepo.save(existingTx);
        savedTransactions.push(existingTx);
        continue;
      }

      const tx = this.cryptoRepo.create({
        recharge_id: id,
        customer_id: r.customer_id,
        crypto_amount: item.crypto_amount,
        coin: item.coin,
        network: item.network,
        receiving_wallet: item.receiving_wallet,
        receiving_wallet_tag: data.wallet_tag,
        tx_hash: item.tx_hash.trim(),
        gateway_invoice_id: data.gateway_invoice_id,
        gateway_track_id: item.gateway_track_id,
        gateway_tx_status: item.gateway_tx_status,
        sender_address: item.sender_address,
        sent_amount: item.sent_amount,
        sent_value: item.sent_value,
        received_amount: item.received_amount,
        received_value: item.received_value,
        gateway_rate: item.gateway_rate,
        confirmations: item.confirmations ? String(item.confirmations) : undefined,
        auto_convert_amount: item.auto_convert_amount,
        auto_convert_currency: item.auto_convert_currency,
        final_usdt_amount: item.final_usdt_amount,
        raw_gateway_payload: item.raw_gateway_payload,
        wallet_balance_after: data.wallet_balance_after,
        aed_rate_at_payment: aed.rate,
        aed_value: aed.value,
        status: 'received',
        notes: data.notes || `${data.payment_gateway || r.payment_gateway} webhook payment`,
      });
      savedTransactions.push(await this.cryptoRepo.save(tx));
    }

    for (const tx of savedTransactions) {
      this.kickoffOnchainVerify(tx);
    }

    const allTransactions = await this.cryptoRepo.find({ where: { recharge_id: id }, order: { created_at: 'ASC' } });
    const totalUsdt = this.sumFinalUsdt(allTransactions);
    const sourceSummary = this.sourceSummary(allTransactions);
    const primaryTx = allTransactions[0] || savedTransactions[0];
    r.tx_hash = primaryTx?.tx_hash || r.tx_hash;
    r.crypto_amount = totalUsdt > 0
      ? totalUsdt.toFixed(8)
      : allTransactions.reduce((sum, tx) => sum + parseFloat(tx.crypto_amount || '0'), 0).toFixed(8);
    if (totalUsdt > 0) {
      r.crypto_coin = 'USDT';
      r.crypto_network = data.crypto_network || r.crypto_network;
    } else if (primaryTx) {
      r.crypto_coin = primaryTx.coin || r.crypto_coin;
      r.crypto_network = primaryTx.network || r.crypto_network;
    }
    r.payment_date = data.payment_date || data.paid_at || new Date();
    if (![
      'magnus_credited',
      'sent_to_okx',
      'converted_to_aed',
      'deposited_to_wio',
      'fully_reconciled',
    ].includes(r.status)) {
      r.status = 'payment_received';
    }
    r.reconciliation_note = aed.value ? null : 'Payment received but AED value at payment time is missing';
    await this.repo.save(r);
    invoice.tx_hash = r.tx_hash;
    invoice.crypto_coin = totalUsdt > 0 ? 'USDT' : invoice.crypto_coin;
    invoice.crypto_network = totalUsdt > 0 ? 'OxaPay Auto Convert' : invoice.crypto_network;
    invoice.status = 'paid';
    await this.invoiceRepo.save(invoice);
    const treasury = await this.treasuryRepo.findOne({ where: { recharge_id: id } });
    if (treasury) {
      treasury.total_usdt_received = r.crypto_amount;
      treasury.source_currency_summary = sourceSummary;
      treasury.source_transaction_details = JSON.stringify(allTransactions.map((tx) => ({
        tx_hash: tx.tx_hash,
        coin: tx.coin,
        network: tx.network,
        sent_amount: tx.sent_amount,
        received_amount: tx.received_amount,
        final_usdt_amount: tx.final_usdt_amount,
        sender_address: tx.sender_address,
        receiving_wallet: tx.receiving_wallet,
        confirmations: tx.confirmations,
        status: tx.gateway_tx_status,
      })));
      treasury.receiving_wallet = primaryTx?.receiving_wallet || treasury.receiving_wallet;
      treasury.receiving_wallet_tag = data.wallet_tag || treasury.receiving_wallet_tag;
      treasury.receive_tx_hash = r.tx_hash;
      await this.treasuryRepo.save(treasury);
    }
    await this.audit.log({
      actor_id: actor?.id,
      actor_email: actor?.email,
      action: 'gateway_crypto_tx',
      entity_type: 'recharge',
      entity_id: id,
      details: `Gateway crypto TX recorded ${savedTransactions.map((tx) => tx.tx_hash).join(', ')}`,
    });

    // Wallet ledger deposit (idempotent on tx_hash + recharge)
    for (const tx of savedTransactions) {
      const autoConverted = !!(tx.final_usdt_amount && (tx.coin || '').toUpperCase() !== 'USDT');
      const depositAmount = autoConverted ? tx.final_usdt_amount : (tx.received_amount || tx.crypto_amount);
      const depositCoin = autoConverted ? 'USDT' : tx.coin;
      await this.wallets.recordRechargeDeposit({
        recharge_id: id,
        invoice_id: r.invoice_id,
        payment_gateway: data.payment_gateway || r.payment_gateway,
        coin: depositCoin || 'USDT',
        network: tx.network || r.crypto_network,
        amount: String(depositAmount || '0'),
        // Audit trail: keep the original coin/amount the customer paid in
        original_coin: autoConverted ? tx.coin : undefined,
        original_amount: autoConverted ? String(tx.received_amount || tx.crypto_amount || '0') : undefined,
        tx_hash: tx.tx_hash,
        external_ref: r.recharge_code,
        counterparty: r.magnus_username,
        aed_value: tx.aed_value,
        event_at: r.payment_date || new Date(),
        notes: `${data.payment_gateway || r.payment_gateway} deposit`,
      }, actor);
    }

    return savedTransactions[0];
  }

  async syncMagnus(id: string, data: any, actor?: any) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    if (!r.tx_hash) throw new BadRequestException('Record a verified payment TX hash before Magnus credit');
    const invoice = r.invoice_id ? await this.invoiceRepo.findOne({ where: { id: r.invoice_id } }) : null;
    if (!invoice) throw new BadRequestException('Invoice is required before Magnus credit');
    r.magnus_credit_added = data.magnus_credit_added || r.amount;
    r.magnus_reference_id = data.magnus_reference_id || `MAG-${Date.now()}`;
    r.magnus_credited_at = new Date();
    // Match check
    const amt = parseFloat(invoice.amount);
    const credit = parseFloat(r.magnus_credit_added);
    const match = Math.abs(amt - credit) < 0.01;
    if (match) {
      r.status = 'magnus_credited';
      r.reconciliation_note = null;
    } else {
      r.status = 'mismatch';
      r.reconciliation_note = `Invoice ${invoice.amount} != Magnus credit ${r.magnus_credit_added}`;
    }
    const saved = await this.repo.save(r);

    await this.magnusLogRepo.save(this.magnusLogRepo.create({
      recharge_id: id,
      magnus_username: r.magnus_username,
      action: 'add_credit',
      status: match ? 'success' : 'mismatch',
      request_payload: JSON.stringify(data),
      response_payload: JSON.stringify({ reference: r.magnus_reference_id }),
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'magnus_sync', entity_type: 'recharge', entity_id: id,
      details: match ? 'Magnus credited - amounts match' : 'Magnus mismatch detected',
    });
    return saved;
  }

  private isPositiveNumber(value: any) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0;
  }

  private inferGatewayFromWallet(data: any): string | null {
    const w = String(data.received_wallet || data.wallet_tag || '').toLowerCase();
    if (!w) return null;
    if (w.includes('binance')) return 'Binance';
    if (w.includes('okx')) return 'OKX';
    if (w.includes('oxapay')) return 'OxaPay';
    if (w.includes('btcpay')) return 'BTCPay';
    if (w.includes('wio') || w.includes('bank')) return 'Wio Bank';
    return null;
  }

  /**
   * Look up the saved receiving wallet (Settings → Receiving Wallets) and
   * return its gateway code so a recharge gets the correct payment_gateway
   * without "Manual / mismatch".
   */
  async detectGatewayFromAddress(address?: string): Promise<string | null> {
    if (!address?.trim()) return null;
    const row = await this.receivingWalletRepo
      .createQueryBuilder('w')
      .where('LOWER(w.address) = LOWER(:a)', { a: address.trim() })
      .andWhere('w.is_active = true')
      .getOne();
    return row?.gateway || null;
  }

  /**
   * Canonicalize the payment_gateway label so non-standard intake strings
   * like "BTC Add to Username" or "BTC Split 1/2" don't get persisted as
   * gateway names — those are workflow tags, not real gateways. Falls back
   * order:
   *   1. user-provided value, if it's one of the 4 canonical gateways
   *   2. address-detected gateway (via Settings → Receiving Wallets)
   *   3. literal user-provided value (last resort, never null)
   *   4. 'Binance'
   *
   * Returning the detected gateway means a manual "BTC Add to Username"
   * recharge created against a Binance-tagged receiving address ends up
   * routed to BINANCE in the wallet ledger and shows "Binance" in the UI.
   */
  private resolveGateway(provided?: string, detected?: string | null): string {
    const canonical = new Set(['Binance', 'OKX', 'OxaPay', 'BTCPay', 'Wio Bank']);
    const norm = String(provided || '').trim();
    if (norm && canonical.has(norm)) return norm;
    if (detected && canonical.has(detected)) return detected;
    if (norm) return norm;
    return 'Binance';
  }

  /**
   * Best-effort, non-blocking on-chain verification. Updates the
   * CryptoTransaction row with confirmation status when the network is a
   * supported public chain (BTC / TRC20 / ERC20). Off-chain networks are
   * marked as confirmed automatically.
   */
  private kickoffOnchainVerify(tx: CryptoTransaction) {
    if (!tx?.tx_hash || !tx?.network) return;
    setImmediate(async () => {
      try {
        const result = await this.onchain.verify(tx.network, tx.tx_hash);
        if (!result) return;
        const fresh = await this.cryptoRepo.findOne({ where: { id: tx.id } });
        if (!fresh) return;
        if (result.ok) {
          fresh.gateway_tx_status = result.confirmed ? 'confirmed' : 'pending_chain';
          if (result.confirmations !== undefined) fresh.confirmations = String(result.confirmations);
          if (result.from && !fresh.sender_address) fresh.sender_address = result.from;
          fresh.notes = `${fresh.notes || ''}\n[onchain ${result.network}] ${result.confirmed ? 'CONFIRMED' : 'pending'} ${result.confirmations || 0} confs`.trim();
        } else {
          fresh.notes = `${fresh.notes || ''}\n[onchain ${result.network}] verify failed: ${result.error}`.trim();
        }
        await this.cryptoRepo.save(fresh);
      } catch {
        /* swallow — verification is fire-and-forget */
      }
    });
  }

  /**
   * Daily refresh of unconfirmed crypto transactions from the last 14 days.
   * Called by an interval timer registered in the module.
   */
  async refreshUnverifiedOnchainTxs() {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const rows = await this.cryptoRepo
      .createQueryBuilder('t')
      .where('t.created_at >= :cutoff', { cutoff })
      .andWhere('(t.gateway_tx_status IS NULL OR t.gateway_tx_status NOT IN (:...done))', { done: ['confirmed', 'failed'] })
      .andWhere('t.tx_hash IS NOT NULL')
      .limit(50)
      .getMany();
    for (const tx of rows) {
      if (OnchainService.isOffChain(tx.network)) {
        tx.gateway_tx_status = 'confirmed';
        await this.cryptoRepo.save(tx);
        continue;
      }
      this.kickoffOnchainVerify(tx);
    }
    return { scanned: rows.length };
  }

  private async findOrCreateCustomerFromPayment(data: any) {
    if (this.isIgnoredWebhookEmail(data.email)) {
      data.email = undefined;
    }

    if (data.magnus_username) {
      const profile = await this.fetchMagnusProfile(data.magnus_username);
      if (profile.email && !this.isIgnoredWebhookEmail(profile.email)) {
        data.email = profile.email;
      }
      data.first_name = data.first_name || profile.first_name;
      data.last_name = data.last_name || profile.last_name;
      data.address = data.address || profile.address;
      data.country = data.country || profile.country;
      data.phone = data.phone || profile.phone;
      data.company_name = data.company_name || profile.company_name;
      data.full_name = data.full_name || [data.first_name, data.last_name].filter(Boolean).join(' ');
    }

    if (data.customer_id) {
      const customer = await this.customerRepo.findOne({ where: { id: data.customer_id } });
      if (customer) return customer;
    }

    const qb = this.customerRepo.createQueryBuilder('c');
    if (data.magnus_username) {
      // Match case-insensitively so Telegram webhooks for `maradona10` and
      // `Maradona10` resolve to the SAME customer record.
      qb.orWhere('LOWER(c.magnus_username) = LOWER(:magnus)', { magnus: data.magnus_username });
    }
    if (data.email) {
      qb.orWhere('LOWER(c.email) = LOWER(:email)', { email: data.email });
    }
    if (data.telegram) {
      // Strip a leading "@" + lowercase compare — Telegram handles are case-insensitive.
      const tg = String(data.telegram).trim().replace(/^@/, '');
      qb.orWhere("LOWER(REGEXP_REPLACE(COALESCE(c.telegram, ''), '^@', '')) = LOWER(:telegram)", { telegram: tg });
    }
    const found = data.magnus_username || data.email || data.telegram ? await qb.getOne() : null;
    if (found) return found;

    const fullName = data.full_name
      || [data.first_name, data.last_name].filter(Boolean).join(' ')
      || data.company_name
      || data.magnus_username
      || data.email
      || 'Unknown customer';
    const customer = this.customerRepo.create({
      customer_code: await this.nextCustomerCode(),
      magnus_username: data.magnus_username,
      first_name: data.first_name,
      last_name: data.last_name,
      full_name: fullName,
      company_name: data.company_name,
      email: data.email,
      phone: data.phone,
      telegram: data.telegram,
      address: data.address,
      country: data.country,
      id_number: data.id_number,
      signup_ip: data.ip_address,
      risk_level: data.risk_level || 'Low',
      kyc_status: 'not_required',
      notes: `Auto-created from ${data.payment_gateway || 'payment'} payment intake. KYC can be completed later.`,
    });
    const saved = await this.customerRepo.save(customer);
    await this.audit.log({
      action: 'auto_create_customer',
      entity_type: 'customer',
      entity_id: saved.id,
      details: `Created customer ${saved.customer_code} from payment intake`,
    });
    return saved;
  }

  private async resolveAedValues(data: any, recharge: Recharge) {
    if (this.isPositiveNumber(data.aed_rate_at_payment) && this.isPositiveNumber(data.aed_value)) {
      return { rate: data.aed_rate_at_payment, value: data.aed_value };
    }
    const amount = parseFloat(recharge.amount || data.amount || '0');
    if (recharge.currency === 'AED' && amount > 0) return { rate: '1', value: amount.toFixed(2) };
    if (amount > 0) {
      const rate = await this.fxSvc.rateToAed(recharge.currency);
      return { rate: rate.toFixed(4), value: (amount * rate).toFixed(2) };
    }
    return { rate: data.aed_rate_at_payment, value: data.aed_value };
  }

  private async fetchMagnusProfile(username: string) {
    try {
      const data: any = await this.magnusSvc.user(username);
      const row = data?.raw || data?.rows?.[0] || data?.data?.rows?.[0] || data?.data?.raw || data?.data || data;
      const addressParts = [
        row?.address,
        row?.address1,
        row?.address2,
        row?.neighborhood,
        row?.district,
        row?.city,
        row?.state,
        row?.zip,
        row?.zipcode,
        row?.postalcode,
      ]
        .map((v) => String(v || '').trim())
        .filter(Boolean);

      const rawCountry = row?.country_name || row?.country || row?.country_code;
      const country = this.normalizeCountry(rawCountry);

      return {
        email: this.isIgnoredWebhookEmail(row?.email) ? undefined : row?.email,
        first_name: row?.first_name || row?.firstname,
        last_name: row?.last_name || row?.lastname,
        address: addressParts.length ? [...new Set(addressParts)].join(', ') : undefined,
        country,
        phone: row?.phone || row?.mobile,
        company_name: row?.company_name || row?.company,
      };
    } catch {
      return {};
    }
  }

  private normalizeCountry(value: any) {
    const text = String(value || '').trim();
    if (!text) return undefined;
    if (/^\d+$/.test(text)) return undefined;
    return text;
  }

  private isIgnoredWebhookEmail(value: any) {
    const email = String(value || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return false;
    return email.endsWith('@cyberxcalls.com');
  }
}
