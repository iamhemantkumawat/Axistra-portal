import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { Expense } from '../entities/expense.entity';
import { ChainController } from './chain.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WalletLedger, Recharge, Invoice, Customer, Expense])],
  controllers: [ChainController],
})
export class ChainModule {}
