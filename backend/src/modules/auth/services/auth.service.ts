import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { AppError, BusinessRuleError, UnauthenticatedError } from '../../../core/errors/app-error';
import { decryptString, encryptString, randomToken, sha256Hex } from '../../../core/security/crypto';
import type { JwtService } from '../../../core/security/jwt';
import { hashPassword, verifyPassword } from '../../../core/security/password';
import { EventTypes, type EventPublisher, type SettingsReader } from '../../../shared/contracts';
import type { CallContext, LoginResult, SessionTokens, UserRecord } from '../models/auth.model';
import type { AuthRepository } from '../repositories/auth.repository';

authenticator.options = { window: 1 };

const MFA_TOKEN_TTL_SEC = 300;
/** Hash factice pour égaliser le temps de réponse quand l'e-mail est inconnu. */
let dummyHash: Promise<string> | undefined;

export interface AuthServiceDeps {
  repo: AuthRepository;
  jwt: JwtService;
  settings: SettingsReader;
  events: EventPublisher;
  encryptionKey: string;
  clock?: () => Date;
}

export class AuthService {
  private readonly repo: AuthRepository;
  private readonly clock: () => Date;

  constructor(private readonly deps: AuthServiceDeps) {
    this.repo = deps.repo;
    this.clock = deps.clock ?? (() => new Date());
  }

  private scope(u: Pick<UserRecord, 'etablissementId'>) {
    return { etablissementId: u.etablissementId };
  }

