import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiError } from '../../common/errors';

export interface AuthUser { userId: string; role: 'SME' | 'OPERATOR'; smeId: string | null; email: string; }
export const ROLES_KEY = 'roles';
/** @Roles('SME') or @Roles('OPERATOR') on a controller or handler. Omit for any signed-in user. */
export const Roles = (...roles: ('SME' | 'OPERATOR')[]) => SetMetadata(ROLES_KEY, roles);
export const IS_PUBLIC = 'isPublic';
/** Skips auth entirely (login, webhook sink). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** @CurrentUser() user: AuthUser */
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser);

/** Global guard: bearer JWT or `hsg_token` cookie. Role in the token decides which group is reachable. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.hsg_token;
    if (!token) throw new ApiError('UNAUTHORIZED', 'Sign in required');
    try {
      const p: any = await this.jwt.verifyAsync(token);
      req.user = { userId: p.sub, role: p.role, smeId: p.smeId ?? null, email: p.email } as AuthUser;
    } catch {
      throw new ApiError('UNAUTHORIZED', 'Session expired, sign in again');
    }
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ApiError('FORBIDDEN', 'Not allowed for this role');
    return true;
  }
}
