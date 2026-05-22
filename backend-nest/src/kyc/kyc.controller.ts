import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Patch('document/:id')
  review(
    @Param('id') id: string,
    @Body() body: { status: 'approved' | 'rejected'; comment?: string },
    @Req() req: any,
  ) {
    return this.svc.review(id, body.status, body.comment || '', req.user);
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
