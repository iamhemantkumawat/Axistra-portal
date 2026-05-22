import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { renderInvoiceHtml, renderInvoicePdf } from './invoice-template';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private repo: Repository<Invoice>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    private audit: AuditService,
  ) {}

  private async nextNumber() {
    const year = new Date().getFullYear();
    const count = await this.repo.count();
    return `AX-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async list() {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  async get(id: string) {
    const i = await this.repo.findOne({ where: { id } });
    if (!i) throw new NotFoundException();
    return i;
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
