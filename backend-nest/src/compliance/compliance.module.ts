import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { Customer } from '../entities/customer.entity';
import { KycDocument } from '../entities/kyc-document.entity';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([ComplianceLog, Customer, KycDocument]), AuditModule],
  providers: [ComplianceService],
  controllers: [ComplianceController],
})
export class ComplianceModule {}
