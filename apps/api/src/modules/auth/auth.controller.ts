import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentAuth, Public, RateLimit, RequirePermissions } from '../../common/auth/auth.decorators';
import { PERMISSIONS } from '@kampalasmart/shared';
import { AuthService, RequestMeta } from './auth.service';
import { buildAuthCookies, clearAuthCookies, CookieToSet, IssuedTokens } from './auth.cookies';
import { REFRESH_COOKIE, CSRF_COOKIE } from '../../common/auth/auth.constants';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterBusinessDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './auth.dto';
import type { AuthUser } from '../../common/auth/auth-user';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @RateLimit({ limit: 5, windowSeconds: 3600, byEmail: true })
  @ApiOperation({ summary: 'Register a business and its owner account' })
  async register(
    @Body() dto: RegisterBusinessDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto, this.meta(req));
    this.setCookies(res, result.tokens);
    return { ...result.session, accessToken: result.tokens.accessToken };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ limit: 0, windowSeconds: 0, byEmail: true })
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, this.meta(req));
    this.setCookies(res, result.tokens);
    return { ...result.session, accessToken: result.tokens.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the session using the refresh cookie' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const result = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.meta(req));
      this.setCookies(res, result.tokens);
      return result.session;
    } catch (error) {
      this.clearCookies(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentAuth() auth: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(auth, req.cookies?.[REFRESH_COOKIE], this.meta(req));
    this.clearCookies(res);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the current session context' })
  async me(@CurrentAuth() auth: AuthUser, @Req() req: Request) {
    const session = await this.auth.me(auth);
    return { ...session, csrfToken: req.cookies?.[CSRF_COOKIE] ?? '' };
  }

  @Patch('password')
  @RequirePermissions(PERMISSIONS.BUSINESS_READ)
  @ApiOperation({ summary: 'Change your own password' })
  changePassword(
    @CurrentAuth() auth: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(auth, dto, this.meta(req));
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 3600, byEmail: true })
  @ApiOperation({ summary: 'Request a password reset link' })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.auth.requestPasswordReset(dto, this.meta(req));
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Complete a password reset' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto, this.meta(req));
  }

  @Post('email/verification')
  @RequirePermissions(PERMISSIONS.BUSINESS_READ)
  @ApiOperation({ summary: 'Send an email verification link' })
  requestVerification(@CurrentAuth() auth: AuthUser) {
    return this.auth.requestEmailVerification(auth);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Verify an email address using a token' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Get('sessions')
  @RequirePermissions(PERMISSIONS.BUSINESS_READ)
  @ApiOperation({ summary: 'List your active sessions' })
  sessions(@CurrentAuth() auth: AuthUser) {
    return this.auth.listSessions(auth);
  }

  @Delete('sessions/:id')
  @RequirePermissions(PERMISSIONS.BUSINESS_READ)
  @ApiOperation({ summary: 'Revoke one of your sessions' })
  revokeSession(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.auth.revokeSession(auth, id, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: req.requestId ?? null,
    };
  }

  private setCookies(res: Response, tokens: IssuedTokens): void {
    for (const cookie of buildAuthCookies(tokens, this.config)) this.writeCookie(res, cookie);
  }

  private clearCookies(res: Response): void {
    for (const cookie of clearAuthCookies(this.config)) this.writeCookie(res, cookie);
  }

  private writeCookie(res: Response, cookie: CookieToSet): void {
    res.cookie(cookie.name, cookie.value, cookie.options);
  }
}
