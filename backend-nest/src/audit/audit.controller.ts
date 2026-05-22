import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuditService } from './audit.service';

@UseGuards(AuthGuard('jwt'))
@Controller('audit-logs')
export class AuditController {
  constructor(private svc: AuditService) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    return this.svc.list(limit ? parseInt(limit, 10) : 200);
  }
}
