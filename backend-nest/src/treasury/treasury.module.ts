import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { Recharge } from '../entities/recharge.entity';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([TreasuryMovement, Recharge]), AuditModule],
  providers: [TreasuryService],
  controllers: [TreasuryController],
})
export class TreasuryModule {}
