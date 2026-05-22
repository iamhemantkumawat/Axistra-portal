import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { KycDocument } from '../entities/kyc-document.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer) private repo: Repository<Customer>,
    @InjectRepository(KycDocument) private kycRepo: Repository<KycDocument>,
    private audit: AuditService,
  ) {}

  private async nextCode(): Promise<string> {
    const count = await this.repo.count();
    return `AXC-${String(count + 1).padStart(5, '0')}`;
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
        .where('(c.full_name ILIKE :s OR c.email ILIKE :s OR c.magnus_username ILIKE :s OR c.customer_code ILIKE :s OR c.company_name ILIKE :s)', { s })
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
    const c = this.repo.create({ ...data, customer_code: code });
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
    const saved = await this.repo.save(c);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_customer', entity_type: 'customer', entity_id: id,
      details: JSON.stringify(data).slice(0, 500),
    });
    return saved;
  }

  async delete(id: string, actor?: any) {
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_customer', entity_type: 'customer', entity_id: id,
    });
    return { success: true };
  }
}
