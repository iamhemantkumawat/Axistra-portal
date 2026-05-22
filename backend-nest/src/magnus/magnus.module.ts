import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MagnusSyncLog } from '../entities/magnus-sync-log.entity';
import { MagnusService } from './magnus.service';
import { MagnusController } from './magnus.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([MagnusSyncLog]), AuditModule],
  providers: [MagnusService],
  controllers: [MagnusController],
})
export class MagnusModule {}
