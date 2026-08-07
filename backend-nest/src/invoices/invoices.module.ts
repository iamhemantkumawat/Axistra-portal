import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { Recharge } from '../entities/recharge.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { AuditModule } from '../audit/audit.module';
import { FxModule } from '../fx/fx.module';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Customer, Recharge, CryptoTransaction]), AuditModule, FxModule],
  providers: [InvoicesService],
  controllers: [InvoicesController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
