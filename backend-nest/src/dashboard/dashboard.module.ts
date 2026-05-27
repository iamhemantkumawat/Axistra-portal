import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Expense } from '../entities/expense.entity';
import { Customer } from '../entities/customer.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { FxModule } from '../fx/fx.module';

@Module({
  imports: [TypeOrmModule.forFeature([Recharge, Expense, Customer, TreasuryMovement, ComplianceLog]), FxModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
