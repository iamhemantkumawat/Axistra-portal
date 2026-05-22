import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { Customer } from '../entities/customer.entity';
import { KycDocument } from '../entities/kyc-document.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(ComplianceLog) private repo: Repository<ComplianceLog>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(KycDocument) private kycRepo: Repository<KycDocument>,
    private audit: AuditService,
  ) {}

  async list(query?: { customer_id?: string; risk_level?: string }) {
    const where: any = {};
    if (query?.customer_id) where.customer_id = query.customer_id;
    if (query?.risk_level) where.risk_level = query.risk_level;
    return this.repo.find({ where, order: { created_at: 'DESC' } });
  }

  private async ensureCustomer(id: string) {
    const c = await this.customerRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  async log(data: any, actor?: any) {
    await this.ensureCustomer(data.customer_id);
    const log = this.repo.create({ ...data, created_by: actor?.email });
    return this.repo.save(log);
  }

  async requestKyc(data: { customer_id: string; notes?: string }, actor?: any) {
    const c = await this.ensureCustomer(data.customer_id);
    c.kyc_status = 'requested';
    await this.customerRepo.save(c);
    const log = this.repo.create({
      customer_id: c.id, action: 'request_kyc', notes: data.notes,
      kyc_requested_at: new Date(), risk_level: c.risk_level,
      created_by: actor?.email,
    });
    const saved = await this.repo.save(log);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'request_kyc', entity_type: 'customer', entity_id: c.id,
    });
    return saved;
  }

  async blockUser(data: { customer_id: string; notes?: string }, actor?: any) {
    const c = await this.ensureCustomer(data.customer_id);
    c.status = 'blocked';
    c.risk_level = 'High';
    await this.customerRepo.save(c);
    const log = this.repo.create({
      customer_id: c.id, action: 'block', blocked: true,
      notes: data.notes, risk_level: 'High', created_by: actor?.email,
    });
    const saved = await this.repo.save(log);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'block_user', entity_type: 'customer', entity_id: c.id,
    });
    return saved;
  }

  async markHighRisk(data: { customer_id: string; notes?: string }, actor?: any) {
    const c = await this.ensureCustomer(data.customer_id);
    c.risk_level = 'High';
    await this.customerRepo.save(c);
    const log = this.repo.create({
      customer_id: c.id, action: 'mark_high_risk',
      notes: data.notes, risk_level: 'High', created_by: actor?.email,
    });
    return this.repo.save(log);
  }

  async refund(data: { customer_id: string; amount: string; currency: string; notes?: string }, actor?: any) {
    await this.ensureCustomer(data.customer_id);
    const log = this.repo.create({
      customer_id: data.customer_id, action: 'refund',
      refund_amount: data.amount, refund_currency: data.currency,
      notes: data.notes, created_by: actor?.email,
    });
    return this.repo.save(log);
  }
}
