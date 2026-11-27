import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../core/errors/app-error';
import { checkPasswordPolicy, hashPassword } from '../../../core/security/password';
import { EventTypes, type EventPublisher, type SettingsReader, type UnitOfWork } from '../../../shared/contracts';
import type { ActorRef, RoleWithPermissions, UserSummary } from '../models/auth.model';
import type { AuthRepository } from '../repositories/auth.repository';
import type { AccessService } from './access.service';

export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  serviceId?: string;
  roleCodes: string[];
}

export class UsersService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly settings: SettingsReader,
    private readonly access: AccessService,
  ) {}

  /**
   * Anti-escalade : on n'accorde un rôle que si l'on détient déjà toutes ses permissions.
   * Exception : l'ADMIN_SYSTEME provisionne les comptes (tout est audité), mais jamais pour lui-même.
   */
  private async assertCanGrant(actor: ActorRef, roleCode: string) {
    const role = await this.repo.findRoleByCode(roleCode);
    if (!role || !role.active) throw new NotFoundError(`Rôle inconnu : ${roleCode}`, 'role_not_found');
    const held = new Set(actor.permissions);
    const missing = role.permissions.filter((p) => !held.has(p));
    if (missing.length > 0 && !actor.roles.includes('ADMIN_SYSTEME')) {
      throw new ForbiddenError('Vous ne pouvez pas accorder un rôle plus étendu que le vôtre', 'privilege_escalation');
    }
    return role;
  }

  async createUser(input: CreateUserInput, actor: ActorRef): Promise<UserSummary> {
    const minLength = await this.settings.get<number>('security.password.min_length', { etablissementId: actor.etablissementId });
    const problems = checkPasswordPolicy(input.password, { minLength }, [input.email.split('@')[0] ?? '', input.displayName]);
    if (problems.length > 0) throw new ValidationError('Mot de passe non conforme', problems.map((message) => ({ path: 'password', message })));
    if (await this.repo.findUserByEmail(input.email)) throw new ConflictError('Cet e-mail est déjà utilisé', 'email_taken');

    const roles: RoleWithPermissions[] = [];
    for (const code of new Set(input.roleCodes)) roles.push(await this.assertCanGrant(actor, code));

    const passwordHash = await hashPassword(input.password);
    const user = await this.uow.run(async (tx) => {
      const created = await this.repo.createUser(
        { etablissementId: actor.etablissementId, email: input.email, displayName: input.displayName, passwordHash, serviceId: input.serviceId, createdBy: actor.userId },
        tx,
      );
      for (const role of roles) await this.repo.assignRole(created.id, role.id, actor.userId, tx);
      await this.events.publish(
        { type: EventTypes.USER_CREATED, data: { userId: created.id, roles: roles.map((r) => r.code) }, actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId },
        tx,
      );
      return created;
    });
    return { id: user.id, email: user.email, displayName: user.displayName, status: user.status, serviceId: user.serviceId, mfaEnabled: false, roles: roles.map((r) => r.code) };
  }

  listUsers(actor: ActorRef, limit: number, offset: number) {
    return this.repo.listUsers(actor.etablissementId, limit, offset);
  }

  private async requireSameEtablissementUser(userId: string, actor: ActorRef) {
    const user = await this.repo.findUserById(userId);
    if (!user || user.etablissementId !== actor.etablissementId) throw new NotFoundError('Utilisateur introuvable', 'user_not_found');
    return user;
  }

  async assignRole(userId: string, roleCode: string, actor: ActorRef): Promise<void> {
    await this.requireSameEtablissementUser(userId, actor);
    if (userId === actor.userId) throw new ForbiddenError('Vous ne pouvez pas vous attribuer un rôle', 'self_grant_forbidden');
    const role = await this.assertCanGrant(actor, roleCode);
    const granted = await this.uow.run(async (tx) => {
      const added = await this.repo.assignRole(userId, role.id, actor.userId, tx);
      if (added) {
        await this.events.publish(
          { type: EventTypes.ROLE_GRANTED, data: { userId, role: role.code }, actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId },
          tx,
        );
      }
      return added;
    });
    if (!granted) throw new ConflictError('Rôle déjà attribué', 'role_already_assigned');
    await this.access.invalidate(userId);
  }

  async revokeRole(userId: string, roleCode: string, actor: ActorRef): Promise<void> {
    await this.requireSameEtablissementUser(userId, actor);
    if (userId === actor.userId && actor.roles.includes(roleCode)) {
      throw new BusinessRuleError('Vous ne pouvez pas retirer votre propre rôle', 'self_revoke_forbidden');
    }
    const role = await this.assertCanGrant(actor, roleCode);
    const revoked = await this.uow.run(async (tx) => {
      const removed = await this.repo.revokeRole(userId, role.id, tx);
      if (removed) {
        await this.events.publish(
          { type: EventTypes.ROLE_REVOKED, data: { userId, role: role.code }, actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId },
          tx,
        );
      }
      return removed;
    });
    if (!revoked) throw new NotFoundError('Ce rôle n\'est pas attribué', 'role_not_assigned');
    await this.access.invalidate(userId);
  }

  listRoles() {
    return this.repo.listRoles();
  }

  /** Matrice rôles × permissions (livrable de revue d'accès), JSON ou CSV. */
  async rolesMatrix(format: 'json' | 'csv') {
    const roles = await this.repo.listRoles();
    const permissions = [...new Set(roles.flatMap((r) => r.permissions))].sort();
    if (format === 'json') return { permissions, roles: roles.map((r) => ({ code: r.code, label: r.label, permissions: r.permissions })) };
    const cell = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v); // neutralise l'injection de formule tableur
    const lines = [['role', ...permissions].map(cell).join(',')];
    for (const r of roles) {
      const set = new Set(r.permissions);
      lines.push([cell(r.code), ...permissions.map((p) => (set.has(p) ? 'X' : ''))].join(','));
    }
    return lines.join('\n');
  }
}
