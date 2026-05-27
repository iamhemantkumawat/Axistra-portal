import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { Recharge } from '../entities/recharge.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { renderInvoiceHtml, renderInvoicePdf } from './invoice-template';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private repo: Repository<Invoice>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    @InjectRepository(CryptoTransaction) private cryptoRepo: Repository<CryptoTransaction>,
    private audit: AuditService,
  ) {}

  private async nextNumber() {
    const now = new Date();
    const prefix = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.repo.count();
    return `AX-${prefix}-${String(count + 1).padStart(5, '0')}`;
  }

  private deriveStatus(invoice: Invoice, recharge?: Recharge | null) {
    if (!recharge) return invoice.status;
    if (recharge.status === 'refunded') return 'refunded';
    if (recharge.status === 'failed') return 'failed';
    if (
      [
        'payment_received',
        'magnus_credited',
        'sent_to_okx',
        'converted_to_aed',
        'deposited_to_wio',
        'fully_reconciled',
      ].includes(recharge.status)
    ) {
      return 'paid';
    }
    return invoice.status;
  }

  private isWithinRefreshWindow(invoice: Invoice) {
    const anchor = invoice.issued_date || invoice.created_at;
    if (!anchor) return false;
    const stamp = new Date(anchor);
    if (Number.isNaN(stamp.getTime())) return false;
    return Date.now() - stamp.getTime() <= 7 * 24 * 60 * 60 * 1000;
  }

  private async hydrateInvoice(invoice: Invoice) {
    const recharge = invoice.recharge_id
      ? await this.rechargeRepo.findOne({ where: { id: invoice.recharge_id } })
      : await this.rechargeRepo.findOne({ where: { invoice_id: invoice.id } });
    const rechargeId = recharge?.id || invoice.recharge_id;
    const paymentTransactions = rechargeId
      ? await this.cryptoRepo.find({ where: { recharge_id: rechargeId }, order: { created_at: 'ASC' } })
      : [];

    if (!this.isWithinRefreshWindow(invoice)) {
      return { ...invoice, recharge_id: rechargeId, payment_transactions: paymentTransactions };
    }

    const customer = invoice.customer_id
      ? await this.customerRepo.findOne({ where: { id: invoice.customer_id } })
      : null;

    const merged = {
      ...invoice,
      recharge_id: rechargeId,
      customer_name: customer?.full_name || invoice.customer_name,
      customer_email: customer?.email || invoice.customer_email,
      customer_country: customer?.country || invoice.customer_country,
      customer_company: customer?.company_name || invoice.customer_company,
      customer_phone: customer?.phone || invoice.customer_phone,
      customer_address: customer?.address || invoice.customer_address,
      status: this.deriveStatus(invoice, recharge),
      payment_transactions: paymentTransactions,
    };

    const changed =
      merged.recharge_id !== invoice.recharge_id ||
      merged.customer_name !== invoice.customer_name ||
      merged.customer_email !== invoice.customer_email ||
      merged.customer_country !== invoice.customer_country ||
      merged.customer_company !== invoice.customer_company ||
      merged.customer_phone !== invoice.customer_phone ||
      merged.customer_address !== invoice.customer_address ||
      merged.status !== invoice.status;

    if (changed) {
      invoice.recharge_id = merged.recharge_id;
      invoice.customer_name = merged.customer_name;
      invoice.customer_email = merged.customer_email;
      invoice.customer_country = merged.customer_country;
      invoice.customer_company = merged.customer_company;
      invoice.customer_phone = merged.customer_phone;
      invoice.customer_address = merged.customer_address;
      invoice.status = merged.status;
      await this.repo.save(invoice);
      return { ...invoice, payment_transactions: paymentTransactions };
    }

    return merged;
  }

  async list() {
    const invoices = await this.repo.find({ order: { created_at: 'DESC' } });
    return Promise.all(invoices.map((invoice) => this.hydrateInvoice(invoice)));
  }

  async get(id: string) {
    const i = await this.repo.findOne({ where: { id } });
    if (!i) throw new NotFoundException();
    return this.hydrateInvoice(i);
  }

  async createForRecharge(input: {
    customer: Customer;
    amount: string;
    currency: string;
    payment_method?: string;
    crypto_coin?: string;
    crypto_network?: string;
    tx_hash?: string;
  }) {
    const inv = this.repo.create({
      invoice_number: await this.nextNumber(),
      customer_id: input.customer.id,
      customer_name: input.customer.full_name,
      customer_email: input.customer.email,
      customer_country: input.customer.country,
      customer_company: input.customer.company_name,
      customer_phone: input.customer.phone,
      customer_address: input.customer.address,
      amount: input.amount,
      currency: input.currency,
      payment_method: input.payment_method,
      crypto_coin: input.crypto_coin,
      crypto_network: input.crypto_network,
      tx_hash: input.tx_hash,
      status: 'unpaid',
      issued_date: new Date(),
    });
    return this.repo.save(inv);
  }

  async generate(body: any, actor?: any) {
    const customer = await this.customerRepo.findOne({ where: { id: body.customer_id } });
    if (!customer) throw new NotFoundException('Customer not found');
    const inv = await this.createForRecharge({
      customer,
      amount: body.amount,
      currency: body.currency || 'USD',
      payment_method: body.payment_method,
      crypto_coin: body.crypto_coin,
      crypto_network: body.crypto_network,
      tx_hash: body.tx_hash,
    });
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'generate_invoice', entity_type: 'invoice', entity_id: inv.id,
      details: `Generated ${inv.invoice_number}`,
    });
    return inv;
  }

  async html(id: string) {
    const inv = await this.get(id);
    return renderInvoiceHtml(inv);
  }

  async pdf(id: string): Promise<Buffer> {
    const inv = await this.get(id);
    return renderInvoicePdf(inv);
  }
}
