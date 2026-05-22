import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private svc: LeadsService) {}

  // PUBLIC: anyone can submit a lead from the marketing site
  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const saved = await this.svc.create(body, ip);
    return { id: saved.id, message: 'Thank you. Our team will reach out shortly.' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  list() {
    return this.svc.list();
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id/status')
  status(@Param('id') id: string, @Body() body: { status: string }) {
    return this.svc.updateStatus(id, body.status);
  }
}
