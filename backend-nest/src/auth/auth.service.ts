import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from '../entities/admin-user.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AdminUser) private adminRepo: Repository<AdminUser>,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    const user = await this.adminRepo.findOne({ where: { email } });
    if (!user || !user.is_active) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    user.last_login_at = new Date();
    user.last_login_ip = ip || null;
    await this.adminRepo.save(user);
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' },
    );
    await this.audit.log({
      actor_id: user.id,
      actor_email: user.email,
      action: 'login',
      entity_type: 'admin_user',
      entity_id: user.id,
      ip_address: ip,
    });
    return {
      token,
      user: {
        id: user.id, email: user.email, full_name: user.full_name,
        role: user.role, two_fa_enabled: user.two_fa_enabled,
      },
    };
  }

  async me(userId: string) {
    const user = await this.adminRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id, email: user.email, full_name: user.full_name,
      role: user.role, two_fa_enabled: user.two_fa_enabled,
      last_login_at: user.last_login_at,
    };
  }

  async listAdmins() {
    const list = await this.adminRepo.find({ order: { created_at: 'DESC' } });
    return list.map((u) => ({
      id: u.id, email: u.email, full_name: u.full_name, role: u.role,
      is_active: u.is_active, last_login_at: u.last_login_at,
      two_fa_enabled: u.two_fa_enabled, created_at: u.created_at,
    }));
  }

  async createAdmin(data: { email: string; password: string; full_name?: string; role?: string }) {
    const exists = await this.adminRepo.findOne({ where: { email: data.email } });
    if (exists) throw new UnauthorizedException('Email already exists');
    const hash = await bcrypt.hash(data.password, 10);
    const user = this.adminRepo.create({
      email: data.email,
      password_hash: hash,
      full_name: data.full_name || data.email.split('@')[0],
      role: data.role || 'admin',
    });
    return this.adminRepo.save(user);
  }
}
