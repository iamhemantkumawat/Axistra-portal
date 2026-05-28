import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentWebhook } from '../entities/payment-webhook.entity';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { RechargesModule } from '../recharges/recharges.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { OxaPaySyncService } from './oxapay-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentWebhook, WalletLedger, Recharge, CryptoTransaction]),
    ScheduleModule.forRoot(),
    RechargesModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, OxaPaySyncService],
})
export class WebhooksModule {}
