import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { KycService } from './kyc.service';

@UseGuards(AuthGuard('jwt'))
@Controller('kyc')
export class KycController {
  constructor(private svc: KycService) {}

  @Get(':customerId')
  list(@Param('customerId') customerId: string) {
    return this.svc.list(customerId);
  }

  @Post(':customerId/upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('customerId') customerId: string,
    @UploadedFile() file: any,
    @Body('document_type') documentType: string,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.svc.upload(customerId, file, documentType, req.user);
  }

  /**
   * Multi-file variant — accept up to 10 files in a single request. Useful
   * when uploading both sides of an ID, passport front/back, or a multi-page
   * proof. The `document_type` is shared by all files in the batch.
   */
  @Post(':customerId/upload-multi')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMulti(
    @Param('customerId') customerId: string,
    @UploadedFiles() files: any[],
    @Body('document_type') documentType: string,
    @Req() req: any,
  ) {
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');
    const saved = [] as any[];
    for (const f of files) {
      saved.push(await this.svc.upload(customerId, f, documentType, req.user));
    }
    return { uploaded: saved.length, documents: saved };
  }

  @Patch('document/:id')
  review(
    @Param('id') id: string,
    @Body() body: { status: 'approved' | 'rejected'; comment?: string },
    @Req() req: any,
  ) {
    return this.svc.review(id, body.status, body.comment || '', req.user);
  }

  @Delete('document/:id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  @Get(':customerId/file/:fileName')
  async file(
    @Param('customerId') customerId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const filePath = await this.svc.download(customerId, fileName);
    return res.sendFile(filePath);
  }
}
