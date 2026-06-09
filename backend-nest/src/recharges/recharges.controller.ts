import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RechargesService } from './recharges.service';

@UseGuards(AuthGuard('jwt'))
@Controller('recharges')
export class RechargesController {
  constructor(private svc: RechargesService) {}

  @Get()
  list(@Query('search') search?: string, @Query('status') status?: string) {
    return this.svc.list({ search, status });
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    return this.svc.create(body, req.user);
  }

  /** Create N sibling recharges in one transaction from a single on-chain TX. */
  @Post('split')
  createSplit(@Body() body: any, @Req() req: any) {
    return this.svc.createSplit(body, req.user);
  }

  /** Add the missing sibling to an existing single-half recharge (backfill). */
  @Post(':id/add-split-sibling')
  addSplitSibling(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.addSplitSibling(id, body, req.user);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string; note?: string }, @Req() req: any) {
    return this.svc.updateStatus(id, body.status, body.note, req.user);
  }

  @Post(':id/crypto-tx')
  addCryptoTx(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.addCryptoTx(id, body, req.user);
  }

  @Post(':id/sync-magnus')
  sync(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.syncMagnus(id, body, req.user);
  }
}
