import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../audit/audit.service';
import { GoogleDriveService } from './google-drive.service';

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const RETAIN_DAYS = Number(process.env.BACKUP_RETAIN_DAYS || '30');
const DRIVE_AUTO_UPLOAD = (process.env.BACKUP_DRIVE_AUTO_UPLOAD || 'scheduled').toLowerCase();
// values: 'off' | 'scheduled' | 'all'

/** Files matching this pattern are produced by the service and may be auto-pruned. */
const MANAGED_FILE_RE = /^axistra-(manual|scheduled|safety)-/;

@Injectable()
export class BackupsService {
  private readonly logger = new Logger('BackupsService');

  constructor(
    private readonly audit: AuditService,
    private readonly drive: GoogleDriveService,
  ) {
    try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
  }

  /**
   * Runs `pg_dump | gzip` to produce a self-contained .sql.gz snapshot of the
   * portal database.  Uses env DATABASE_* credentials so we never hardcode
   * anything.  Optionally mirrors the snapshot to Google Drive when configured.
   */
  async createBackup(opts: { kind?: 'manual' | 'scheduled' | 'safety'; actor?: any; uploadToDrive?: boolean } = {}): Promise<any> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const kind = opts.kind || 'manual';
    const fileName = `axistra-${kind}-${stamp}.sql.gz`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const dbHost = process.env.DATABASE_HOST || 'localhost';
    const dbPort = process.env.DATABASE_PORT || '5432';
    const dbUser = process.env.DATABASE_USER || 'axistra';
    const dbName = process.env.DATABASE_NAME || 'axistra_db';
    const dbPass = process.env.DATABASE_PASSWORD || '';

    await new Promise<void>((resolve, reject) => {
      const env = { ...process.env, PGPASSWORD: dbPass };
      const dump = spawn('pg_dump', [
        '-h', dbHost, '-p', dbPort, '-U', dbUser,
        '--no-owner', '--no-privileges', '--format=plain', dbName,
      ], { env });
      const gzip = spawn('gzip', ['-9']);
      const out = fs.createWriteStream(filePath);
      dump.stdout.pipe(gzip.stdin);
      gzip.stdout.pipe(out);
      let stderr = '';
      dump.stderr.on('data', (d) => { stderr += d.toString(); });
      gzip.on('close', (code) => {
        if (code === 0) resolve(); else reject(new Error(`gzip exited ${code}: ${stderr}`));
      });
      dump.on('error', reject);
      gzip.on('error', reject);
    });

    const stat = fs.statSync(filePath);
    await this.audit.log({
      actor_id: opts.actor?.id, actor_email: opts.actor?.email,
      action: `backup_${kind}`, entity_type: 'backup', entity_id: fileName,
      details: `${(stat.size / 1024).toFixed(1)} KB`,
    });
    this.logger.log(`Backup written: ${fileName} (${stat.size} bytes)`);

    let driveMeta: any = null;
    const shouldAutoUpload =
      this.drive.isConfigured() &&
      (opts.uploadToDrive ||
        DRIVE_AUTO_UPLOAD === 'all' ||
        (DRIVE_AUTO_UPLOAD === 'scheduled' && kind === 'scheduled'));
    if (shouldAutoUpload) {
      try {
        driveMeta = await this.drive.uploadFile(filePath);
        await this.audit.log({
          actor_id: opts.actor?.id, actor_email: opts.actor?.email,
          action: 'backup_drive_upload', entity_type: 'backup', entity_id: fileName,
          details: `Drive file ${driveMeta.id}`,
        });
      } catch (err) {
        this.logger.warn(`Drive upload failed for ${fileName}: ${(err as any)?.message}`);
      }
    }

