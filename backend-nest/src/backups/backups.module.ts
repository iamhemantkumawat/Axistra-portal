import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AppSetting } from '../entities/app-setting.entity';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { GoogleDriveService } from './google-drive.service';
import { DriveOAuthCallbackController } from './drive-oauth-callback.controller';

@Module({
  imports: [ScheduleModule.forRoot(), TypeOrmModule.forFeature([AppSetting]), AuditModule],
  controllers: [BackupsController, DriveOAuthCallbackController],
  providers: [BackupsService, GoogleDriveService],
})
export class BackupsModule {}
