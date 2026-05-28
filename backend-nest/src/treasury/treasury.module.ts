import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { Recharge } from '../entities/recharge.entity';
import { TreasuryBatch } from '../entities/treasury-batch.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { AuditModule } from '../audit/audit.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([TreasuryMovement, Recharge, TreasuryBatch, CryptoTransaction]), AuditModule, WalletsModule],
  providers: [TreasuryService],
  controllers: [TreasuryController],
})
export class TreasuryModule {}
