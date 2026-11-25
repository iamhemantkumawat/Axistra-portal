import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '../entities/admin-user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(AdminUser) private readonly users: Repository<AdminUser>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }
  async validate(payload: any) {
    if (payload?.purpose !== undefined || typeof payload?.sub !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(payload.sub)) throw new UnauthorizedException();
    const user = await this.users.findOne({
      where: { id: payload.sub, is_active: true },
      select: ['id', 'email', 'role', 'two_fa_enabled'],
    });
    if (!user || user.role !== payload.role || (user.two_fa_enabled && payload.two_fa !== true)) throw new UnauthorizedException();
    return {
      id: user.id, email: user.email, role: user.role,
      verified_2fa: user.two_fa_enabled && payload.two_fa === true,
    };
  }
}
