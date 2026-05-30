import {
  Body, Controller, Delete, Get, Header, Param, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BackupsService } from './backups.service';

@Controller('backups')
@UseGuards(JwtAuthGuard)
export class BackupsController {
  constructor(private readonly svc: BackupsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Req() req: any) {
    return this.svc.createBackup({ kind: 'manual', actor: req.user });
  }

  @Get(':name/download')
  download(@Param('name') name: string, @Res() res: Response) {
    const fp = this.svc.fullPath(name);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    fs.createReadStream(fp).pipe(res);
  }

  @Delete(':name')
  remove(@Param('name') name: string, @Req() req: any) {
    return this.svc.deleteBackup(name, req.user);
  }

  @Post(':name/restore')
  restore(@Param('name') name: string, @Body() body: any, @Req() req: any) {
    return this.svc.restore(name, body?.confirm, req.user);
  }
}
