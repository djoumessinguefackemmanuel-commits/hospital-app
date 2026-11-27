import type { PrismaClient } from '@prisma/client';
import { dbOf } from '../../../core/database/prisma';
import type { Tx } from '../../../shared/contracts';
import type {
  NewRefreshToken,
  NewUser,
  RefreshTokenRecord,
  RoleWithPermissions,
  UserRecord,
  UserSummary,
} from '../models/auth.model';

/** Contrat d'accès aux données du module auth (la seule couche qui parle à Prisma). */
export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(input: NewUser, tx?: Tx): Promise<UserRecord>;
  listUsers(etablissementId: string, limit: number, offset: number): Promise<UserSummary[]>;
  incrementFailedAttempts(userId: string): Promise<number>;
  lockUser(userId: string, until: Date): Promise<void>;
  recordLogin(userId: string, at: Date): Promise<void>;
  setMfaSecret(userId: string, secretEnc: string): Promise<void>;
  enableMfa(userId: string): Promise<void>;
  getRoleCodes(userId: string): Promise<string[]>;
  getPermissionCodes(userId: string): Promise<string[]>;
  listRoles(): Promise<RoleWithPermissions[]>;
  findRoleByCode(code: string): Promise<RoleWithPermissions | null>;
  assignRole(userId: string, roleId: string, grantedBy: string, tx?: Tx): Promise<boolean>;
  revokeRole(userId: string, roleId: string, tx?: Tx): Promise<boolean>;
  createRefreshToken(input: NewRefreshToken): Promise<void>;
  findRefreshTokenByHash(hash: string): Promise<RefreshTokenRecord | null>;
  rotateRefreshToken(oldId: string, next: NewRefreshToken, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private toUser(u: {
    id: string; etablissementId: string; email: string; displayName: string; passwordHash: string; status: string;
    failedAttempts: number; lockedUntil: Date | null; serviceId: string | null; mfaEnabled: boolean; mfaSecretEnc: string | null;
  }): UserRecord {
    return { ...u, status: u.status as UserRecord['status'] };
  }

  async findUserByEmail(email: string) {
    const u = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    return u ? this.toUser(u) : null;
  }

  async findUserById(id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    return u ? this.toUser(u) : null;
  }

  async createUser(input: NewUser, tx?: Tx) {
    const u = await dbOf(this.prisma, tx).user.create({
      data: {
        etablissementId: input.etablissementId,
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        serviceId: input.serviceId,
        createdBy: input.createdBy,
      },
    });
    return this.toUser(u);
  }

  async listUsers(etablissementId: string, limit: number, offset: number): Promise<UserSummary[]> {
    const rows = await this.prisma.user.findMany({
      where: { etablissementId, deletedAt: null },
      orderBy: { email: 'asc' },
      take: limit,
      skip: offset,
      include: { roles: { include: { role: true } } },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status as UserSummary['status'],
      serviceId: u.serviceId,
      mfaEnabled: u.mfaEnabled,
      roles: u.roles.map((r) => r.role.code),
    }));
  }

  async incrementFailedAttempts(userId: string) {
    const u = await this.prisma.user.update({ where: { id: userId }, data: { failedAttempts: { increment: 1 } }, select: { failedAttempts: true } });
    return u.failedAttempts;
  }

  async lockUser(userId: string, until: Date) {
    await this.prisma.user.update({ where: { id: userId }, data: { lockedUntil: until, failedAttempts: 0 } });
  }

  async recordLogin(userId: string, at: Date) {
    await this.prisma.user.update({ where: { id: userId }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: at } });
  }

  async setMfaSecret(userId: string, secretEnc: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: secretEnc, mfaEnabled: false } });
  }

  async enableMfa(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  }

  async getRoleCodes(userId: string) {
    const rows = await this.prisma.userRole.findMany({ where: { userId, role: { active: true } }, include: { role: true } });
    return rows.map((r) => r.role.code);
  }

  async getPermissionCodes(userId: string) {
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { active: true, users: { some: { userId } } } },
      include: { permission: true },
    });
    return [...new Set(rows.map((r) => r.permission.code))];
  }

  private toRole(r: { id: string; code: string; label: string; active: boolean; permissions: { permission: { code: string } }[] }): RoleWithPermissions {
    return { id: r.id, code: r.code, label: r.label, active: r.active, permissions: r.permissions.map((p) => p.permission.code).sort() };
  }

  async listRoles() {
    const rows = await this.prisma.role.findMany({ orderBy: { code: 'asc' }, include: { permissions: { include: { permission: true } } } });
    return rows.map((r) => this.toRole(r));
  }

  async findRoleByCode(code: string) {
    const r = await this.prisma.role.findUnique({ where: { code }, include: { permissions: { include: { permission: true } } } });
    return r ? this.toRole(r) : null;
  }

  async assignRole(userId: string, roleId: string, grantedBy: string, tx?: Tx) {
    const db = dbOf(this.prisma, tx);
    const existing = await db.userRole.findUnique({ where: { userId_roleId: { userId, roleId } } });
    if (existing) return false;
    await db.userRole.create({ data: { userId, roleId, grantedBy } });
    return true;
  }

  async revokeRole(userId: string, roleId: string, tx?: Tx) {
    const res = await dbOf(this.prisma, tx).userRole.deleteMany({ where: { userId, roleId } });
    return res.count > 0;
  }

  async createRefreshToken(input: NewRefreshToken) {
    await this.prisma.refreshToken.create({ data: input });
  }

  async findRefreshTokenByHash(hash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  }

  async rotateRefreshToken(oldId: string, next: NewRefreshToken, at: Date) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({ data: next }),
      this.prisma.refreshToken.update({ where: { id: oldId }, data: { revokedAt: at, replacedById: next.id } }),
    ]);
  }

  async revokeFamily(familyId: string, at: Date) {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at } });
  }

  async revokeAllForUser(userId: string, at: Date) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
  }
}
