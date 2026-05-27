import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense } from '../entities/expense.entity';
import { Vendor } from '../entities/vendor.entity';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { AuditModule } from '../audit/audit.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, Vendor]), AuditModule, WalletsModule],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService],
})
export class ExpensesModule {}
