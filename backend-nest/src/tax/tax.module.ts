import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { extname } from 'path';
import { randomUUID } from 'crypto';

import { TaxFiling } from '../entities/tax-filing.entity';
import { TaxService } from './tax.service';
import { TaxController } from './tax.controller';
import { AuditModule } from '../audit/audit.module';

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.VAULT_UPLOAD_DIR || '/app/uploads/vault');
const SUBDIR = path.join(UPLOAD_ROOT, 'tax');
fs.mkdirSync(SUBDIR, { recursive: true });

@Module({
  imports: [
    TypeOrmModule.forFeature([TaxFiling]),
    MulterModule.register({
      storage: diskStorage({
        destination: (_req: any, _file, cb) => cb(null, SUBDIR),
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
          cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`);
        },
      }),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.xlsx', '.xls', '.csv'];
        const ok = allowed.includes(extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('Unsupported file type'), ok);
      },
    }),
    AuditModule,
  ],
  providers: [TaxService],
  controllers: [TaxController],
})
export class TaxModule {}
