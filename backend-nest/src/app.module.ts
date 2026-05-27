import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

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
import { WalletLedger } from './entities/wallet-ledger.entity';

import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { RechargesModule } from './recharges/recharges.module';
import { InvoicesModule } from './invoices/invoices.module';
import { TreasuryModule } from './treasury/treasury.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ReportsModule } from './reports/reports.module';
import { MagnusModule } from './magnus/magnus.module';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SeedModule } from './seed/seed.module';
import { KycModule } from './kyc/kyc.module';
import { LeadsModule } from './leads/leads.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { FxModule } from './fx/fx.module';
import { WalletsModule } from './wallets/wallets.module';
import { ChainModule } from './chain/chain.module';
import { SnapshotModule } from './snapshot/snapshot.module';
import { OnchainModule } from './onchain/onchain.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      entities: [
        AdminUser, Customer, Recharge, Invoice, CryptoTransaction,
        TreasuryMovement, Expense, ComplianceLog, AuditLog,
        MagnusSyncLog, KycDocument, Setting, Lead, PaymentWebhook, TreasuryBatch,
        WalletLedger,
      ],
      synchronize: process.env.DB_SYNCHRONIZE === 'true',
      migrations: [__dirname + '/migrations/*{.js,.ts}'],
      migrationsRun: false,
      logging: false,
    }),
    AuthModule,
    CustomersModule,
    RechargesModule,
    InvoicesModule,
    TreasuryModule,
    ExpensesModule,
    ComplianceModule,
    ReportsModule,
    MagnusModule,
    AuditModule,
    DashboardModule,
    SeedModule,
    KycModule,
    LeadsModule,
    WebhooksModule,
    FxModule,
    WalletsModule,
    ChainModule,
    SnapshotModule,
    OnchainModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
