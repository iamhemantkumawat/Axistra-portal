import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
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

  @Delete('batches/:id')
  deleteBatch(@Param('id') id: string, @Req() req: any) {
    return this.svc.deleteBatch(id, req.user);
  }

  @Post('backfill-orphan-conversions')
  backfillOrphanConversions(@Body() body: { dry_run?: boolean }, @Req() req: any) {
    return this.svc.backfillOrphanConversions({ dryRun: !!body?.dry_run }, req.user);
  }

  @Get('customer-profit-by-conversion')
  customerProfitByConversion() {
    return this.svc.customerProfitByConversion();
  }

  @Get('chain/:rechargeId')
  chain(@Param('rechargeId') id: string) {
    return this.svc.auditChainForRecharge(id);
  }

  @Post('import-bank-statement')
  importBankStatement(@Body() body: any, @Req() req: any) {
    return this.svc.importBankStatement(body, req.user);
  }

  @Post('exchange-convert')
  exchangeConvert(@Body() body: any, @Req() req: any) {
    return this.svc.recordExchangeConversion(body, req.user);
  }

  @Post('wio-deposit')
  wioDeposit(@Body() body: any, @Req() req: any) {
    return this.svc.recordWioDeposit(body, req.user);
  }

  @Post('wio-fx')
  wioFx(@Body() body: any, @Req() req: any) {
    return this.svc.recordWioFx(body, req.user);
  }

  @Post('batches/:id/sync-ledger')
  syncBatchLedger(@Param('id') id: string, @Req() req: any) {
    return this.svc.syncBatchLedger(id, req.user);
  }

  @Delete('batches/:id/step/:step')
  clearStep(@Param('id') id: string, @Param('step') step: any, @Req() req: any) {
    return this.svc.clearBatchStep(id, step, req.user);
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
