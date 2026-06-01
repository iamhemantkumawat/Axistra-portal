import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CorporateDocsService } from './corporate-docs.service';

@UseGuards(AuthGuard('jwt'))
@Controller('corporate-docs')
export class CorporateDocsController {
  constructor(private svc: CorporateDocsService) {}

  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(@UploadedFile() file: any, @Body() body: any, @Req() req: any) {
    if (!file) throw new BadRequestException('File is required');
    return this.svc.create(file, body, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.update(id, body, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  // Use a 'file' suffix so the URL is /api/corporate-docs/:fname/file
  @Get(':fname/file')
  async download(@Param('fname') fname: string, @Res() res: Response) {
    const fp = this.svc.fileFor(fname);
    return res.sendFile(fp);
  }
}