    this.pruneOldBackups();
    return { ...this.toMeta(fileName, stat), drive: driveMeta };
  }

  list() {
    try {
      return fs.readdirSync(BACKUP_DIR)
        .filter((n) => n.endsWith('.sql.gz') || n.endsWith('.dump.gz'))
        .map((n) => this.toMeta(n, fs.statSync(path.join(BACKUP_DIR, n))))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch {
      return [];
    }
  }

  fullPath(name: string) {
    // Reject anything that tries to escape BACKUP_DIR
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new BadRequestException('Invalid backup name');
    }
    const fp = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(fp)) throw new NotFoundException(`Backup ${name} not found`);
    return fp;
  }

  async deleteBackup(name: string, actor?: any) {
    const fp = this.fullPath(name);
    fs.unlinkSync(fp);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'backup_delete', entity_type: 'backup', entity_id: name,
      details: `Deleted ${name}`,
    });
    return { deleted: true };
  }

  async bulkDelete(names: string[], actor?: any) {
    const results: { name: string; deleted: boolean; error?: string }[] = [];
    for (const n of names) {
      try {
        await this.deleteBackup(n, actor);
        results.push({ name: n, deleted: true });
      } catch (err) {
        results.push({ name: n, deleted: false, error: (err as any)?.message });
      }
    }
    return { total: names.length, deleted: results.filter((r) => r.deleted).length, results };
  }

  async bulkDeleteDrive(fileIds: string[], actor?: any) {
    const results: { id: string; deleted: boolean; error?: string }[] = [];
    for (const id of fileIds) {
      try {
        await this.deleteDrive(id, actor);
        results.push({ id, deleted: true });
      } catch (err) {
        results.push({ id, deleted: false, error: (err as any)?.message });
      }
    }
    return { total: fileIds.length, deleted: results.filter((r) => r.deleted).length, results };
  }

  async uploadToDrive(name: string, actor?: any) {
    const fp = this.fullPath(name);
    const meta = await this.drive.uploadFile(fp);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'backup_drive_upload', entity_type: 'backup', entity_id: name,
      details: `Drive file ${meta.id}`,
    });
    return meta;
  }

  driveStatus() {
    return this.drive.status();
  }

  async listDrive() {
    return this.drive.listFiles();
  }

  async deleteDrive(fileId: string, actor?: any) {
    await this.drive.deleteFile(fileId);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'backup_drive_delete', entity_type: 'backup', entity_id: fileId,
      details: `Removed Drive file ${fileId}`,
    });
    return { deleted: true };
  }

  async pullFromDrive(fileId: string, originalName: string, actor?: any) {
    // Sanitize name; only allow our backup extension.
    const safe = originalName.replace(/[^A-Za-z0-9._-]/g, '_');
    if (!(safe.endsWith('.sql.gz') || safe.endsWith('.dump.gz'))) {
      throw new BadRequestException('Drive file is not a recognised Axistra backup (.sql.gz / .dump.gz)');
    }
    const target = path.join(BACKUP_DIR, safe);
    const buf = await this.drive.downloadToBuffer(fileId);
    fs.writeFileSync(target, buf);
    const stat = fs.statSync(target);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'backup_drive_pull', entity_type: 'backup', entity_id: safe,
      details: `Pulled ${safe} from Drive`,
    });
    return this.toMeta(safe, stat);
  }

  /**
   * Accept an admin-uploaded .sql.gz / .dump.gz file and store it under
   * BACKUP_DIR so it shows up in the regular list and can be restored.
   */
  async ingestUpload(file: { originalname: string; buffer: Buffer; size: number }, actor?: any) {
    if (!file?.originalname || !file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_');
    if (!(safe.endsWith('.sql.gz') || safe.endsWith('.dump.gz'))) {
      throw new BadRequestException('Only .sql.gz or .dump.gz uploads are allowed');
    }
    const target = path.join(BACKUP_DIR, safe);
    fs.writeFileSync(target, file.buffer);
    const stat = fs.statSync(target);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'backup_upload', entity_type: 'backup', entity_id: safe,
      details: `Uploaded ${(stat.size / 1024).toFixed(1)} KB`,
    });
    return this.toMeta(safe, stat);
  }

  /**
   * DANGEROUS — wipes current DB then pipes the gunzipped dump into psql.
   * Requires `confirm: "I_UNDERSTAND_THIS_REPLACES_ALL_DATA"` in the body.
   */
  async restore(name: string, confirm: string, actor?: any) {
    if (confirm !== 'I_UNDERSTAND_THIS_REPLACES_ALL_DATA') {
      throw new BadRequestException('Confirmation phrase missing or wrong. Pass {confirm:"I_UNDERSTAND_THIS_REPLACES_ALL_DATA"} in the body.');
    }
    const fp = this.fullPath(name);
    const dbHost = process.env.DATABASE_HOST || 'localhost';
    const dbPort = process.env.DATABASE_PORT || '5432';
    const dbUser = process.env.DATABASE_USER || 'axistra';
    const dbName = process.env.DATABASE_NAME || 'axistra_db';
    const dbPass = process.env.DATABASE_PASSWORD || '';

    // Take a safety snapshot first so the operator can always rewind one step.
    const safety = await this.createBackup({ kind: 'safety', actor });

    await new Promise<void>((resolve, reject) => {
      const env = { ...process.env, PGPASSWORD: dbPass };
      // Drop public schema then recreate so the restore is clean.
      const reset = spawn('psql', [
        '-h', dbHost, '-p', dbPort, '-U', dbUser, '-d', dbName,
        '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ' + dbUser + ';',
      ], { env });
      let resetErr = '';
      reset.stderr.on('data', (d) => { resetErr += d.toString(); });
      reset.on('close', (code) => {
        if (code !== 0) return reject(new Error(`reset failed: ${resetErr}`));
        const gunzip = spawn('gunzip', ['-c', fp]);
        const psql = spawn('psql', ['-h', dbHost, '-p', dbPort, '-U', dbUser, '-d', dbName, '-q'], { env });
        gunzip.stdout.pipe(psql.stdin);
        let stderr = '';
        psql.stderr.on('data', (d) => { stderr += d.toString(); });
        psql.on('close', (code2) => {
          if (code2 === 0) resolve(); else reject(new Error(`restore failed: ${stderr}`));
        });
      });
    });

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'backup_restore', entity_type: 'backup', entity_id: name,
      details: `Restored from ${name}. Safety snapshot: ${safety.name}`,
    });
    return { restored: true, safety_snapshot: safety.name };
  }

  // Cron: 02:00 UTC daily (≈ 06:00 Dubai time, low traffic).
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledBackup() {
    try {
      await this.createBackup({ kind: 'scheduled' });
    } catch (err) {
      this.logger.error(`Scheduled backup failed: ${(err as any)?.message}`);
    }
  }

  private pruneOldBackups() {
    try {
      const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(BACKUP_DIR)) {
        if (!(name.endsWith('.sql.gz') || name.endsWith('.dump.gz'))) continue;
        // Only auto-prune files we created ourselves. Admin-uploaded archives
        // and legacy files stay untouched.
        if (!MANAGED_FILE_RE.test(name)) continue;
        const fp = path.join(BACKUP_DIR, name);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          this.logger.log(`Pruned old backup ${name}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Prune failed: ${(err as any)?.message}`);
    }
  }

  private toMeta(name: string, stat: fs.Stats) {
    let kind: 'scheduled' | 'manual' | 'safety' | 'legacy' = 'legacy';
    if (name.includes('safety')) kind = 'safety';
    else if (name.includes('scheduled')) kind = 'scheduled';
    else if (name.includes('manual')) kind = 'manual';
    return {
      name,
      size_bytes: stat.size,
      size_human: this.humanSize(stat.size),
      kind,
      created_at: stat.mtime.toISOString(),
    };
  }

  private humanSize(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
}
