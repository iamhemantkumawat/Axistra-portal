import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MagnusService } from './magnus.service';

@UseGuards(AuthGuard('jwt'))
@Controller('magnus')
export class MagnusController {
  constructor(private svc: MagnusService) {}

  @Get('status')
  status() {
    return this.svc.status();
  }

  @Get('logs')
  logs(@Query('limit') limit?: string) {
    return this.svc.logs(limit ? parseInt(limit, 10) : 100);
  }

  @Post('sync-user')
  sync(@Body() body: any, @Req() req: any) {
    return this.svc.syncUser(body, req.user);
  }

  @Post('add-credit')
  addCredit(@Body() body: any, @Req() req: any) {
    return this.svc.addCredit(body, req.user);
  }

  @Get('user/:username')
  user(@Param('username') username: string) {
    return this.svc.user(username);
  }

  @Get('cdr/:username')
  cdr(@Param('username') username: string) {
    return this.svc.cdr(username);
  }
}
