import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { MagnusSyncLog } from '../entities/magnus-sync-log.entity';
import { ReceivingWallet } from '../entities/receiving-wallet.entity';
import { RechargesService } from './recharges.service';
import { RechargesController } from './recharges.controller';
import { AuditModule } from '../audit/audit.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { MagnusModule } from '../magnus/magnus.module';
import { FxModule } from '../fx/fx.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recharge, Invoice, Customer, CryptoTransaction, TreasuryMovement, MagnusSyncLog, ReceivingWallet]),
    AuditModule, InvoicesModule, MagnusModule, FxModule, WalletsModule,
  ],
  providers: [RechargesService],
  controllers: [RechargesController],
  exports: [RechargesService],
})
export class RechargesModule {}
