import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { KycDocument } from '../entities/kyc-document.entity';
import { Customer } from '../entities/customer.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class KycService {
  constructor(
    @InjectRepository(KycDocument) private repo: Repository<KycDocument>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    private audit: AuditService,
  ) {}

  async list(customerId: string) {
    return this.repo.find({ where: { customer_id: customerId }, order: { created_at: 'DESC' } });
  }

  async upload(customerId: string, file: any, documentType: string, actor?: any) {
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const doc = this.repo.create({
      customer_id: customerId,
      document_type: documentType || 'other',
      file_name: file.originalname,
      file_url: `/api/kyc/${customerId}/file/${path.basename(file.path)}`,
      status: 'submitted',
    });
    const saved = await this.repo.save(doc);

    // Move customer KYC status to submitted if currently not_required or requested
    if (['not_required', 'requested'].includes(customer.kyc_status)) {
      customer.kyc_status = 'submitted';
      await this.customerRepo.save(customer);
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'kyc_upload', entity_type: 'customer', entity_id: customerId,
      details: `${documentType} — ${file.originalname}`,
    });
    return saved;
  }

  async review(docId: string, status: 'approved' | 'rejected', comment: string, actor?: any) {
    const doc = await this.repo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException();
    doc.status = status;
    doc.admin_comment = comment;
    doc.reviewed_by = actor?.email;
    doc.reviewed_at = new Date();
    const saved = await this.repo.save(doc);

    // Update customer overall kyc_status to highest decision
    const customer = await this.customerRepo.findOne({ where: { id: doc.customer_id } });
    if (customer) {
      const allDocs = await this.repo.find({ where: { customer_id: customer.id } });
      const anyRejected = allDocs.some((d) => d.status === 'rejected');
      const anyApproved = allDocs.some((d) => d.status === 'approved');
      customer.kyc_status = anyRejected ? 'rejected' : anyApproved ? 'approved' : 'submitted';
      await this.customerRepo.save(customer);
    }
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: `kyc_${status}`, entity_type: 'kyc_document', entity_id: docId,
      details: comment,
    });
    return saved;
  }

  async remove(docId: string, actor?: any) {
    const doc = await this.repo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException();
    if (doc.file_url) {
      try {
        const fname = doc.file_url.split('/').pop();
        const uploadRoot = path.resolve(process.cwd(), process.env.KYC_UPLOAD_DIR || '/app/uploads/kyc');
        fs.unlinkSync(path.join(uploadRoot, doc.customer_id, fname));
      } catch (_) { /* ignore */ }
    }
    await this.repo.delete(docId);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'kyc_delete', entity_type: 'kyc_document', entity_id: docId,
      details: doc.file_name,
    });
    return { deleted: true };
  }

  async download(customerId: string, fileName: string) {
    const uploadRoot = path.resolve(process.cwd(), process.env.KYC_UPLOAD_DIR || '/app/uploads/kyc');
    const filePath = path.join(uploadRoot, customerId, fileName);
    if (!fs.existsSync(filePath)) throw new NotFoundException('File not found');
    return filePath;
  }
}
