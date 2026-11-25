import {
  Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get,
  Header, HttpException, HttpStatus, Injectable, Post, Req, UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BackupsService } from './backups.service';

@Injectable()
export class BackupTwoFactorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (user?.verified_2fa !== true) {
      throw new ForbiddenException('Sign in again and complete 2FA to access backups.');
    }
    return true;
  }
}

@Controller('backups')
@UseGuards(JwtAuthGuard, AdminGuard, BackupTwoFactorGuard)
export class BackupStatusController {
  private running = false;
  private lastStarted = 0;

  constructor(private readonly backups: BackupsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.backups.list()
      .filter((file) => /^axistra-(?:manual|scheduled)-[\d_-]+(?:-[a-f0-9]{8})?\.sql\.gz$/.test(file.name))
      .slice(0, 30);
  }

  @Get('drive/status')
  @Header('Cache-Control', 'no-store')
  driveStatus() {
    const { configured, mode, verified } = this.backups.driveStatus();
    return { configured, mode, verified };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@Body() body: { upload_to_drive?: boolean }, @Req() req: any) {
    const now = Date.now();
    if (this.running || now - this.lastStarted < 60_000) {
      throw new HttpException('A manual backup was started recently. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.running = true;
    this.lastStarted = now;
    try {
      const { drive, ...backup } = await this.backups.createBackup({
        kind: 'manual', actor: req.user, uploadToDrive: body?.upload_to_drive === true,
      });
      return { ...backup, mirrored_to_drive: !!drive };
    } finally {
      this.running = false;
    }
  }
}
