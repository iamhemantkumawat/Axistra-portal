import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AppSetting } from '../entities/app-setting.entity';
import { BackupsService } from './backups.service';
import { GoogleDriveService } from './google-drive.service';
import { BackupStatusController, BackupTwoFactorGuard } from './backup-status.controller';

@Module({
  imports: [ScheduleModule.forRoot(), TypeOrmModule.forFeature([AppSetting]), AuditModule],
  // Downloads, arbitrary uploads, and restores remain operator-only.
  controllers: [BackupStatusController],
  providers: [BackupsService, GoogleDriveService, BackupTwoFactorGuard],
})
export class BackupsModule {}
