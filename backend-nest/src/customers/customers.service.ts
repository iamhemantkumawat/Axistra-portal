import { BadRequestException, Injectable, NotFoundException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { KycDocument } from '../entities/kyc-document.entity';
import { Invoice } from '../entities/invoice.entity';
import { Recharge } from '../entities/recharge.entity';
import { AuditService } from '../audit/audit.service';
import { RechargesService } from '../recharges/recharges.service';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer) private repo: Repository<Customer>,
    @InjectRepository(KycDocument) private kycRepo: Repository<KycDocument>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    @Inject(forwardRef(() => RechargesService)) private rechargesSvc: RechargesService,
    private audit: AuditService,
  ) {}

  /**
   * Gap-aware customer code. Returns the smallest available AXC-NNNNN slot
   * (fills holes created by deletes) — falls back to MAX + 1.
   */
  async nextCode(): Promise<string> {
    const rows = await this.repo
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

  private isProfileComplete(data: Partial<Customer>) {
    const requiredFields = [
      data.first_name,
      data.last_name,
      data.email,
      data.phone,
      data.country,
      data.magnus_username,
    ];
    return requiredFields.every((value) => String(value || '').trim().length > 0);
  }

  private normalizeStatus(data: Partial<Customer>, currentStatus?: string) {
    const requestedStatus = String(data.status || currentStatus || '').trim().toLowerCase();
    if (requestedStatus === 'blocked' || requestedStatus === 'suspended') {
      return requestedStatus;
    }
    return this.isProfileComplete(data) ? 'active' : 'pending';
  }

  private isWithinInvoiceRefreshWindow(value?: Date | string | null) {
    if (!value) return false;
    const stamp = new Date(value);
    if (Number.isNaN(stamp.getTime())) return false;
    return Date.now() - stamp.getTime() <= 7 * 24 * 60 * 60 * 1000;
  }

  private async refreshRecentInvoiceSnapshots(customer: Customer) {
    const invoices = await this.invoiceRepo.find({ where: { customer_id: customer.id } });
    const recent = invoices.filter((invoice) => this.isWithinInvoiceRefreshWindow(invoice.issued_date || invoice.created_at));
    if (!recent.length) return;
    for (const invoice of recent) {
      invoice.customer_name = customer.full_name || invoice.customer_name;
      invoice.customer_email = customer.email || invoice.customer_email;
      invoice.customer_country = customer.country || invoice.customer_country;
      invoice.customer_company = customer.company_name || invoice.customer_company;
      invoice.customer_phone = customer.phone || invoice.customer_phone;
      invoice.customer_address = customer.address || invoice.customer_address;
    }
    await this.invoiceRepo.save(recent);
  }

  async list(query?: { search?: string; risk_level?: string; status?: string; kyc_status?: string }) {
    const where: any = {};
    if (query?.risk_level) where.risk_level = query.risk_level;
    if (query?.status) where.status = query.status;
    if (query?.kyc_status) where.kyc_status = query.kyc_status;
    let items: Customer[];
    if (query?.search) {
      const s = `%${query.search}%`;
      items = await this.repo
        .createQueryBuilder('c')
        .where('(c.full_name ILIKE :s OR c.first_name ILIKE :s OR c.last_name ILIKE :s OR c.email ILIKE :s OR c.phone ILIKE :s OR c.telegram ILIKE :s OR c.magnus_username ILIKE :s OR c.customer_code ILIKE :s OR c.company_name ILIKE :s OR c.id_number ILIKE :s)', { s })
        .andWhere(where)
        .orderBy('c.created_at', 'DESC')
        .getMany();
    } else {
      items = await this.repo.find({ where, order: { created_at: 'DESC' } });
    }
    return items;
  }

  async get(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Customer not found');
    const kyc = await this.kycRepo.find({ where: { customer_id: id }, order: { created_at: 'DESC' } });
    return { ...c, kyc_documents: kyc };
  }

  async create(data: Partial<Customer>, actor?: any) {
    const code = await this.nextCode();
    const fullName = data.full_name || [data.first_name, data.last_name].filter(Boolean).join(' ') || data.company_name || data.magnus_username || data.email || 'Unknown customer';
    const c = this.repo.create({
      ...data,
      full_name: fullName,
      customer_code: code,
      status: this.normalizeStatus({ ...data, full_name: fullName }),
    });
    const saved = await this.repo.save(c);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_customer', entity_type: 'customer', entity_id: saved.id,
      details: `Created customer ${saved.customer_code}`,
    });
    return saved;
  }

  async update(id: string, data: Partial<Customer>, actor?: any) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    Object.assign(c, data);
    c.full_name = c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || c.magnus_username || c.email || 'Unknown customer';
    c.status = this.normalizeStatus(c, data.status || c.status);
    const saved = await this.repo.save(c);
    await this.refreshRecentInvoiceSnapshots(saved);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_customer', entity_type: 'customer', entity_id: id,
      details: JSON.stringify(data).slice(0, 500),
    });
    return saved;
  }

  async delete(id: string, actor?: any) {
    const customer = await this.repo.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    // Cascade: delete all recharges (and their crypto/treasury/ledger chain) for this customer
    const recharges = await this.rechargeRepo.find({ where: { customer_id: id } });
    for (const r of recharges) {
      try {
        await this.rechargesSvc.delete(r.id, actor);
      } catch {
        /* continue; recharge may have been removed already */
      }
    }
    // Delete any stand-alone invoices that survived (no recharge link)
    await this.invoiceRepo.delete({ customer_id: id });
    // KYC documents are linked by FK; remove explicitly to avoid orphans
    await this.kycRepo.delete({ customer_id: id });
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_customer', entity_type: 'customer', entity_id: id,
      details: `Deleted customer ${customer.customer_code} (cascaded ${recharges.length} recharges)`,
    });
    return { success: true, customer_code: customer.customer_code, cascaded_recharges: recharges.length };
  }
}
