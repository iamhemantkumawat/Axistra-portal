import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Contract } from '../entities/contract.entity';
import { AuditService } from '../audit/audit.service';

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.VAULT_UPLOAD_DIR || '/app/uploads/vault');

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract) private repo: Repository<Contract>,
    private audit: AuditService,
  ) {
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'contracts'), { recursive: true });
  }

  async list() {
    const rows = await this.repo.find({ order: { created_at: 'DESC' } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return rows.map((r) => {
      if (r.status === 'active' && r.end_date && new Date(r.end_date) < today) {
        r.status = 'expired';
      }
      return r;
    });
  }

  async get(id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Contract not found');
    return r;
  }

  async create(file: any, body: any, actor?: any) {
    const saved = await this.repo.save(this.repo.create({
      title: body.title,
      contract_type: body.contract_type || 'customer_agreement',
      counterparty_name: body.counterparty_name || null,
      customer_id: body.customer_id || null,
      reference_number: body.reference_number || null,
      signed_at: body.signed_at || null,
      start_date: body.start_date || null,
      end_date: body.end_date || null,
      status: body.status || 'active',
      contract_value: body.contract_value || '0',
      currency: body.currency || 'AED',
      notes: body.notes || null,
      created_by: actor?.email,
      file_name: file?.originalname,
      file_url: file ? `/api/contracts/${path.basename(file.path)}/file` : null,
      mime_type: file?.mimetype,
      file_size: file?.size || 0,
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'contract_create', entity_type: 'contract', entity_id: saved.id,
      details: `${saved.contract_type} — ${saved.title}`,
    });
    return saved;
  }

  async update(id: string, body: any, file: any, actor?: any) {
    const c = await this.get(id);
    const patch: any = {
      title: body.title ?? c.title,
      contract_type: body.contract_type ?? c.contract_type,
      counterparty_name: body.counterparty_name ?? c.counterparty_name,
      customer_id: body.customer_id ?? c.customer_id,
      reference_number: body.reference_number ?? c.reference_number,
      signed_at: body.signed_at ?? c.signed_at,
      start_date: body.start_date ?? c.start_date,
      end_date: body.end_date ?? c.end_date,
      status: body.status ?? c.status,
      contract_value: body.contract_value ?? c.contract_value,
      currency: body.currency ?? c.currency,
      notes: body.notes ?? c.notes,
    };
    if (file) {
      if (c.file_url) {
        try {
          const prev = c.file_url.split('/').slice(-2)[0];
          fs.unlinkSync(path.join(UPLOAD_ROOT, 'contracts', prev));
        } catch (_) { /* ignore */ }
      }
      patch.file_name = file.originalname;
      patch.file_url = `/api/contracts/${path.basename(file.path)}/file`;
      patch.mime_type = file.mimetype;
      patch.file_size = file.size;
    }
    Object.assign(c, patch);
    const saved = await this.repo.save(c);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'contract_update', entity_type: 'contract', entity_id: id,
      details: saved.title,
    });
    return saved;
  }

  async remove(id: string, actor?: any) {
    const c = await this.get(id);
    if (c.file_url) {
      try {
        const fname = c.file_url.split('/').slice(-2)[0];
        fs.unlinkSync(path.join(UPLOAD_ROOT, 'contracts', fname));
      } catch (_) { /* ignore */ }
    }
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'contract_delete', entity_type: 'contract', entity_id: id,
      details: c.title,
    });
    return { deleted: true };
  }

  fileFor(fname: string) {
    const fp = path.join(UPLOAD_ROOT, 'contracts', fname);
    if (!fs.existsSync(fp)) throw new NotFoundException('File not found');
    return fp;
  }
}
