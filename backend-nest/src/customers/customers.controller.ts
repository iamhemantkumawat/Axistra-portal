import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomersService } from './customers.service';

@UseGuards(AuthGuard('jwt'))
@Controller('customers')
export class CustomersController {
  constructor(private svc: CustomersService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('risk_level') risk_level?: string,
    @Query('status') status?: string,
    @Query('kyc_status') kyc_status?: string,
  ) {
    return this.svc.list({ search, risk_level, status, kyc_status });
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    return this.svc.create(body, req.user);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.update(id, body, req.user);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user);
  }
}
