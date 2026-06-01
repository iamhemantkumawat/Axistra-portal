import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
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

  @Get('top-customers')
  topCustomers() { return this.svc.topCustomers(); }

  @Get('net-worth')
  netWorth() { return this.svc.netWorth(); }

  @Get('net-worth/pdf')
  async netWorthPdf(@Res() res: Response) {
    const { filename, buffer } = await this.svc.netWorthPdf();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }
}
