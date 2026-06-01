import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Expense } from '../entities/expense.entity';
import { Customer } from '../entities/customer.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { Invoice } from '../entities/invoice.entity';
import { PayrollRun } from '../entities/payroll-run.entity';
import { PayrollItem } from '../entities/payroll-item.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { FxModule } from '../fx/fx.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Recharge, Expense, Customer, TreasuryMovement, ComplianceLog,
      Invoice, PayrollRun, PayrollItem, BankAccount,
    ]),
    FxModule,
  ],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
