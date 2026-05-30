import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { google, drive_v3 } from 'googleapis';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import { AppSetting } from '../entities/app-setting.entity';

const OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const OAUTH_KEY = 'google_drive_oauth';

/**
 * Google Drive uploader supporting BOTH:
 *  1. **OAuth User flow** (recommended for personal Gmail).  Operator clicks
 *     "Connect Google Drive" in Settings → consents → backend stores a
 *     refresh_token.  Uploads use the user's own 15 GB quota.
 *  2. **Service Account flow** (only works with Google Workspace + Shared
 *     Drive, because regular service accounts have zero storage).  Kept
 *     for backward compatibility.
 *
 * Whichever is configured first wins, with OAuth taking precedence.
 */
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger('GoogleDriveService');
  private mode: 'oauth' | 'service_account' | 'none' = 'none';
  private oauthClient: OAuth2Client | null = null;
  private serviceDrive: drive_v3.Drive | null = null;
  private serviceEmail: string | null = null;
  private folderId: string | null = null;
  private lastError: string | null = null;
  // Cached OAuth metadata so the frontend can render "Connected as foo@gmail.com".
  private oauthEmail: string | null = null;
  private oauthExpiresAt: number | null = null;

  constructor(@InjectRepository(AppSetting) private settings: Repository<AppSetting>) {
    // Async init: try OAuth from DB first, then fall back to service account.
    this.init().catch((err) => this.logger.warn(`init failed: ${err?.message}`));
  }

  private async init() {
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
    if (!this.folderId) {
      this.lastError = 'GOOGLE_DRIVE_FOLDER_ID env var not set';
      return;
    }
    // Path 1: OAuth refresh_token stored in DB
    const stored = await this.settings.findOne({ where: { key: OAUTH_KEY } });
    if (stored?.value?.refresh_token && process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      try {
        this.oauthClient = new google.auth.OAuth2(
          process.env.GOOGLE_OAUTH_CLIENT_ID,
          process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          this.callbackUrl(),
        );
        this.oauthClient.setCredentials({ refresh_token: stored.value.refresh_token });
        this.mode = 'oauth';
        this.oauthEmail = stored.value.email || null;
        this.lastError = null;
        this.logger.log(`Google Drive (OAuth) ready — connected as ${this.oauthEmail || 'unknown'}, folder=${this.folderId}`);
        return;
      } catch (err) {
        this.lastError = `OAuth client init failed: ${(err as any)?.message}`;
        this.logger.warn(this.lastError);
      }
    }
    // Path 2: Service account file
    let creds: any = null;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
      try { creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON); }
      catch (err) { this.lastError = `GOOGLE_SERVICE_ACCOUNT_KEY_JSON parse: ${(err as any)?.message}`; return; }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
      const p = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE!;
      try { creds = JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch (err) { this.lastError = `Service-account key read: ${(err as any)?.message}`; return; }
    } else {
      // Not connected via OAuth and no service account either.
      this.lastError = stored ? this.lastError || 'OAuth refresh_token present but GOOGLE_OAUTH_CLIENT_ID/SECRET env vars are missing' : 'Not connected. Click "Connect Google Drive" in Settings, or set GOOGLE_SERVICE_ACCOUNT_KEY_JSON for service-account mode.';
      return;
    }
    try {
      const auth = new GoogleAuth({ credentials: creds, scopes: OAUTH_SCOPES });
      this.serviceDrive = google.drive({ version: 'v3', auth: auth as any });
      this.serviceEmail = creds.client_email || null;
      this.mode = 'service_account';
      this.lastError = null;
      this.logger.log(`Google Drive (Service Account) ready — ${this.serviceEmail}, folder=${this.folderId}`);
    } catch (err) {
      this.lastError = `Service-account init failed: ${(err as any)?.message}`;
    }
  }

  /* ─────────── Public façade ─────────── */

  isConfigured() { return this.mode !== 'none' && !!this.folderId; }

  status() {
    return {
      configured: this.isConfigured(),
      mode: this.mode,
      connected_email: this.mode === 'oauth' ? this.oauthEmail : this.serviceEmail,
      folder_id: this.folderId,
      last_error: this.lastError,
      // Helpful flags for the UI:
      can_oauth: !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && this.folderId),
    };
  }

  /* ─────────── OAuth flow ─────────── */

  callbackUrl(): string {
    // Where Google redirects after consent.  Honors PORTAL_PUBLIC_URL if set,
    // otherwise falls back to localhost (useful during dev).
    const base = (process.env.PORTAL_PUBLIC_URL || 'http://localhost:8001').replace(/\/$/, '');
    return `${base}/api/backups/drive/oauth-callback`;
  }

  startOAuth(): string {
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new BadRequestException('Server is missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. Add them to the .env and restart the backend, then try again.');
    }
    if (!this.folderId) {
      throw new BadRequestException('GOOGLE_DRIVE_FOLDER_ID is not set. Pick the destination folder in Drive and set its ID in the .env.');
    }
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      this.callbackUrl(),
    );
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',          // forces Google to return a fresh refresh_token
      scope: OAUTH_SCOPES,
      include_granted_scopes: true,
    });
  }

  async finishOAuth(code: string): Promise<{ email: string | null }> {
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new BadRequestException('Server OAuth env vars missing — cannot complete sign-in.');
    }
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      this.callbackUrl(),
    );
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google did not return a refresh_token. This usually means the same account already authorised this app — go to https://myaccount.google.com/permissions and remove access, then try again.');
    }
    client.setCredentials(tokens);
    // Fetch the user's email so we can show "Connected as foo@gmail.com".
    let email: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: client as any });
      const me = await oauth2.userinfo.get();
      email = me.data.email || null;
    } catch {/* non-fatal */}
    await this.settings.save({
      key: OAUTH_KEY,
      value: { refresh_token: tokens.refresh_token, email, scope: tokens.scope, granted_at: new Date().toISOString() },
    } as AppSetting);
    this.oauthClient = client;
    this.oauthEmail = email;
    this.mode = 'oauth';
    this.lastError = null;
    this.logger.log(`Google Drive OAuth connected as ${email}`);
    return { email };
  }

  async disconnect(): Promise<void> {
    await this.settings.delete({ key: OAUTH_KEY });
    this.oauthClient = null;
    this.oauthEmail = null;
    if (this.mode === 'oauth') this.mode = 'none';
    this.logger.log('Google Drive OAuth disconnected');
  }

  /* ─────────── Drive ops (mode-agnostic) ─────────── */

  private async drive(): Promise<drive_v3.Drive> {
    if (this.mode === 'oauth' && this.oauthClient) {
      // The OAuth2Client auto-refreshes access tokens when needed.
      return google.drive({ version: 'v3', auth: this.oauthClient });
    }
    if (this.mode === 'service_account' && this.serviceDrive) {
      return this.serviceDrive;
    }
    throw new BadRequestException(`Google Drive is not configured. ${this.lastError || 'Click "Connect Google Drive" in Settings.'}`);
  }

  async uploadFile(localPath: string) {
    const drive = await this.drive();
    const name = path.basename(localPath);
    const res = await drive.files.create({
      requestBody: { name, parents: [this.folderId!] },
      media: { mimeType: 'application/gzip', body: fs.createReadStream(localPath) },
      fields: 'id, name, webViewLink, size',
      supportsAllDrives: true,
    });
    this.logger.log(`Uploaded ${name} → Drive (${res.data.id})`);
    return {
      id: res.data.id!,
      name: res.data.name!,
      web_view_link: res.data.webViewLink || null,
      size: res.data.size || null,
    };
  }

  async listFiles() {
    const drive = await this.drive();
    const items: any[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const res = await drive.files.list({
        q: `'${this.folderId}' in parents and trashed = false`,
        orderBy: 'createdTime desc',
        pageSize: 100,
        pageToken,
        fields: 'nextPageToken, files(id, name, size, createdTime, webViewLink)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files || []) {
        items.push({
          id: f.id!,
          name: f.name!,
          size: f.size || null,
          created_time: f.createdTime || null,
          web_view_link: f.webViewLink || null,
        });
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    return items;
  }

  async deleteFile(fileId: string) {
    const drive = await this.drive();
    await drive.files.delete({ fileId, supportsAllDrives: true });
    this.logger.log(`Deleted Drive file ${fileId}`);
  }

  async downloadToBuffer(fileId: string): Promise<Buffer> {
    const drive = await this.drive();
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }
}
