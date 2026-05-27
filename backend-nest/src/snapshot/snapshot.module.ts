import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { SnapshotController } from './snapshot.controller';
@Module({ imports: [TypeOrmModule.forFeature([WalletLedger])], controllers: [SnapshotController] })
export class SnapshotModule {}
