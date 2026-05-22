import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TreasuryService } from './treasury.service';

@UseGuards(AuthGuard('jwt'))
@Controller('treasury')
export class TreasuryController {
  constructor(private svc: TreasuryService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get('reconciliation')
  recon() {
    return this.svc.reconciliation();
  }

  @Post('movement/:rechargeId')
  upsert(@Param('rechargeId') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.upsertMovement(id, body, req.user);
  }
}
