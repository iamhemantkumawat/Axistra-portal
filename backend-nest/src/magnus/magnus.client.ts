import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as querystring from 'querystring';

/**
 * MagnusBilling REST client.
 *
 * Auth (per official PHP wrapper):
 *   URL    : {public_url}/index.php/{module}/{action}
 *   Headers: Key: <api_key>,  Sign: HMAC_SHA512(post_data, api_secret)
 *   Body   : application/x-www-form-urlencoded
 *   Nonce  : included in body
 */
@Injectable()
export class MagnusClient {
  private logger = new Logger('MagnusClient');

  private get apiKey() { return process.env.MAGNUS_API_KEY || ''; }
  private get apiSecret() { return process.env.MAGNUS_API_SECRET || ''; }
  private get baseUrl() { return (process.env.MAGNUS_PUBLIC_URL || '').replace(/\/+$/, ''); }

  isConfigured() {
    return Boolean(this.apiKey && this.apiSecret && this.baseUrl);
  }

  private async query(req: Record<string, any>): Promise<any> {
    if (!this.isConfigured()) throw new Error('MagnusBilling not configured');

    const module = req.module;
    const action = req.action;
    const mt = process.hrtime();
    const nonce = `${Math.floor(Date.now() / 1000)}${String(mt[1]).slice(0, 6)}`;
    req.nonce = nonce;

    const postData = querystring.stringify(req);
    const sign = crypto.createHmac('sha512', this.apiSecret).update(postData).digest('hex');
    const url = `${this.baseUrl}/index.php/${module}/${action || ''}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Key': this.apiKey,
        'Sign': sign,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'AxistraPortal/1.0',
      },
      body: postData,
      // 15s timeout via AbortController
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text, status: res.status }; }
    return json;
  }

  // --- Public helpers used by the portal ----------------------------------

  async getUser(username: string) {
    const filter = JSON.stringify([{ type: 'string', field: 'username', value: username, comparison: 'eq' }]);
    return this.query({
      module: 'user', action: 'read',
      page: 1, start: 0, limit: 1, filter,
    });
  }

  async addCredit(username: string, credit: number, description?: string) {
    // 1) Find user id
    const userResult = await this.getUser(username);
    const row = userResult?.rows?.[0];
    if (!row?.id) throw new Error(`Magnus user not found: ${username}`);
    const id_user = row.id;

    return this.query({
      module: 'refill', action: 'save', id: 0,
      id_user,
      credit,
      description: description || 'Axistra Portal credit',
      payment: 6, // generic / manual gateway slot in MagnusBilling
    });
  }

  async getCDR(username: string, dateFrom?: string, dateTo?: string, limit = 50) {
    const filters: any[] = [{ type: 'string', field: 'username', value: username, comparison: 'eq' }];
    if (dateFrom) filters.push({ type: 'date', field: 'starttime', value: dateFrom, comparison: 'gt' });
    if (dateTo) filters.push({ type: 'date', field: 'starttime', value: dateTo, comparison: 'lt' });

    return this.query({
      module: 'cdr', action: 'read',
      page: 1, start: 0, limit, filter: JSON.stringify(filters),
    });
  }

  async listUsers(page = 1, limit = 50, search?: string) {
    const filter: any[] = [];
    if (search) filter.push({ type: 'string', field: 'username', value: search, comparison: 'st' });
    return this.query({
      module: 'user', action: 'read',
      page, start: (page - 1) * limit, limit,
      filter: JSON.stringify(filter),
    });
  }

  async getBalance(username: string) {
    const u = await this.getUser(username);
    const row = u?.rows?.[0];
    return {
      username,
      id: row?.id || null,
      credit: row?.credit ?? null,
      plan_id: row?.id_plan ?? null,
      active: row?.active ?? null,
      raw: row || null,
    };
  }
}
