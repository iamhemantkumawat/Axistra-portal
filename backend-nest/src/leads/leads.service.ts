import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../entities/lead.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead) private repo: Repository<Lead>,
    private audit: AuditService,
  ) {}

  async create(data: Partial<Lead>, ip?: string) {
    const lead = this.repo.create({ ...data, ip_address: ip });
    const saved = await this.repo.save(lead);
    await this.audit.log({
      action: 'lead_created',
      entity_type: 'lead',
      entity_id: saved.id,
      details: `${saved.first_name || ''} ${saved.last_name || ''} <${saved.email}> from ${saved.company || 'n/a'}`,
      ip_address: ip,
    });
    return saved;
  }

  list() {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  async updateStatus(id: string, status: string) {
    await this.repo.update(id, { status });
    return this.repo.findOne({ where: { id } });
  }
}
