import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as crypto from 'crypto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private svc: WebhooksService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('logs')
  logs(
    @Query('source') source?: string,
    @Query('processed') processed?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.listLogs({
      source,
      processed,
      q,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('logs/stats')
  stats() {
    return this.svc.stats();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('logs/:id')
  log(@Param('id') id: string) {
    return this.svc.getLog(id);
  }

  @Post('btcpay')
  btcpay(@Body() body: any, @Req() req: any, @Headers('btcpay-sig') sig?: string) {
    this.assertBtcpaySignature(req?.rawBody, sig);
    return this.svc.ingest('btcpay', body);
  }

  @Post('oxapay')
  oxapay(@Body() body: any, @Headers('x-axistra-webhook-secret') secret?: string) {
    this.assertSecret(secret);
    return this.svc.ingest('oxapay', body);
  }

  @Post('telegram-manual')
  telegramManual(@Body() body: any, @Headers('x-axistra-webhook-secret') secret?: string) {
    this.assertSecret(secret);
    return this.svc.ingest('telegram_manual', body);
  }

  @Post('recharge')
  recharge(@Body() body: any, @Headers('x-axistra-webhook-secret') secret?: string) {
    this.assertSecret(secret);
    const source = String(body.source || body.payment_gateway || body.gateway || 'manual').toLowerCase();
    if (source.includes('btcpay')) return this.svc.ingest('btcpay', body);
    if (source.includes('oxapay')) return this.svc.ingest('oxapay', body);
    if (source.includes('telegram')) return this.svc.ingest('telegram_manual', body);
    if (source.includes('manual') || source.includes('okx') || source.includes('binance')) {
      return this.svc.ingest('manual', body);
    }
    throw new BadRequestException('Unsupported webhook source');
  }

  private assertSecret(secret?: string) {
    const expected = process.env.PAYMENT_WEBHOOK_SECRET;
    if (expected && secret !== expected) throw new UnauthorizedException('Invalid webhook secret');
  }

  private assertBtcpaySignature(rawBody?: Buffer, signature?: string) {
    const secret = process.env.BTCPAY_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) return;
    if (!rawBody?.length) throw new UnauthorizedException('Missing BTCPay raw body');
    if (!signature) throw new UnauthorizedException('Missing BTCPay signature');

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = signature.replace(/^sha256=/i, '').trim().toLowerCase();
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');

    if (
      expectedBuf.length !== providedBuf.length
      || !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException('Invalid BTCPay signature');
    }
  }
}
