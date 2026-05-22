import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MagnusSyncLog } from '../entities/magnus-sync-log.entity';
import { AuditService } from '../audit/audit.service';
import { MagnusClient } from './magnus.client';

@Injectable()
export class MagnusService {
  private logger = new Logger('MagnusService');

  constructor(
    @InjectRepository(MagnusSyncLog) private repo: Repository<MagnusSyncLog>,
    private audit: AuditService,
    private client: MagnusClient,
  ) {}

  status() {
    return {
      configured: this.client.isConfigured(),
      base_url: process.env.MAGNUS_PUBLIC_URL,
      api_key_preview: (process.env.MAGNUS_API_KEY || '').slice(0, 8) + '…',
      mode: this.client.isConfigured() ? 'live' : 'placeholder',
      note: this.client.isConfigured()
        ? 'Live mode: requests are signed (HMAC-SHA512) and sent directly to MagnusBilling.'
        : 'Placeholder mode: set MAGNUS_API_KEY, MAGNUS_API_SECRET, MAGNUS_PUBLIC_URL to enable live calls.',
    };
  }

  async logs(limit = 100) {
    return this.repo.find({ order: { created_at: 'DESC' }, take: limit });
  }

  private async record(log: Partial<MagnusSyncLog>) {
    return this.repo.save(this.repo.create(log));
  }

  // ----- Public actions ----------------------------------------------------

  async syncUser(body: { magnus_username: string }, actor?: any) {
    const u = body.magnus_username;
    try {
      const data = await this.client.getBalance(u);
      await this.record({
        magnus_username: u, action: 'sync_user', status: 'success',
        request_payload: JSON.stringify(body),
        response_payload: JSON.stringify(data).slice(0, 4000),
      });
      await this.audit.log({
        actor_id: actor?.id, actor_email: actor?.email,
        action: 'magnus_sync_user', entity_type: 'magnus_username', entity_id: u,
      });
      return { ok: true, mode: 'live', data };
    } catch (e: any) {
      await this.record({
        magnus_username: u, action: 'sync_user', status: 'failed',
        request_payload: JSON.stringify(body), error_message: e.message,
      });
      return { ok: false, mode: 'live', error: e.message };
    }
  }

  async addCredit(body: { magnus_username: string; amount: number; description?: string }, actor?: any) {
    const u = body.magnus_username;
    try {
      const data = await this.client.addCredit(u, body.amount, body.description);
      await this.record({
        magnus_username: u, action: 'add_credit', status: data?.success ? 'success' : 'partial',
        request_payload: JSON.stringify(body),
        response_payload: JSON.stringify(data).slice(0, 4000),
      });
      await this.audit.log({
        actor_id: actor?.id, actor_email: actor?.email,
        action: 'magnus_add_credit', entity_type: 'magnus_username', entity_id: u,
        details: `Add credit ${body.amount}`,
      });
      const reference = data?.rows?.id || data?.id || `MAG-${Date.now()}`;
      return { ok: !!data?.success || !!data?.rows, mode: 'live', reference, raw: data };
    } catch (e: any) {
      await this.record({
        magnus_username: u, action: 'add_credit', status: 'failed',
        request_payload: JSON.stringify(body), error_message: e.message,
      });
      return { ok: false, mode: 'live', error: e.message };
    }
  }

  async user(username: string) {
    try {
      const data = await this.client.getBalance(username);
      await this.record({
        magnus_username: username, action: 'fetch_user', status: 'success',
        response_payload: JSON.stringify(data).slice(0, 4000),
      });
      return { mode: 'live', ...data };
    } catch (e: any) {
      await this.record({
        magnus_username: username, action: 'fetch_user', status: 'failed',
        error_message: e.message,
      });
      return { mode: 'live', error: e.message, username };
    }
  }

  async cdr(username: string, dateFrom?: string, dateTo?: string) {
    try {
      const data = await this.client.getCDR(username, dateFrom, dateTo);
      await this.record({
        magnus_username: username, action: 'fetch_cdr', status: 'success',
        response_payload: JSON.stringify({ count: data?.rows?.length || 0 }),
      });
      return { mode: 'live', username, cdrs: data?.rows || [], total: data?.results || 0 };
    } catch (e: any) {
      await this.record({
        magnus_username: username, action: 'fetch_cdr', status: 'failed', error_message: e.message,
      });
      return { mode: 'live', error: e.message, username, cdrs: [] };
    }
  }

  async listUsers(page = 1, limit = 50, search?: string) {
    try {
      const data = await this.client.listUsers(page, limit, search);
      await this.record({
        action: 'list_users', status: 'success',
        response_payload: JSON.stringify({ count: data?.rows?.length || 0, total: data?.results || 0 }),
      });
      return {
        mode: 'live',
        users: (data?.rows || []).map((r: any) => ({
          id: r.id,
          username: r.username,
          first_name: r.firstname,
          last_name: r.lastname,
          email: r.email,
          credit: r.credit,
          plan_id: r.id_plan,
          active: r.active,
          created: r.creationdate,
        })),
        total: data?.results || 0,
        page, limit,
      };
    } catch (e: any) {
      await this.record({
        action: 'list_users', status: 'failed', error_message: e.message,
      });
      return { mode: 'live', error: e.message, users: [], total: 0 };
    }
  }
}
