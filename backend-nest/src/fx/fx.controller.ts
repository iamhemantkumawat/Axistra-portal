import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FxService } from './fx.service';
import { AdminGuard } from '../auth/admin.guard';

@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rates')
  async rates(@Query('refresh') refresh?: string) {
    return this.fx.getRates(refresh === '1' || refresh === 'true');
  }

  @Get('settings')
  @UseGuards(AuthGuard('jwt'))
  async getSettings() {
    return this.fx.getFxSettings();
  }

  @Put('settings')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async updateSettings(@Body() body: any, @Req() req: any) {
    return this.fx.setFxSettings(body || {}, req?.user?.email);
  }
}
