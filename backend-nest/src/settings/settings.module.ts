import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReceivingWallet } from '../entities/receiving-wallet.entity';
import { Vendor } from '../entities/vendor.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([ReceivingWallet, Vendor]), AuditModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
