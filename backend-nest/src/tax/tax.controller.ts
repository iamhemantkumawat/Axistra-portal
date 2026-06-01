import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { TaxService } from './tax.service';

@UseGuards(AuthGuard('jwt'))
@Controller('tax')
export class TaxController {
  constructor(private svc: TaxService) {}

  @Get() list() { return this.svc.list(); }
  @Get('summary') summary() { return this.svc.summary(); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(@UploadedFile() file: any, @Body() body: any, @Req() req: any) {
    return this.svc.create(body, file, req.user);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('file'))
  async update(@Param('id') id: string, @UploadedFile() file: any, @Body() body: any, @Req() req: any) {
    return this.svc.update(id, body, file, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  @Get(':fname/file')
  async download(@Param('fname') fname: string, @Res() res: Response) {
    const fp = this.svc.fileFor(fname);
    return res.sendFile(fp);
  }
}
