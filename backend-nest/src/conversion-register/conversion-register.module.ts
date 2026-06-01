import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { TreasuryBatch } from '../entities/treasury-batch.entity';
import { ConversionRegisterService } from './conversion-register.service';
import { ConversionRegisterController } from './conversion-register.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recharge, Customer, Invoice, CryptoTransaction, TreasuryMovement, TreasuryBatch]),
  ],
  controllers: [ConversionRegisterController],
  providers: [ConversionRegisterService],
})
export class ConversionRegisterModule {}
