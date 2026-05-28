import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletsService, WALLETS } from './wallets.service';
import { WalletCode } from '../entities/wallet-ledger.entity';

@UseGuards(AuthGuard('jwt'))
@Controller('wallets')
export class WalletsController {
  constructor(private svc: WalletsService) {}

  @Get('config')
  config() { return WALLETS; }

  @Get('overview')
  overview() { return this.svc.overview(); }

  @Get(':wallet/balances')
  balances(@Param('wallet') wallet: WalletCode) { return this.svc.balances(wallet); }

  @Get(':wallet/ledger')
  ledger(
    @Param('wallet') wallet: WalletCode,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('coin') coin?: string,
    @Query('tx_type') tx_type?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.ledgerFor(wallet, {
      from, to, coin, tx_type, search,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('ledger/:id')
  one(@Param('id') id: string) { return this.svc.getOne(id); }

  @Delete('ledger/:id')
  removeOne(@Param('id') id: string, @Req() req: any) { return this.svc.deleteLedgerRow(id, req.user); }

  @Post(':wallet/send-batch')
  send(@Param('wallet') wallet: WalletCode, @Body() body: any, @Req() req: any) {
    return this.svc.sendBatch({ ...body, from_wallet: wallet }, req.user);
  }

  @Post(':wallet/convert')
  convert(@Param('wallet') wallet: WalletCode, @Body() body: any, @Req() req: any) {
    return this.svc.convert({ ...body, wallet }, req.user);
  }

  @Post(':wallet/cashout')
  cashout(@Param('wallet') wallet: WalletCode, @Body() body: any, @Req() req: any) {
    return this.svc.cashout({ ...body, from_wallet: wallet }, req.user);
  }
}
