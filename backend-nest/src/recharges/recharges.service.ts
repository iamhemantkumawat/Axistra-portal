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
  ) {}

  private async nextCode() {
    const count = await this.repo.count();
    return `RCH-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
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

    // Auto-create initial empty treasury movement so chain steps can be filled
    const tm = this.treasuryRepo.create({
      recharge_id: saved.id,
      customer_id: customer.id,
      total_usdt_received: saved.crypto_amount,
      receiving_wallet: saved.wallet_address,
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

  async updateStatus(id: string, status: string, note?: string, actor?: any) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    r.status = status as any;
    if (status === 'payment_received') r.payment_date = r.payment_date || new Date();
    if (status === 'fully_reconciled') r.reconciled = true;
    if (note) r.reconciliation_note = note;
    const saved = await this.repo.save(r);
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
    const tx = this.cryptoRepo.create({
      recharge_id: id, customer_id: r.customer_id,
      crypto_amount: data.crypto_amount || r.crypto_amount,
      coin: data.coin || r.crypto_coin,
      network: data.network || r.crypto_network,
      receiving_wallet: data.receiving_wallet,
      tx_hash: data.tx_hash,
      wallet_balance_after: data.wallet_balance_after,
      aed_rate_at_payment: data.aed_rate_at_payment,
      aed_value: data.aed_value,
      status: 'received',
      notes: data.notes,
    });
    const saved = await this.cryptoRepo.save(tx);
    if (data.tx_hash && !r.tx_hash) r.tx_hash = data.tx_hash;
    r.status = 'payment_received';
    await this.repo.save(r);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'add_crypto_tx', entity_type: 'recharge', entity_id: id,
      details: `Crypto TX recorded ${saved.tx_hash}`,
    });
    return saved;
  }

  async syncMagnus(id: string, data: any, actor?: any) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    r.magnus_credit_added = data.magnus_credit_added || r.amount;
    r.magnus_reference_id = data.magnus_reference_id || `MAG-${Date.now()}`;
    r.magnus_credited_at = new Date();
    // Match check
    const amt = parseFloat(r.amount);
    const credit = parseFloat(r.magnus_credit_added);
    const match = Math.abs(amt - credit) < 0.01;
    if (match) {
      r.status = 'magnus_credited';
      r.reconciliation_note = null;
    } else {
      r.status = 'mismatch';
      r.reconciliation_note = `Invoice ${r.amount} != Magnus credit ${r.magnus_credit_added}`;
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
}
