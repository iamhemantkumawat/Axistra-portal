import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
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

  @Get('batches')
  batches() {
    return this.svc.listBatches();
  }

  @Get('batches/:id')
  batch(@Param('id') id: string) {
    return this.svc.getBatch(id);
  }

  @Post('batches')
  createBatch(@Body() body: any, @Req() req: any) {
    return this.svc.createBatch(body, req.user);
  }

  @Patch('batches/:id')
  updateBatch(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateBatch(id, body, req.user);
  }

  @Post('batches/:id/assign')
  assignBatch(@Param('id') id: string, @Body() body: { recharge_ids: string[] }, @Req() req: any) {
    return this.svc.assignBatch(id, body.recharge_ids || [], req.user);
  }

  @Post('batches/:id/verify-btc-transfer')
  verifyBtcBatchTransfer(@Param('id') id: string, @Req() req: any) {
    return this.svc.verifyBtcBatchTransfer(id, req.user);
  }

  @Post('btcpay/:rechargeId/verify')
  verifyBtcpay(@Param('rechargeId') id: string, @Req() req: any) {
    return this.svc.verifyBtcpayRecharge(id, req.user);
  }
}
