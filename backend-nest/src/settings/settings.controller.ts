import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SettingsService } from './settings.service';

@UseGuards(AuthGuard('jwt'))
@Controller('settings')
export class SettingsController {
  constructor(private svc: SettingsService) {}

  // -------- Receiving Wallets --------
  @Get('receiving-wallets')
  listWallets() {
    return this.svc.listWallets();
  }

  @Post('receiving-wallets')
  createWallet(@Body() body: any, @Req() req: any) {
    return this.svc.createWallet(body, req.user);
  }

  @Patch('receiving-wallets/:id')
  updateWallet(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateWallet(id, body, req.user);
  }

  @Delete('receiving-wallets/:id')
  deleteWallet(@Param('id') id: string, @Req() req: any) {
    return this.svc.deleteWallet(id, req.user);
  }

  // -------- Vendors --------
  @Get('vendors')
  listVendors() {
    return this.svc.listVendors();
  }

  @Post('vendors')
  createVendor(@Body() body: any, @Req() req: any) {
    return this.svc.createVendor(body, req.user);
  }

  @Patch('vendors/:id')
  updateVendor(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateVendor(id, body, req.user);
  }

  @Delete('vendors/:id')
  deleteVendor(@Param('id') id: string, @Req() req: any) {
    return this.svc.deleteVendor(id, req.user);
  }
}
