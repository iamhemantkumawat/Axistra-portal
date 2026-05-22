import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MagnusSyncLog } from '../entities/magnus-sync-log.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class MagnusService {
  constructor(
    @InjectRepository(MagnusSyncLog) private repo: Repository<MagnusSyncLog>,
    private audit: AuditService,
  ) {}

  status() {
    return {
      configured: !!process.env.MAGNUS_API_KEY,
      base_url: process.env.MAGNUS_PUBLIC_URL,
      api_key_preview: (process.env.MAGNUS_API_KEY || '').slice(0, 8) + '...',
      mode: 'placeholder',
      note: 'MagnusBilling API integration is a placeholder. Live API calls will be wired in a follow-up phase.',
    };
  }

  async logs(limit = 100) {
    return this.repo.find({ order: { created_at: 'DESC' }, take: limit });
  }

  // PLACEHOLDER endpoints — return mock-style responses, log everything for audit chain.
  async syncUser(body: { magnus_username: string }, actor?: any) {
    const log = this.repo.create({
      magnus_username: body.magnus_username,
      action: 'sync_user',
      status: 'placeholder',
      request_payload: JSON.stringify(body),
      response_payload: JSON.stringify({ note: 'Placeholder response — Magnus API not wired yet.' }),
    });
    await this.repo.save(log);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'magnus_sync_user', entity_type: 'magnus_username', entity_id: body.magnus_username,
    });
    return { ok: true, mode: 'placeholder', magnus_username: body.magnus_username };
  }

  async addCredit(body: { magnus_username: string; amount: number; reference?: string }, actor?: any) {
    const reference = body.reference || `MAG-MANUAL-${Date.now()}`;
    const log = this.repo.create({
      magnus_username: body.magnus_username,
      action: 'add_credit',
      status: 'placeholder',
      request_payload: JSON.stringify(body),
      response_payload: JSON.stringify({ reference }),
    });
    await this.repo.save(log);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'magnus_add_credit', entity_type: 'magnus_username', entity_id: body.magnus_username,
      details: `Add credit ${body.amount}`,
    });
    return { ok: true, mode: 'placeholder', reference };
  }

  async user(username: string) {
    return {
      mode: 'placeholder',
      username,
      balance: null,
      plan: null,
      status: 'unknown',
      note: 'Live data will appear once Magnus API integration is enabled.',
    };
  }

  async cdr(username: string) {
    return {
      mode: 'placeholder',
      username,
      cdrs: [],
      note: 'Live CDR data will appear once Magnus API integration is enabled.',
    };
  }
}
