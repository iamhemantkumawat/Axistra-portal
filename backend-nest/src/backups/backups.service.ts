import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../audit/audit.service';

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const RETAIN_DAYS = Number(process.env.BACKUP_RETAIN_DAYS || '30');

@Injectable()
export class BackupsService {
  private readonly logger = new Logger('BackupsService');

  constructor(private readonly audit: AuditService) {
    try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
  }

  /**
   * Runs `pg_dump | gzip` to produce a self-contained .sql.gz snapshot of the
   * portal database. Returns the resulting file metadata.  Uses env DATABASE_*
   * credentials so we never hardcode anything.
   */
  async createBackup(opts: { kind?: 'manual' | 'scheduled'; actor?: any } = {}): Promise<any> {
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
    this.pruneOldBackups();
    return this.toMeta(fileName, stat);
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
    const safety = await this.createBackup({ kind: 'manual', actor });

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
    const isScheduled = name.includes('scheduled');
    return {
      name,
      size_bytes: stat.size,
      size_human: this.humanSize(stat.size),
      kind: isScheduled ? 'scheduled' : (name.includes('manual') ? 'manual' : 'legacy'),
      created_at: stat.mtime.toISOString(),
    };
  }

  private humanSize(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
}
