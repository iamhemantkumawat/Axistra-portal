import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { InvoicesService } from './invoices.service';

@UseGuards(AuthGuard('jwt'))
@Controller('invoices')
export class InvoicesController {
  constructor(private svc: InvoicesService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post('generate')
  generate(@Body() body: any, @Req() req: any) {
    return this.svc.generate(body, req.user);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Get(':id/html')
  async html(@Param('id') id: string, @Query('style') style: string, @Res() res: Response) {
    const html = await this.svc.html(id, (style === 'minimal' ? 'minimal' : 'branded'));
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Query('style') style: string, @Res() res: Response) {
    const variant = (style === 'minimal' ? 'minimal' : 'branded') as 'minimal' | 'branded';
    const buf = await this.svc.pdf(id, variant);
    const inv = await this.svc.get(id);
    const isPdf = buf.slice(0, 4).toString() === '%PDF';
    res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'text/html');
    if (isPdf) {
      res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}-${variant}.pdf"`);
    }
    res.send(buf);
  }
}
