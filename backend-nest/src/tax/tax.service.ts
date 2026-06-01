import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { TaxFiling } from '../entities/tax-filing.entity';
import { AuditService } from '../audit/audit.service';

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.VAULT_UPLOAD_DIR || '/app/uploads/vault');

@Injectable()
export class TaxService {
  constructor(
    @InjectRepository(TaxFiling) private repo: Repository<TaxFiling>,
    private audit: AuditService,
  ) {
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'tax'), { recursive: true });
  }

  async list() {
    const rows = await this.repo.find({ order: { due_date: 'ASC' } });
    // Auto-flag overdue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return rows.map((r) => {
      if (!['filed', 'paid', 'exempt'].includes(r.status) && r.due_date && new Date(r.due_date) < today) {
        r.status = 'overdue';
      }
      return r;
    });
  }

  async summary() {
    const all = await this.list();
    const upcoming = all.filter((f) => ['upcoming', 'in_progress'].includes(f.status))
      .sort((a, b) => +new Date(a.due_date) - +new Date(b.due_date))
      .slice(0, 5);
    const overdue = all.filter((f) => f.status === 'overdue');
    const totalDue = all.reduce((s, f) => s + Number(f.tax_due_aed || 0), 0);
    const totalPaid = all.reduce((s, f) => s + Number(f.tax_paid_aed || 0), 0);
    return {
      total_filings: all.length,
      upcoming,
      overdue_count: overdue.length,
      total_due_aed: totalDue,
      total_paid_aed: totalPaid,
      outstanding_aed: Math.max(0, totalDue - totalPaid),
    };
  }

  async get(id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Tax filing not found');
    return r;
  }

  async create(body: any, file: any, actor?: any) {
    const saved = await this.repo.save(this.repo.create({
      tax_type: body.tax_type || 'vat',
      period_label: body.period_label,
      period_start: body.period_start || null,
      period_end: body.period_end || null,
      due_date: body.due_date,
      filed_at: body.filed_at || null,
      paid_at: body.paid_at || null,
      status: body.status || 'upcoming',
      taxable_amount_aed: body.taxable_amount_aed || '0',
      tax_due_aed: body.tax_due_aed || '0',
      tax_paid_aed: body.tax_paid_aed || '0',
      reference_number: body.reference_number || null,
      trn: body.trn || null,
      notes: body.notes || null,
      created_by: actor?.email,
      file_name: file?.originalname,
      file_url: file ? `/api/tax/${path.basename(file.path)}/file` : null,
      mime_type: file?.mimetype,
      file_size: file?.size || 0,
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'tax_filing_create', entity_type: 'tax_filing', entity_id: saved.id,
      details: `${saved.tax_type} ${saved.period_label}`,
    });
    return saved;
  }

  async update(id: string, body: any, file: any, actor?: any) {
    const f = await this.get(id);
    const patch: any = {
      tax_type: body.tax_type ?? f.tax_type,
      period_label: body.period_label ?? f.period_label,
      period_start: body.period_start ?? f.period_start,
      period_end: body.period_end ?? f.period_end,
      due_date: body.due_date ?? f.due_date,
      filed_at: body.filed_at ?? f.filed_at,
      paid_at: body.paid_at ?? f.paid_at,
      status: body.status ?? f.status,
      taxable_amount_aed: body.taxable_amount_aed ?? f.taxable_amount_aed,
      tax_due_aed: body.tax_due_aed ?? f.tax_due_aed,
      tax_paid_aed: body.tax_paid_aed ?? f.tax_paid_aed,
      reference_number: body.reference_number ?? f.reference_number,
      trn: body.trn ?? f.trn,
      notes: body.notes ?? f.notes,
    };
    if (file) {
      // Delete previous file if any
      if (f.file_url) {
        try {
          const prev = f.file_url.split('/').slice(-2)[0];
          fs.unlinkSync(path.join(UPLOAD_ROOT, 'tax', prev));
        } catch (_) { /* ignore */ }
      }
      patch.file_name = file.originalname;
      patch.file_url = `/api/tax/${path.basename(file.path)}/file`;
      patch.mime_type = file.mimetype;
      patch.file_size = file.size;
    }
    Object.assign(f, patch);
    const saved = await this.repo.save(f);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'tax_filing_update', entity_type: 'tax_filing', entity_id: id,
      details: `${saved.tax_type} ${saved.period_label}`,
    });
    return saved;
  }

  async remove(id: string, actor?: any) {
    const f = await this.get(id);
    if (f.file_url) {
      try {
        const fname = f.file_url.split('/').slice(-2)[0];
        fs.unlinkSync(path.join(UPLOAD_ROOT, 'tax', fname));
      } catch (_) { /* ignore */ }
    }
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'tax_filing_delete', entity_type: 'tax_filing', entity_id: id,
      details: `${f.tax_type} ${f.period_label}`,
    });
    return { deleted: true };
  }

  fileFor(fname: string) {
    const fp = path.join(UPLOAD_ROOT, 'tax', fname);
    if (!fs.existsSync(fp)) throw new NotFoundException('File not found');
    return fp;
  }
}
