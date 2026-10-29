import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserStatus } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  AuthSession,
  TRIAL_DAYS,
  UserRole,
} from '@kampalasmart/shared';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { EmailService } from '../../common/email/email.service';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  toBusinessDto,
  toLocationDto,
  toSessionUser,
} from '../../common/serializers';
import type { AuthUser } from '../../common/auth/auth-user';
import { IssuedTokens } from './auth.cookies';
import {
  ACCOUNT_LOCK_MINUTES,
  MAX_FAILED_LOGINS,
} from '../../common/auth/auth.constants';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterBusinessDto,
  ResetPasswordDto,
} from './auth.dto';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuthResult {
  session: AuthSession;
  tokens: IssuedTokens;
}

type UserForSession = Prisma.UserGetPayload<{
  include: {
    business: true;
    locations: { include: { location: true } };
  };
}>;

const RESET_TOKEN_TTL_MINUTES = 30;
const EMAIL_TOKEN_TTL_HOURS = 48;

// Pre-computed hash keeps login timing roughly constant for unknown emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-dummy-value', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async register(dto: RegisterBusinessDto, meta: RequestMeta): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw ApiException.conflict('An account with this email already exists.', 'EMAIL_IN_USE');
    }
    const passwordHash = await this.hashPassword(dto.password);
    const slug = await this.uniqueSlug(dto.businessName);
    const currency = (dto.currency ?? 'UGX').toUpperCase();

    const created = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: dto.businessName,
          slug,
          currency,
          timezone: 'Africa/Kampala',
          locale: currency === 'UGX' ? 'en-UG' : 'en-US',
          phone: dto.phone ?? null,
          plan: 'STARTER',
          subscriptionStatus: 'TRIAL',
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
          taxEnabled: false,
          taxRate: new Prisma.Decimal(0),
        },
      });
      const location = await tx.location.create({
        data: {
          businessId: business.id,
          name: 'Main Branch',
          code: 'MAIN',
          phone: dto.phone ?? null,
          isDefault: true,
        },
      });
      const user = await tx.user.create({
        data: {
          businessId: business.id,
          name: dto.ownerName,
          email: dto.email,
          passwordHash,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      await tx.userLocation.create({ data: { userId: user.id, locationId: location.id } });
      await this.audit.record(
        {
          businessId: business.id,
          action: AUDIT_ACTIONS.BUSINESS_CREATED,
          entityType: 'Business',
          entityId: business.id,
          actor: { id: user.id, name: user.name, role: 'OWNER', ...meta },
          after: { name: business.name, currency: business.currency, plan: business.plan },
        },
        tx,
      );
      await this.audit.record(
        {
          businessId: business.id,
          action: AUDIT_ACTIONS.USER_CREATED,
          entityType: 'User',
          entityId: user.id,
          actor: { id: user.id, name: user.name, role: 'OWNER', ...meta },
          after: { name: user.name, email: user.email, role: user.role },
        },
        tx,
      );
      return { business, location, user };
    });

    const issued = await this.issueSession(created.user.id, meta, false);
    const session: AuthSession = {
      user: toSessionUser(created.user, [created.location.id]),
      business: toBusinessDto(created.business),
      locations: [toLocationDto(created.location)],
      csrfToken: issued.tokens.csrfToken,
    };

    await this.sendVerificationEmail(created.user.id, created.user.email, created.user.name, created.business.name);

    return { session, tokens: issued.tokens };
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        business: true,
        locations: { include: { location: true } },
      },
    });

    if (!user || user.deletedAt || user.business.deletedAt) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw ApiException.unauthenticated('Invalid email or password.');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ApiException(
        'ACCOUNT_LOCKED',
        'Too many failed sign-in attempts. Your account is temporarily locked. Try again later or reset your password.',
        HttpStatus.LOCKED,
        { retryAfter: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000) },
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const lockedUntil =
        attempts >= MAX_FAILED_LOGINS ? new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000) : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, lockedUntil },
      });
      await this.audit.record({
        businessId: user.businessId,
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
        entityType: 'User',
        entityId: user.id,
        actor: { id: user.id, name: user.name, role: user.role, ...meta },
        reason: lockedUntil ? 'Invalid password; account locked' : 'Invalid password',
        metadata: { attempts, lockedUntil: lockedUntil?.toISOString() ?? null },
      });
      if (lockedUntil) {
        throw new ApiException(
          'ACCOUNT_LOCKED',
          'Too many failed sign-in attempts. Your account is locked for 15 minutes.',
          HttpStatus.LOCKED,
          { retryAfter: ACCOUNT_LOCK_MINUTES * 60 },
        );
      }
      throw ApiException.unauthenticated('Invalid email or password.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw ApiException.forbidden('This account has been suspended.', 'ACCOUNT_SUSPENDED');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const issued = await this.issueSession(user.id, meta, dto.remember === true);
    await this.audit.record({
      businessId: user.businessId,
      action: AUDIT_ACTIONS.AUTH_LOGIN,
      entityType: 'User',
      entityId: user.id,
      actor: { id: user.id, name: user.name, role: user.role, ...meta },
      metadata: { remember: dto.remember === true, sessionId: issued.sessionId },
    });

    const locations = await this.visibleLocations(user);
    const session: AuthSession = {
      user: toSessionUser(user, locations.map((location) => location.id)),
      business: toBusinessDto(user.business),
      locations: locations.map(toLocationDto),
      csrfToken: issued.tokens.csrfToken,
    };
    return { session, tokens: issued.tokens };
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    if (!refreshToken) throw ApiException.unauthenticated('Session expired. Please sign in again.');
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            business: true,
            locations: { include: { location: true } },
          },
        },
      },
    });
    if (!session) throw ApiException.unauthenticated('Session expired. Please sign in again.');

    if (session.revokedAt) {
      // Refresh-token reuse: an attacker may hold a stolen token. Revoke family.
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        businessId: session.user.businessId,
        action: AUDIT_ACTIONS.AUTH_SESSION_REVOKED,
        entityType: 'Session',
        entityId: session.id,
        actor: {
          id: session.user.id,
          name: session.user.name,
          role: session.user.role,
          ...meta,
        },
        reason: 'Refresh token reuse detected; all sessions revoked',
      });
      throw ApiException.unauthenticated('Your session has ended. Please sign in again.');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw ApiException.unauthenticated('Session expired. Please sign in again.');
    }
    if (
      session.user.status !== UserStatus.ACTIVE ||
      session.user.deletedAt ||
      session.user.business.deletedAt
    ) {
      throw ApiException.unauthenticated('Your account is not available. Please sign in again.');
    }

    const remember = session.rememberMe;
    const material = this.generateTokenMaterial(remember);
    const revoked = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw ApiException.unauthenticated('Your session has ended. Please sign in again.');
    }
    const newSession = await this.prisma.session.create({
      data: {
        userId: session.userId,
        tokenHash: this.hashToken(material.refreshToken),
        expiresAt: material.refreshExpiresAt,
        rememberMe: remember,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
    const accessToken = await this.signAccessToken(
      session.user.id,
      newSession.id,
      session.user.businessId,
      session.user.role,
    );
    const tokens: IssuedTokens = {
      accessToken,
      refreshToken: material.refreshToken,
      csrfToken: material.csrfToken,
      refreshExpiresAt: material.refreshExpiresAt,
    };
    const locations = await this.visibleLocations(session.user);
    const result: AuthSession = {
      user: toSessionUser(
        session.user,
        locations.map((location) => location.id),
      ),
      business: toBusinessDto(session.user.business),
      locations: locations.map(toLocationDto),
      csrfToken: tokens.csrfToken,
    };
    return { session: result, tokens };
  }

  async logout(auth: AuthUser, refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.prisma.session.updateMany({
      where: { id: auth.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: AUDIT_ACTIONS.AUTH_LOGOUT,
      entityType: 'Session',
      entityId: auth.sessionId,
      actor: { id: auth.id, name: auth.name, role: auth.role, ...meta },
    });
  }

  async me(auth: AuthUser): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.id },
      include: {
        business: true,
        locations: { include: { location: true } },
      },
    });
    if (!user) throw ApiException.unauthenticated();
    const locations = await this.visibleLocations(user);
    return {
      user: toSessionUser(user, locations.map((location) => location.id)),
      business: toBusinessDto(user.business),
      locations: locations.map(toLocationDto),
      csrfToken: '',
    };
  }

  /**
   * Owners and managers operate every active branch; other staff only see the
   * branches they are assigned to. This mirrors AccessService's scoping so the
   * branch picker and the API never disagree.
   */
  private async visibleLocations(user: UserForSession) {
    if (user.role === 'OWNER' || user.role === 'MANAGER') {
      return this.prisma.location.findMany({
        where: { businessId: user.businessId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
    }
    return user.locations
      .filter((entry) => entry.location.isActive)
      .map((entry) => entry.location)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }

  async requestPasswordReset(dto: ForgotPasswordDto, meta: RequestMeta): Promise<{ message: string }> {
    const generic = {
      message: 'If an account exists for that email, a password reset link has been created.',
    };
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.deletedAt) return generic;

    const rawToken = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
        },
      }),
    ]);
    await this.audit.record({
      businessId: user.businessId,
      action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
      entityType: 'User',
      entityId: user.id,
      actor: { id: user.id, name: user.name, role: user.role, ...meta },
      reason: 'Password reset requested',
    });
    const resetUrl = this.email.buildAppUrl(`/reset-password?token=${encodeURIComponent(rawToken)}`);
    await this.email.send({
      to: user.email,
      subject: 'Reset your KampalaSmart password',
      text: `Hello ${user.name},\n\nUse this link within ${RESET_TOKEN_TTL_MINUTES} minutes to reset your password:\n${resetUrl}\n\nIf you did not request this, you can ignore this message.`,
    });
    return generic;
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<{ message: string }> {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(dto.token) },
      include: { user: true },
    });
    if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now() || token.user.deletedAt) {
      throw ApiException.badRequest(
        'This password reset link is invalid or has expired.',
        'INVALID_RESET_TOKEN',
      );
    }
    const passwordHash = await this.hashPassword(dto.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      businessId: token.user.businessId,
      action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
      entityType: 'User',
      entityId: token.userId,
      actor: {
        id: token.user.id,
        name: token.user.name,
        role: token.user.role,
        ...meta,
      },
      reason: 'Password reset completed',
    });
    return { message: 'Your password has been updated. You can now sign in.' };
  }

  async changePassword(auth: AuthUser, dto: ChangePasswordDto, meta: RequestMeta): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw ApiException.unauthenticated();
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw ApiException.badRequest('Your current password is incorrect.', 'INVALID_PASSWORD');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw ApiException.badRequest('Choose a password different from your current one.', 'SAME_PASSWORD');
    }
    const passwordHash = await this.hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: auth.id }, data: { passwordHash } }),
      this.prisma.session.updateMany({
        where: { userId: auth.id, revokedAt: null, id: { not: auth.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      businessId: auth.businessId,
      action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
      entityType: 'User',
      entityId: auth.id,
      actor: { id: auth.id, name: auth.name, role: auth.role, ...meta },
      reason: 'Password changed',
    });
    return { message: 'Password updated. Other devices have been signed out.' };
  }

  async requestEmailVerification(auth: AuthUser): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw ApiException.unauthenticated();
    if (user.emailVerifiedAt) return { message: 'Your email is already verified.' };
    await this.sendVerificationEmail(user.id, user.email, user.name);
    return {
      message:
        'Verification link created. In this deployment email delivery uses a development outbox; check the API logs or configure an email provider.',
    };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now() || record.user.deletedAt) {
      throw ApiException.badRequest('This verification link is invalid or has expired.', 'INVALID_TOKEN');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      businessId: record.user.businessId,
      action: AUDIT_ACTIONS.AUTH_EMAIL_VERIFIED,
      entityType: 'User',
      entityId: record.userId,
      actor: { id: record.user.id, name: record.user.name, role: record.user.role },
    });
    return { message: 'Your email has been verified.' };
  }

  async listSessions(auth: AuthUser): Promise<
    Array<{
      id: string;
      current: boolean;
      ip: string | null;
      userAgent: string | null;
      createdAt: string;
      lastUsedAt: string;
      expiresAt: string;
    }>
  > {
    const sessions = await this.prisma.session.findMany({
      where: { userId: auth.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === auth.sessionId,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    }));
  }

  async revokeSession(auth: AuthUser, sessionId: string, meta: RequestMeta): Promise<{ message: string }> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: auth.id },
    });
    if (!session) throw ApiException.notFound('Session not found.', 'SESSION_NOT_FOUND');
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: AUDIT_ACTIONS.AUTH_SESSION_REVOKED,
      entityType: 'Session',
      entityId: session.id,
      actor: { id: auth.id, name: auth.name, role: auth.role, ...meta },
    });
    return { message: 'Session revoked.' };
  }

  private async issueSession(
    userId: string,
    meta: RequestMeta,
    remember: boolean,
  ): Promise<{ sessionId: string; tokens: IssuedTokens }> {
    const material = this.generateTokenMaterial(remember);
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: this.hashToken(material.refreshToken),
        expiresAt: material.refreshExpiresAt,
        rememberMe: remember,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const accessToken = await this.signAccessToken(user.id, session.id, user.businessId, user.role);
    return {
      sessionId: session.id,
      tokens: {
        accessToken,
        refreshToken: material.refreshToken,
        csrfToken: material.csrfToken,
        refreshExpiresAt: material.refreshExpiresAt,
      },
    };
  }

  private generateTokenMaterial(remember: boolean): {
    refreshToken: string;
    csrfToken: string;
    refreshExpiresAt: Date;
  } {
    const days = remember
      ? this.config.get<number>('REMEMBER_ME_TTL_DAYS') ?? 30
      : this.config.get<number>('REFRESH_TOKEN_TTL_DAYS') ?? 7;
    return {
      refreshToken: randomBytes(48).toString('base64url'),
      csrfToken: randomBytes(24).toString('base64url'),
      refreshExpiresAt: new Date(Date.now() + days * 86_400_000),
    };
  }

  private signAccessToken(userId: string, sessionId: string, businessId: string, role: UserRole) {
    return this.jwt.signAsync({
      sub: userId,
      sid: sessionId,
      businessId,
      role,
      type: 'access',
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashPassword(password: string): Promise<string> {
    const rounds = this.config.get<string>('NODE_ENV') === 'test' ? 10 : 12;
    return bcrypt.hash(password, rounds);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'business';
    let slug = base;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const exists = await this.prisma.business.findUnique({ where: { slug } });
      if (!exists) return slug;
      slug = `${base}-${randomBytes(2).toString('hex')}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private async sendVerificationEmail(
    userId: string,
    email: string,
    name: string,
    businessName?: string,
  ): Promise<void> {
    try {
      const rawToken = randomBytes(32).toString('base64url');
      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: new Date() },
        }),
        this.prisma.emailVerificationToken.create({
          data: {
            userId,
            tokenHash: this.hashToken(rawToken),
            expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 3_600_000),
          },
        }),
      ]);
      const url = this.email.buildAppUrl(`/verify-email?token=${encodeURIComponent(rawToken)}`);
      await this.email.send({
        to: email,
        subject: `Verify your ${businessName ?? 'KampalaSmart'} email`,
        text: `Hello ${name},\n\nVerify your email by opening this link:\n${url}\n\nThis link expires in ${EMAIL_TOKEN_TTL_HOURS} hours.`,
      });
    } catch {
      // Verification is not a login gate; failure must not break registration.
    }
  }
}