  async login(email: string, password: string, ctx: CallContext): Promise<LoginResult> {
    const now = this.clock();
    const user = await this.repo.findUserByEmail(email);
    if (!user) {
      dummyHash ??= hashPassword('dummy-password-for-timing');
      await verifyPassword(await dummyHash, password);
      throw new UnauthenticatedError('Identifiants invalides', 'invalid_credentials');
    }
    if (user.status === 'DISABLED') throw new UnauthenticatedError('Identifiants invalides', 'invalid_credentials');
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AppError(423, 'account_locked', 'Compte verrouillé', 'Compte temporairement verrouillé', {
        retryAfterSec: Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000),
      });
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await this.registerFailure(user, ctx, now);
      throw new UnauthenticatedError('Identifiants invalides', 'invalid_credentials');
    }

    const requiredRoles = await this.deps.settings.get<string[]>('security.mfa.required_roles', this.scope(user));
    const roles = await this.repo.getRoleCodes(user.id);
    const mfaRequiredByRole = roles.some((r) => requiredRoles.includes(r));

    if (user.mfaEnabled) {
      return { status: 'MFA_REQUIRED', mfaToken: this.deps.jwt.sign({ sub: user.id, purpose: 'mfa', mfa: false }, MFA_TOKEN_TTL_SEC) };
    }
    if (mfaRequiredByRole) {
      return { status: 'MFA_SETUP_REQUIRED', setupToken: this.deps.jwt.sign({ sub: user.id, purpose: 'mfa-setup', mfa: false }, MFA_TOKEN_TTL_SEC) };
    }
    return { status: 'AUTHENTICATED', ...(await this.completeLogin(user, false, ctx)) };
  }

  private async registerFailure(user: UserRecord, ctx: CallContext, now: Date) {
    const max = await this.deps.settings.get<number>('security.login.max_attempts', this.scope(user));
    const attempts = await this.repo.incrementFailedAttempts(user.id);
    if (attempts >= max) {
      const minutes = await this.deps.settings.get<number>('security.login.lockout_min', this.scope(user));
      await this.repo.lockUser(user.id, new Date(now.getTime() + minutes * 60_000));
      await this.deps.events.publish({
        type: EventTypes.USER_LOCKED,
        data: { userId: user.id, minutes },
        actorId: user.id,
        etablissementId: user.etablissementId,
        correlationId: ctx.correlationId,
      });
    }
  }

  async verifyMfa(mfaToken: string, code: string, ctx: CallContext): Promise<SessionTokens> {
    const claims = this.deps.jwt.verify(mfaToken, ['mfa']);
    const user = await this.requireActiveUser(claims.sub);
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw new UnauthenticatedError('Second facteur non configuré', 'mfa_not_enabled');
    if (!this.checkCode(user, code)) {
      await this.registerFailure(user, ctx, this.clock());
      await this.deps.events.publish({ type: EventTypes.MFA_FAILED, data: { userId: user.id }, actorId: user.id, etablissementId: user.etablissementId, correlationId: ctx.correlationId });
      throw new UnauthenticatedError('Code invalide', 'invalid_mfa_code');
    }
    return this.completeLogin(user, true, ctx);
  }

  /** Étape 1 de l'enrôlement : génère le secret (chiffré en base) et l'URL à scanner. */
  async startMfaSetup(setupToken: string): Promise<{ secret: string; otpauthUrl: string }> {
    const claims = this.deps.jwt.verify(setupToken, ['mfa-setup']);
    const user = await this.requireActiveUser(claims.sub);
    if (user.mfaEnabled) throw new BusinessRuleError('Second facteur déjà activé', 'mfa_already_enabled');
    const secret = authenticator.generateSecret();
    await this.repo.setMfaSecret(user.id, encryptString(this.deps.encryptionKey, secret));
    return { secret, otpauthUrl: authenticator.keyuri(user.email, 'HMS Hospital', secret) };
  }

  /** Étape 2 : prouve la possession du facteur, l'active et ouvre la session. */
  async confirmMfaSetup(setupToken: string, code: string, ctx: CallContext): Promise<SessionTokens> {
    const claims = this.deps.jwt.verify(setupToken, ['mfa-setup']);
    const user = await this.requireActiveUser(claims.sub);
    if (user.mfaEnabled) throw new BusinessRuleError('Second facteur déjà activé', 'mfa_already_enabled');
    if (!user.mfaSecretEnc) throw new BusinessRuleError('Démarrez d\'abord l\'enrôlement', 'mfa_setup_not_started');
    if (!this.checkCode(user, code)) throw new UnauthenticatedError('Code invalide', 'invalid_mfa_code');
    await this.repo.enableMfa(user.id);
    return this.completeLogin({ ...user, mfaEnabled: true }, true, ctx);
  }

  async refresh(refreshToken: string, ctx: CallContext): Promise<SessionTokens> {
    const now = this.clock();
    const record = await this.repo.findRefreshTokenByHash(sha256Hex(refreshToken));
    if (!record) throw new UnauthenticatedError('Session invalide', 'invalid_refresh_token');
    if (record.revokedAt) {
      // Réutilisation d'un jeton déjà tourné : vol probable, on coupe toute la famille.
      await this.repo.revokeFamily(record.familyId, now);
      throw new UnauthenticatedError('Session invalide', 'refresh_token_reuse');
    }
    if (record.expiresAt <= now) throw new UnauthenticatedError('Session expirée', 'refresh_token_expired');
    const user = await this.requireActiveUser(record.userId);

    const next = await this.newRefreshToken(user, record.familyId, ctx, now);
    await this.repo.rotateRefreshToken(record.id, next.row, now);
    return this.issue(user, user.mfaEnabled, next.raw);
  }

  async logout(refreshToken: string): Promise<void> {
    const record = await this.repo.findRefreshTokenByHash(sha256Hex(refreshToken));
    if (record) await this.repo.revokeFamily(record.familyId, this.clock());
  }

  private checkCode(user: UserRecord, code: string): boolean {
    if (!user.mfaSecretEnc) return false;
    try {
      return authenticator.check(code, decryptString(this.deps.encryptionKey, user.mfaSecretEnc));
    } catch {
      return false;
    }
  }

  private async requireActiveUser(id: string): Promise<UserRecord> {
    const user = await this.repo.findUserById(id);
    if (!user || user.status !== 'ACTIVE') throw new UnauthenticatedError('Compte inactif ou inconnu', 'invalid_token');
    return user;
  }

  private async completeLogin(user: UserRecord, mfa: boolean, ctx: CallContext): Promise<SessionTokens> {
    const now = this.clock();
    await this.repo.recordLogin(user.id, now);
    const next = await this.newRefreshToken(user, randomUUID(), ctx, now);
    await this.repo.createRefreshToken(next.row);
    await this.deps.events.publish({
      type: EventTypes.USER_LOGGED_IN,
      data: { userId: user.id, mfa },
      actorId: user.id,
      etablissementId: user.etablissementId,
      correlationId: ctx.correlationId,
    });
    return this.issue(user, mfa, next.raw);
  }

  private async newRefreshToken(user: UserRecord, familyId: string, ctx: CallContext, now: Date) {
    const hours = await this.deps.settings.get<number>('security.session.absolute_hours', this.scope(user));
    const raw = randomToken();
    return {
      raw,
      row: {
        id: randomUUID(),
        userId: user.id,
        familyId,
        tokenHash: sha256Hex(raw),
        expiresAt: new Date(now.getTime() + hours * 3_600_000),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    };
  }

  private async issue(user: UserRecord, mfa: boolean, refreshToken: string): Promise<SessionTokens> {
    const minutes = await this.deps.settings.get<number>('security.session.access_ttl_min', this.scope(user));
    const expiresInSec = minutes * 60;
    return {
      accessToken: this.deps.jwt.sign({ sub: user.id, purpose: 'access', mfa }, expiresInSec),
      refreshToken,
      tokenType: 'Bearer',
      expiresInSec,
    };
  }
}
