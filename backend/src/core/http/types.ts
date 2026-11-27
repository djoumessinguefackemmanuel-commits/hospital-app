import type { UserAccess } from '../../shared/contracts';

export interface RequestContext {
  correlationId: string;
  ip: string;
  userAgent?: string;
}

export interface AuthenticatedUser extends UserAccess {
  /** Le second facteur a été vérifié pour cette session. */
  mfaVerified: boolean;
  /** Jeton à objet limité (ex. enrôlement MFA) : n'ouvre aucune route métier. */
  purpose: 'access';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: RequestContext;
      user?: AuthenticatedUser;
      /** Rempli par le middleware `validate`. */
      validated: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
