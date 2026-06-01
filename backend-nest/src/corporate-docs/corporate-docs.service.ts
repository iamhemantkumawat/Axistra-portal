import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { CorporateDocument } from '../entities/corporate-document.entity';
import { AuditService } from '../audit/audit.service';

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.VAULT_UPLOAD_DIR || '/app/uploads/vault');

@Injectable()
export class CorporateDocsService {
  constructor(
    @InjectRepository(CorporateDocument) private repo: Repository<CorporateDocument>,
    private audit: AuditService,
  ) {
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'corporate'), { recursive: true });
  }

  list() {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  async get(id: string) {
    const d = await this.repo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Document not found');
    return d;
  }

  async create(file: any, body: any, actor?: any) {
    const saved = await this.repo.save(this.repo.create({
      title: body.title || file?.originalname || 'Untitled',
      doc_type: body.doc_type || 'other',
      reference_number: body.reference_number || null,
      issuing_authority: body.issuing_authority || null,
      issued_at: body.issued_at || null,
      expires_at: body.expires_at || null,
      file_name: file?.originalname,
      file_url: file ? `/api/corporate-docs/${path.basename(file.path)}/file` : null,
      mime_type: file?.mimetype,
      file_size: file?.size || 0,
      notes: body.notes || null,
      uploaded_by: actor?.email,
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'corporate_doc_upload', entity_type: 'corporate_document', entity_id: saved.id,
      details: `${saved.doc_type} — ${saved.file_name}`,
    });
    return saved;
  }

  async update(id: string, body: any, actor?: any) {
    const d = await this.get(id);
    Object.assign(d, {
      title: body.title ?? d.title,
      doc_type: body.doc_type ?? d.doc_type,
      reference_number: body.reference_number ?? d.reference_number,
      issuing_authority: body.issuing_authority ?? d.issuing_authority,
      issued_at: body.issued_at ?? d.issued_at,
      expires_at: body.expires_at ?? d.expires_at,
      notes: body.notes ?? d.notes,
    });
    const saved = await this.repo.save(d);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'corporate_doc_update', entity_type: 'corporate_document', entity_id: id,
      details: saved.title,
    });
    return saved;
  }

  async remove(id: string, actor?: any) {
    const d = await this.get(id);
    if (d.file_url) {
      const fname = d.file_url.split('/').slice(-2)[0];
      const fp = path.join(UPLOAD_ROOT, 'corporate', fname);
      try { fs.unlinkSync(fp); } catch (_) { /* ignore */ }
    }
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'corporate_doc_delete', entity_type: 'corporate_document', entity_id: id,
      details: d.title,
    });
    return { deleted: true };
  }

  fileFor(fname: string) {
    const fp = path.join(UPLOAD_ROOT, 'corporate', fname);
    if (!fs.existsSync(fp)) throw new NotFoundException('File not found');
    return fp;
  }
}
