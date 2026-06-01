import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../entities/employee.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { PayrollRun } from '../entities/payroll-run.entity';
import { PayrollItem } from '../entities/payroll-item.entity';
import { Expense } from '../entities/expense.entity';
import { AppSetting } from '../entities/app-setting.entity';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { EmploymentChange } from '../entities/employment-change.entity';
import { AuditModule } from '../audit/audit.module';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { SignLetterController } from './sign-letter.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee, BankAccount, PayrollRun, PayrollItem, Expense,
      AppSetting, WalletLedger, EmploymentChange,
    ]),
    AuditModule,
  ],
  controllers: [PayrollController, SignLetterController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
