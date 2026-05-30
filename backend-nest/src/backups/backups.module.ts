import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from '../audit/audit.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { GoogleDriveService } from './google-drive.service';

@Module({
  imports: [ScheduleModule.forRoot(), AuditModule],
  controllers: [BackupsController],
  providers: [BackupsService, GoogleDriveService],
})
export class BackupsModule {}
