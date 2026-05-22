import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DashboardService } from './dashboard.service';

@UseGuards(AuthGuard('jwt'))
@Controller('dashboard')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  @Get('kpis')
  kpis() { return this.svc.kpis(); }

  @Get('chart')
  chart() { return this.svc.chart(); }

  @Get('recent')
  recent() { return this.svc.recent(); }
}
