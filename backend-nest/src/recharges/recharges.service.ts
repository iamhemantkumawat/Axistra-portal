import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { MagnusSyncLog } from '../entities/magnus-sync-log.entity';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { MagnusService } from '../magnus/magnus.service';
import { FxService } from '../fx/fx.service';

@Injectable()
export class RechargesService {
  constructor(
    @InjectRepository(Recharge) private repo: Repository<Recharge>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(CryptoTransaction) private cryptoRepo: Repository<CryptoTransaction>,
    @InjectRepository(TreasuryMovement) private treasuryRepo: Repository<TreasuryMovement>,
    @InjectRepository(MagnusSyncLog) private magnusLogRepo: Repository<MagnusSyncLog>,
    private audit: AuditService,
    private invoiceSvc: InvoicesService,
    private magnusSvc: MagnusService,
    private fxSvc: FxService,
  ) {}

  private async nextCode() {
    const count = await this.repo.count();
    const now = new Date();
    const prefix = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `RCH-${prefix}-${String(count + 1).padStart(5, '0')}`;
  }

  private async nextCustomerCode() {
    const count = await this.customerRepo.count();
    return `AXC-${String(count + 1).padStart(5, '0')}`;
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
    const code = await this.nextCode();
    const invoice = await this.invoiceSvc.createForRecharge({
      customer,
      amount: data.amount,
      currency: data.currency || 'USD',
      payment_method: data.payment_gateway || 'Manual',
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
      crypto_amount: data.crypto_amount || data.amount,
      crypto_coin: data.crypto_coin || 'USDT',
      crypto_network: data.crypto_network || 'TRC20',
      wallet_address: data.wallet_address,
      tx_hash: data.tx_hash,
      payment_gateway: data.payment_gateway || 'Manual',
      payment_date: data.payment_date || new Date(),
      admin_notes: data.admin_notes,
      status: 'pending_payment',
    });
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
    return saved;
  }

  async createFromGatewayPayment(data: any, actor?: any) {
    const customer = await this.findOrCreateCustomerFromPayment(data);
    const existingTx = data.tx_hash?.trim()
      ? await this.cryptoRepo.findOne({ where: { tx_hash: data.tx_hash.trim() } })
      : null;
    if (existingTx) return this.applyGatewayPayment(existingTx.recharge_id, data, actor);

    const recharge = await this.create({
      customer_id: customer.id,
      magnus_username: data.magnus_username || customer.magnus_username,
      amount: data.amount,
      currency: data.currency || 'USD',
      crypto_amount: '0',
      crypto_coin: data.crypto_coin || data.coin || 'BTC',
      crypto_network: data.crypto_network || data.network || data.coin || 'BTC',
      wallet_address: data.wallet_address || data.receiving_wallet,
      payment_gateway: data.payment_gateway || 'Manual',
      payment_date: data.payment_date || data.paid_at || new Date(),
      admin_notes: data.admin_notes,
    }, actor);

    if (data.tx_hash || data.gateway_transactions?.length) {
      await this.addGatewayCryptoTx(recharge.id, data, actor);
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
    if (!data.receiving_wallet?.trim()) throw new BadRequestException('Receiving wallet is required');
    if (!this.isPositiveNumber(data.crypto_amount || r.crypto_amount)) throw new BadRequestException('Crypto amount must be greater than zero');
    if (!this.isPositiveNumber(data.aed_rate_at_payment) || !this.isPositiveNumber(data.aed_value)) {
      throw new BadRequestException('AED rate and AED value at payment time are required');
    }
    const existingTx = await this.cryptoRepo.findOne({ where: { tx_hash: data.tx_hash.trim() } });
    if (existingTx) throw new BadRequestException('Payment TX hash is already recorded');
    const tx = this.cryptoRepo.create({
      recharge_id: id, customer_id: r.customer_id,
      crypto_amount: data.crypto_amount || r.crypto_amount,
      coin: data.coin || r.crypto_coin,
      network: data.network || r.crypto_network,
      receiving_wallet: data.receiving_wallet,
      tx_hash: data.tx_hash.trim(),
      wallet_balance_after: data.wallet_balance_after,
      aed_rate_at_payment: data.aed_rate_at_payment,
      aed_value: data.aed_value,
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
      final_usdt_amount: String(data.coin || data.crypto_coin || recharge.crypto_coin).toUpperCase() === 'USDT'
        ? String(data.crypto_amount || recharge.crypto_amount || '')
        : undefined,
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
      qb.orWhere('c.magnus_username = :magnus', { magnus: data.magnus_username });
    }
    if (data.email) {
      qb.orWhere('LOWER(c.email) = LOWER(:email)', { email: data.email });
    }
    if (data.telegram) {
      qb.orWhere('c.telegram = :telegram', { telegram: data.telegram });
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
