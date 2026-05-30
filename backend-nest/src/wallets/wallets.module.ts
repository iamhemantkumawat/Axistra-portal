import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { TreasuryBatch } from '../entities/treasury-batch.entity';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { WalletLedgerMigrator } from './wallet-ledger.migrator';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([WalletLedger, Recharge, TreasuryMovement, TreasuryBatch]), AuditModule],
  providers: [WalletsService, WalletLedgerMigrator],
  controllers: [WalletsController],
  exports: [WalletsService],
})
export class WalletsModule {}
