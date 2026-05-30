import {
  Body, Controller, Delete, Get, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { BackupsService } from './backups.service';

@Controller('backups')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BackupsController {
  constructor(private readonly svc: BackupsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body() body: { upload_to_drive?: boolean }, @Req() req: any) {
    return this.svc.createBackup({
      kind: 'manual',
      actor: req.user,
      uploadToDrive: !!body?.upload_to_drive,
    });
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

  @Post(':name/upload-to-drive')
  uploadToDrive(@Param('name') name: string, @Req() req: any) {
    return this.svc.uploadToDrive(name, req.user);
  }

  /* ---------- Restore via uploaded file ---------- */

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 * 1024 } })) // 2 GB cap
  ingest(@UploadedFile() file: any, @Req() req: any) {
    return this.svc.ingestUpload(file, req.user);
  }

  /* ---------- Google Drive ---------- */

  @Get('drive/status')
  driveStatus() {
    return this.svc.driveStatus();
  }

  @Get('drive/list')
  driveList() {
    return this.svc.listDrive();
  }

  @Delete('drive/:fileId')
  driveDelete(@Param('fileId') fileId: string, @Req() req: any) {
    return this.svc.deleteDrive(fileId, req.user);
  }

  @Post('drive/:fileId/pull')
  drivePull(@Param('fileId') fileId: string, @Body() body: { name: string }, @Req() req: any) {
    return this.svc.pullFromDrive(fileId, body?.name || `axistra-drive-${fileId}.sql.gz`, req.user);
  }
}
