import { Body, Controller, Get, HttpCode, NotImplementedException, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @HttpCode(200)
  @Post('login')
  async login(@Body() body: { email: string; password: string }, @Req() req: any) {
    const ip = req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress;
    return this.auth.login(body.email, body.password, Array.isArray(ip) ? ip[0] : ip);
  }

  @Post('logout')
  async logout() {
    return { success: true };
  }

  @Post('2fa/verify')
  async verify2fa() {
    throw new NotImplementedException('2FA verification is not configured yet');
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async me(@Req() req: any) {
    return this.auth.me(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('admins')
  async listAdmins() {
    return this.auth.listAdmins();
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('admins')
  async createAdmin(@Body() body: any) {
    const created = await this.auth.createAdmin(body);
    return { id: created.id, email: created.email, full_name: created.full_name, role: created.role };
  }
}
