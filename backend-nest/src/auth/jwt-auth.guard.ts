import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Thin alias around passport-jwt's AuthGuard('jwt') so feature modules can
 * import a stable type instead of stringly-typed strategy keys.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
