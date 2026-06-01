import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConversionRegisterService } from './conversion-register.service';

@UseGuards(AuthGuard('jwt'))
@Controller('conversion-register')
export class ConversionRegisterController {
  constructor(private svc: ConversionRegisterService) {}

  @Get()
  list(@Query() q: any) {
    return this.svc.list({ from: q.from, to: q.to, status: q.status, currency: q.currency });
  }

  @Get('summary')
  summary(@Query() q: any) {
    return this.svc.summary({ from: q.from, to: q.to });
  }
}
