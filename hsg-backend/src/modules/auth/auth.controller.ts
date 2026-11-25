import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiError } from '../../common/errors';
import { RegisterDto } from './register.dto';
import { Public } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from '../fiat/dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/login -> {token, role, user}. Also sets the `hsg_token` cookie the guard accepts. */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.email, body.password);
    res.cookie('hsg_token', result.token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
    return result;
  }

  /**
   * POST /api/auth/register (public) -> {token, role, user}, signed in. The business starts KYB PENDING.
   * Throttled per client IP (in-memory, 5 sign-ups per 10 minutes) to blunt scripted account creation.
   */
  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() body: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.throttle(req.ip ?? 'unknown');
    const result = await this.auth.register(body);
    res.cookie('hsg_token', result.token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
    return result;
  }

  private readonly signups = new Map<string, number[]>();
  private throttle(ip: string, max = 5, windowMs = 10 * 60 * 1000) {
    const now = Date.now();
    const recent = (this.signups.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) throw new ApiError('RATE_LIMITED', 'Too many sign-ups from this network. Try again in a few minutes.');
    recent.push(now);
    this.signups.set(ip, recent);
  }

  /** POST /api/auth/logout clears the cookie (bearer tokens simply expire). */
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('hsg_token');
    return { ok: true };
  }
}
