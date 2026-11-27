export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';

export interface UserRecord {
  id: string;
  etablissementId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  failedAttempts: number;
  lockedUntil: Date | null;
  serviceId: string | null;
  mfaEnabled: boolean;
  mfaSecretEnc: string | null;
}

export interface NewUser {
  etablissementId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  serviceId?: string;
  createdBy?: string;
}

export interface RoleWithPermissions {
  id: string;
  code: string;
  label: string;
  active: boolean;
  permissions: string[];
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

export interface NewRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  serviceId: string | null;
  mfaEnabled: boolean;
  roles: string[];
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresInSec: number;
}

export type LoginResult =
  | ({ status: 'AUTHENTICATED' } & SessionTokens)
  | { status: 'MFA_REQUIRED'; mfaToken: string }
  | { status: 'MFA_SETUP_REQUIRED'; setupToken: string };

export interface CallContext {
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface ActorRef {
  userId: string;
  etablissementId: string;
  permissions: string[];
  roles: string[];
  correlationId?: string;
}
