import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get()
  root() {
    return { service: 'Axistra Compliance + Accounting Portal', status: 'ok' };
  }

  @Get('health')
  health() {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  }
}
