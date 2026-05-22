import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { extname } from 'path';
import { randomUUID } from 'crypto';

import { KycDocument } from '../entities/kyc-document.entity';
import { Customer } from '../entities/customer.entity';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { AuditModule } from '../audit/audit.module';

const UPLOAD_ROOT = process.env.KYC_UPLOAD_DIR || '/app/uploads/kyc';
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

@Module({
  imports: [
    TypeOrmModule.forFeature([KycDocument, Customer]),
    MulterModule.register({
      storage: diskStorage({
        destination: (req: any, _file, cb) => {
          const customerId = req.params?.customerId || 'misc';
          const dir = path.join(UPLOAD_ROOT, customerId);
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
          cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
        const ok = allowed.includes(extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('Unsupported file type'), ok);
      },
    }),
    AuditModule,
  ],
  providers: [KycService],
  controllers: [KycController],
})
export class KycModule {}
