import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { PayrollService } from './payroll.service';

@UseGuards(AuthGuard('jwt'))
@Controller('payroll')
export class PayrollController {
  constructor(private svc: PayrollService) {}

  // ---------- Employees ----------
  @Get('employees') listEmployees() { return this.svc.listEmployees(); }
  @Post('employees') createEmployee(@Body() b: any, @Req() r: any) { return this.svc.createEmployee(b, r.user); }
  @Get('employees/:id') getEmployee(@Param('id') id: string) { return this.svc.getEmployee(id); }
  @Patch('employees/:id') updateEmployee(@Param('id') id: string, @Body() b: any, @Req() r: any) { return this.svc.updateEmployee(id, b, r.user); }
  @Delete('employees/:id') deleteEmployee(@Param('id') id: string, @Req() r: any) { return this.svc.deleteEmployee(id, r.user); }

  @Get('employees/:id/offer-letter.pdf')
  async offerLetter(@Param('id') id: string, @Res() res: Response) {
    const { filename, buffer } = await this.svc.employeeOfferLetterPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  // ---------- Bank Accounts ----------
  @Get('bank-accounts') listBanks() { return this.svc.listBankAccounts(); }
  @Post('bank-accounts') createBank(@Body() b: any, @Req() r: any) { return this.svc.createBankAccount(b, r.user); }
  @Patch('bank-accounts/:id') updateBank(@Param('id') id: string, @Body() b: any, @Req() r: any) { return this.svc.updateBankAccount(id, b, r.user); }
  @Delete('bank-accounts/:id') deleteBank(@Param('id') id: string, @Req() r: any) { return this.svc.deleteBankAccount(id, r.user); }

  // ---------- Runs ----------
  @Get('runs') listRuns() { return this.svc.listRuns(); }
  @Post('runs') createRun(@Body() b: any, @Req() r: any) { return this.svc.createRun(b, r.user); }
  @Get('runs/:id') getRun(@Param('id') id: string) { return this.svc.getRun(id); }
  @Patch('runs/:id') updateRun(@Param('id') id: string, @Body() b: any, @Req() r: any) { return this.svc.updateRun(id, b, r.user); }

  @HttpCode(200)
  @Post('runs/:id/approve') approve(@Param('id') id: string, @Req() r: any) { return this.svc.approveRun(id, r.user); }

  @HttpCode(200)
  @Post('runs/:id/mark-paid') markPaid(@Param('id') id: string, @Body() b: any, @Req() r: any) { return this.svc.markRunPaid(id, b, r.user); }

  @HttpCode(200)
  @Post('runs/:id/cancel') cancel(@Param('id') id: string, @Req() r: any) { return this.svc.cancelRun(id, r.user); }

  @HttpCode(200)
  @Post('sync-to-ledger')
  syncToLedger(@Req() r: any) { return this.svc.syncPaidRunsToLedger(r.user); }

  @Get('runs/:id/board-resolution.pdf')
  async resolutionPdf(@Param('id') id: string, @Res() res: Response) {
    const { filename, buffer } = await this.svc.runResolutionPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  // ---------- Items ----------
  @Patch('items/:id') updateItem(@Param('id') id: string, @Body() b: any, @Req() r: any) { return this.svc.updateItem(id, b, r.user); }

  @Get('items/:id/salary-slip.pdf')
  async slip(@Param('id') id: string, @Res() res: Response) {
    const { filename, buffer } = await this.svc.itemSalarySlipPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('items/:id/transfer-proof')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProof(@Param('id') id: string, @UploadedFile() file: any, @Req() r: any) {
    if (!file) return { ok: false, error: 'No file uploaded' };
    return this.svc.uploadTransferProof(id, file, r.user);
  }

  @Get('items/:id/transfer-proof')
  async downloadProof(@Param('id') id: string, @Res() res: Response) {
    const f = await this.svc.transferProofFile(id);
    if (!f) throw new NotFoundException('No transfer proof uploaded');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="${f.filename}"`);
    res.send(f.buffer);
  }

  // ---------- Register Excel ----------
  @Get('register.xlsx')
  async register(@Res() res: Response) {
    const buf = await this.svc.payrollRegisterXlsx();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="axistra-payroll-register-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  }

  // ---------- Branding ----------
  @Get('branding') getBranding() { return this.svc.getBranding(); }
  @Post('branding') setBranding(@Body() b: any) { return this.svc.setBranding(b); }

  // ---------- One-shot seed ----------
  @HttpCode(200)
  @Post('seed') seed() { return this.svc.seedIfEmpty(); }

  // ---------- Employment History (per employee) ----------
  @Get('employees/:id/history') listHistory(@Param('id') id: string) { return this.svc.listChangesForEmployee(id); }

  @HttpCode(200)
  @Post('employees/:id/change-salary')
  changeSalary(@Param('id') id: string, @Body() body: any, @Req() r: any) {
    return this.svc.changeSalary(id, body, r.user);
  }

  @HttpCode(200)
  @Post('employees/:id/change-position')
  changePosition(@Param('id') id: string, @Body() body: any, @Req() r: any) {
    return this.svc.changePosition(id, body, r.user);
  }

  @Get('changes/:id') getChange(@Param('id') id: string) { return this.svc.getChange(id); }

  @Get('changes/:id/letter.pdf')
  async changeLetter(@Param('id') id: string, @Res() res: Response) {
    const { filename, buffer } = await this.svc.changeLetterPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  @HttpCode(200)
  @Post('changes/:id/rotate-sign-token')
  rotateSign(@Param('id') id: string, @Req() r: any) {
    return this.svc.rotateSignToken(id, r.user);
  }
}
