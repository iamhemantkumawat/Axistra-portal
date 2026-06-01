import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { extname } from 'path';
import { randomUUID } from 'crypto';

import { CorporateDocument } from '../entities/corporate-document.entity';
import { CorporateDocsService } from './corporate-docs.service';
import { CorporateDocsController } from './corporate-docs.controller';
import { AuditModule } from '../audit/audit.module';

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.VAULT_UPLOAD_DIR || '/app/uploads/vault');
const SUBDIR = path.join(UPLOAD_ROOT, 'corporate');
fs.mkdirSync(SUBDIR, { recursive: true });

@Module({
  imports: [
    TypeOrmModule.forFeature([CorporateDocument]),
    MulterModule.register({
      storage: diskStorage({
        destination: (_req: any, _file, cb) => cb(null, SUBDIR),
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
          cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`);
        },
      }),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for company docs
      fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'];
        const ok = allowed.includes(extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('Unsupported file type'), ok);
      },
    }),
    AuditModule,
  ],
  providers: [CorporateDocsService],
  controllers: [CorporateDocsController],
})
export class CorporateDocsModule {}
