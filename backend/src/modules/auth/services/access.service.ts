import type { Cache } from '../../../core/cache/cache';
import type { AccessProvider, UserAccess } from '../../../shared/contracts';
import type { AuthRepository } from '../repositories/auth.repository';

const TTL_SEC = 30;
const key = (userId: string) => `auth:access:${userId}`;

/** Implémente le contrat AccessProvider : droits calculés côté serveur, jamais lus dans le jeton. */
export class AccessService implements AccessProvider {
  constructor(
    private readonly repo: AuthRepository,
    private readonly cache: Cache,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getAccess(userId: string): Promise<UserAccess | null> {
    const cached = await this.cache.get<UserAccess>(key(userId));
    if (cached) return cached;
    const user = await this.repo.findUserById(userId);
    if (!user) return null;
    const [roles, permissions] = await Promise.all([this.repo.getRoleCodes(userId), this.repo.getPermissionCodes(userId)]);
    const locked = user.lockedUntil !== null && user.lockedUntil > this.clock();
    const access: UserAccess = {
      userId: user.id,
      email: user.email,
      etablissementId: user.etablissementId,
      serviceId: user.serviceId ?? undefined,
      roles,
      permissions,
      active: user.status === 'ACTIVE' && !locked,
    };
    await this.cache.set(key(userId), access, TTL_SEC);
    return access;
  }

  invalidate(userId: string): Promise<void> {
    return this.cache.del(key(userId));
  }
}
