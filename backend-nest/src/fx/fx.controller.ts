import { Controller, Get, Query } from '@nestjs/common';
import { FxService } from './fx.service';

@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rates')
  async rates(@Query('refresh') refresh?: string) {
    return this.fx.getRates(refresh === '1' || refresh === 'true');
  }
}
