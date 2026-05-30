import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Allows the request only when the authenticated user carries role === 'admin'.
 * Must be chained AFTER JwtAuthGuard so `req.user` is populated.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req?.user?.role;
    if (role !== 'admin') {
      throw new ForbiddenException('Admin role required for this action');
    }
    return true;
  }
}
