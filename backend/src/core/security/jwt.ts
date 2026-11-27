import jwt from 'jsonwebtoken';
import { UnauthenticatedError } from '../errors/app-error';

export type TokenPurpose = 'access' | 'mfa' | 'mfa-setup';

export interface TokenClaims {
  sub: string;
  purpose: TokenPurpose;
  /** Second facteur vérifié (jetons d'accès uniquement). */
  mfa: boolean;
}

const ISSUER = 'hms';

/**
 * Jetons signés HS256. Le jeton d'accès est court ; les jetons `mfa` et `mfa-setup` sont à objet
 * unique et ne donnent accès à aucune route métier (le middleware authenticate exige purpose=access).
 */
export class JwtService {
  constructor(private readonly accessSecret: string) {}

  sign(claims: TokenClaims, ttlSec: number): string {
    return jwt.sign({ purpose: claims.purpose, mfa: claims.mfa }, this.accessSecret, {
      algorithm: 'HS256',
      subject: claims.sub,
      issuer: ISSUER,
      expiresIn: ttlSec,
    });
  }

  verify(token: string, allowed: TokenPurpose[]): TokenClaims {
    try {
      const decoded = jwt.verify(token, this.accessSecret, { algorithms: ['HS256'], issuer: ISSUER });
      if (typeof decoded === 'string' || !decoded.sub) throw new Error('jeton mal formé');
      const purpose = decoded['purpose'] as TokenPurpose | undefined;
      if (!purpose || !allowed.includes(purpose)) throw new Error('objet du jeton non autorisé');
      return { sub: decoded.sub, purpose, mfa: decoded['mfa'] === true };
    } catch {
      throw new UnauthenticatedError('Jeton invalide ou expiré', 'invalid_token');
    }
  }
}
