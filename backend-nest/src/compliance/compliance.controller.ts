import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ComplianceService } from './compliance.service';

@UseGuards(AuthGuard('jwt'))
@Controller('compliance')
export class ComplianceController {
  constructor(private svc: ComplianceService) {}

  @Get()
  list(@Query('customer_id') customer_id?: string, @Query('risk_level') risk_level?: string) {
    return this.svc.list({ customer_id, risk_level });
  }

  @Post('log')
  log(@Body() body: any, @Req() req: any) {
    return this.svc.log(body, req.user);
  }

  @Post('request-kyc')
  requestKyc(@Body() body: any, @Req() req: any) {
    return this.svc.requestKyc(body, req.user);
  }

  @Post('block-user')
  block(@Body() body: any, @Req() req: any) {
    return this.svc.blockUser(body, req.user);
  }

  @Post('mark-high-risk')
  highRisk(@Body() body: any, @Req() req: any) {
    return this.svc.markHighRisk(body, req.user);
  }

  @Post('refund')
  refund(@Body() body: any, @Req() req: any) {
    return this.svc.refund(body, req.user);
  }
}
