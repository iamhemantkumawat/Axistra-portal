import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AdminUser } from './entities/admin-user.entity';
import { Customer } from './entities/customer.entity';
import { Recharge } from './entities/recharge.entity';
import { Invoice } from './entities/invoice.entity';
import { CryptoTransaction } from './entities/crypto-transaction.entity';
import { TreasuryMovement } from './entities/treasury-movement.entity';
import { Expense } from './entities/expense.entity';
import { ComplianceLog } from './entities/compliance-log.entity';
import { AuditLog } from './entities/audit-log.entity';
import { MagnusSyncLog } from './entities/magnus-sync-log.entity';
import { KycDocument } from './entities/kyc-document.entity';
import { Setting } from './entities/settings.entity';
import { Lead } from './entities/lead.entity';
import { PaymentWebhook } from './entities/payment-webhook.entity';
import { TreasuryBatch } from './entities/treasury-batch.entity';

dotenv.config({ path: join(__dirname, '..', '.env') });

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  entities: [
    AdminUser, Customer, Recharge, Invoice, CryptoTransaction,
    TreasuryMovement, Expense, ComplianceLog, AuditLog,
    MagnusSyncLog, KycDocument, Setting, Lead, PaymentWebhook, TreasuryBatch,
  ],
  synchronize: false,
  migrations: [join(__dirname, 'migrations', '*{.js,.ts}')],
  migrationsTableName: 'typeorm_migrations',
});
