import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { GoogleAuth, JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Unattended Google Drive uploader using a Service Account.
 *
 * Setup (operator side):
 *  1. Google Cloud Console → APIs & Services → Enable "Google Drive API".
 *  2. Create a Service Account, then create a JSON key for it.
 *  3. Share the destination Drive folder with the service account email
 *     (something like axistra-backup@your-project.iam.gserviceaccount.com)
 *     and grant "Editor" access.
 *  4. Put two env vars on the server:
 *       GOOGLE_DRIVE_FOLDER_ID=...           # the folder ID from the URL
 *       GOOGLE_SERVICE_ACCOUNT_KEY_JSON=...  # the entire JSON key, single line
 *     (Alternatively set GOOGLE_SERVICE_ACCOUNT_KEY_FILE to a mounted path.)
 *
 * When env vars are missing the service stays inert — `isConfigured()` returns
 * false, the UI exposes a "Not configured" pill, and local backups keep
 * working exactly as before.
 */
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger('GoogleDriveService');
  private drive: drive_v3.Drive | null = null;
  private serviceEmail: string | null = null;
  private folderId: string | null = null;
  private lastError: string | null = null;

  constructor() {
    this.init();
  }

  private init() {
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
    if (!this.folderId) {
      this.lastError = 'GOOGLE_DRIVE_FOLDER_ID env var not set';
      return;
    }
    let creds: any = null;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
      try {
        creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON);
      } catch (err) {
        this.lastError = `GOOGLE_SERVICE_ACCOUNT_KEY_JSON is not valid JSON: ${(err as any)?.message}`;
        this.logger.warn(this.lastError);
        return;
      }
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
      try {
        creds = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, 'utf8'));
      } catch (err) {
        this.lastError = `Failed to read GOOGLE_SERVICE_ACCOUNT_KEY_FILE: ${(err as any)?.message}`;
        this.logger.warn(this.lastError);
        return;
      }
    } else {
      this.lastError = 'No GOOGLE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_FILE set';
      return;
    }

    try {
      const auth = new GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });
      this.drive = google.drive({ version: 'v3', auth: auth as any });
      this.serviceEmail = creds.client_email || null;
      this.lastError = null;
      this.logger.log(`Google Drive uploader ready (service=${this.serviceEmail}, folder=${this.folderId})`);
    } catch (err) {
      this.lastError = `Drive client init failed: ${(err as any)?.message}`;
      this.logger.warn(this.lastError);
    }
  }

  isConfigured() {
    return this.drive !== null && this.folderId !== null;
  }

  status() {
    return {
      configured: this.isConfigured(),
      service_account_email: this.serviceEmail,
      folder_id: this.folderId,
      last_error: this.lastError,
    };
  }

  private requireDrive(): drive_v3.Drive {
    if (!this.drive || !this.folderId) {
      throw new BadRequestException(
        `Google Drive is not configured. ${this.lastError || 'Set GOOGLE_DRIVE_FOLDER_ID and GOOGLE_SERVICE_ACCOUNT_KEY_JSON env vars.'}`,
      );
    }
    return this.drive;
  }

  async uploadFile(localPath: string): Promise<{ id: string; name: string; web_view_link: string | null; size: string | null }> {
    const drive = this.requireDrive();
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

  async listFiles(): Promise<Array<{ id: string; name: string; size: string | null; created_time: string | null; web_view_link: string | null }>> {
    const drive = this.requireDrive();
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

  async deleteFile(fileId: string): Promise<void> {
    const drive = this.requireDrive();
    await drive.files.delete({ fileId, supportsAllDrives: true });
    this.logger.log(`Deleted Drive file ${fileId}`);
  }

  async downloadToBuffer(fileId: string): Promise<Buffer> {
    const drive = this.requireDrive();
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }
}
