/**
 * Authentification email / mot de passe.
 *
 * - Mots de passe hachés avec Argon2id.
 * - Access token JWT court (15 min par défaut), envoyé dans l'en-tête Authorization.
 * - Refresh token opaque (256 bits), stocké haché (SHA-256), dans un cookie httpOnly
 *   limité au chemin /api/auth, avec rotation à chaque usage et détection de réutilisation.
 * - OAuth futur : il suffira d'ajouter un contrôleur qui appelle `AuthService.issueSession`.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DEFAULT_EQUIPMENT } from '@bouffe/core';
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import type { Model } from 'mongoose';
import { Public, UserId } from '../common/auth.js';
import { config } from '../config.js';
import { M, type RefreshTokenDoc, type UserDoc } from '../db/schemas.js';

export class RegisterDto {
  @IsEmail()
  email: string;

  /** 10 caractères minimum. */
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  /** Consentement explicite au stockage des données de poids et d'activité. */
  @IsOptional()
  @IsBoolean()
  consentHealthData?: boolean;

  /** Code d'invitation, quand l'installation n'accepte les inscriptions que sur invitation. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  inviteCode?: string;
}

/** Comparaison en temps constant : le temps de réponse ne doit rien dire du code attendu. */
function sameSecret(given: string | undefined, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest((given ?? '').trim()), digest(expected));
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(M.User) private readonly users: Model<UserDoc>,
    @InjectModel(M.RefreshToken) private readonly tokens: Model<RefreshTokenDoc>,
    private readonly jwt: JwtService,
  ) {}

  private readonly decoyHash = argon2.hash(randomBytes(16).toString('hex'), { type: argon2.argon2id });

  async register(dto: RegisterDto): Promise<UserDoc> {
    const email = dto.email.toLowerCase().trim();
    if (await this.users.exists({ email })) throw new ConflictException('Un compte existe déjà avec cet email.');
    return this.users.create({
      email,
      passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
      displayName: dto.displayName ?? '',
      preferences: { equipment: DEFAULT_EQUIPMENT, excludedTags: [] },
      consents: { healthData: !!dto.consentHealthData, healthDataAt: dto.consentHealthData ? new Date() : undefined },
    });
  }

  async validate(dto: LoginDto): Promise<UserDoc> {
    const user = await this.users.findOne({ email: dto.email.toLowerCase().trim() });
    // Même message et même coût de calcul, que l'email existe ou non.
    const ok = await argon2.verify(user?.passwordHash ?? (await this.decoyHash), dto.password).catch(() => false);
    if (!user || !ok) throw new UnauthorizedException('Email ou mot de passe incorrect.');
    return user;
  }

  /** Émet un couple access token + refresh token pour un utilisateur. */
  async issueSession(userId: string, userAgent?: string, family: string = randomUUID()) {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.auth.refreshTtlDays * 86_400_000);
    await this.tokens.create({ userId, tokenHash: sha256(refreshToken), family, expiresAt, userAgent: userAgent?.slice(0, 200) });
    const accessToken = await this.jwt.signAsync({ sub: userId });
    return { accessToken, expiresIn: config.auth.accessTtlSeconds, refreshToken, refreshExpiresAt: expiresAt };
  }

  /** Rotation : l'ancien refresh token est révoqué ; s'il est rejoué, toute la famille tombe. */
  async rotate(refreshToken: string | undefined, userAgent?: string) {
    if (!refreshToken) throw new UnauthorizedException('Session absente.');
    const stored = await this.tokens.findOne({ tokenHash: sha256(refreshToken) });
    if (!stored || stored.expiresAt < new Date()) throw new UnauthorizedException('Session expirée.');
    if (stored.revokedAt) {
      await this.tokens.updateMany({ family: stored.family, revokedAt: null }, { revokedAt: new Date() });
      throw new UnauthorizedException('Session invalidée par sécurité. Reconnecte-toi.');
    }
    stored.revokedAt = new Date();
    await stored.save();
    return this.issueSession(String(stored.userId), userAgent, stored.family);
  }

  async revoke(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const stored = await this.tokens.findOne({ tokenHash: sha256(refreshToken) });
    if (stored) await this.tokens.updateMany({ family: stored.family, revokedAt: null }, { revokedAt: new Date() });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.tokens.deleteMany({ userId });
  }
}

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: config.auth.cookieSecure ? 'strict' : 'lax',
    path: '/api/auth',
    expires,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @InjectModel(M.User) private readonly users: Model<UserDoc>,
  ) {}

  private async respond(res: Response, req: Request, user: UserDoc | null, session: Awaited<ReturnType<AuthService['issueSession']>>) {
    res.cookie(config.auth.cookieName, session.refreshToken, cookieOptions(session.refreshExpiresAt));
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, user };
  }

  /** Crée un compte et ouvre une session. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (config.signupMode === 'closed') throw new ForbiddenException('Les inscriptions sont fermées sur cette installation.');
    if (config.signupMode === 'invite' && !sameSecret(dto.inviteCode, config.signupCode)) {
      throw new ForbiddenException(dto.inviteCode ? "Ce code d'invitation n'est pas valable." : "Il faut un code d'invitation pour créer un compte ici.");
    }
    const user = await this.auth.register(dto);
    return this.respond(res, req, user, await this.auth.issueSession(user.id, req.headers['user-agent']));
  }

  /** Ouvre une session. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validate(dto);
    return this.respond(res, req, user, await this.auth.issueSession(user.id, req.headers['user-agent']));
  }

  /** Échange le refresh token (cookie) contre un nouvel access token. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.rotate(req.cookies?.[config.auth.cookieName], req.headers['user-agent']);
    return this.respond(res, req, null, session);
  }

  /** Ferme la session en cours. */
  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revoke(req.cookies?.[config.auth.cookieName]);
    res.clearCookie(config.auth.cookieName, cookieOptions());
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@UserId() userId: string) {
    return this.users.findById(userId);
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
