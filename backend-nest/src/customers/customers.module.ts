import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../entities/customer.entity';
import { KycDocument } from '../entities/kyc-document.entity';
import { Invoice } from '../entities/invoice.entity';
import { Recharge } from '../entities/recharge.entity';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { AuditModule } from '../audit/audit.module';
import { RechargesModule } from '../recharges/recharges.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, KycDocument, Invoice, Recharge]),
    AuditModule,
    forwardRef(() => RechargesModule),
  ],
  providers: [CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
