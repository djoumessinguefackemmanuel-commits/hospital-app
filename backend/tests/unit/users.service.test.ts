import { NoopUnitOfWork } from '../../src/core/database/prisma';
import { UsersService } from '../../src/modules/auth/services/users.service';
import type { AccessService } from '../../src/modules/auth/services/access.service';
import type { AuthRepository } from '../../src/modules/auth/repositories/auth.repository';
import type { ActorRef } from '../../src/modules/auth/models/auth.model';

const roles = {
  DIRECTEUR: { id: 'r1', code: 'DIRECTEUR', label: 'D', active: true, permissions: ['PARAM_PARAMETRE_APPROVE'] },
  AUDITEUR: { id: 'r2', code: 'AUDITEUR', label: 'A', active: true, permissions: ['AUTH_ROLE_READ'] },
};

function setup() {
  const repo = {
    findRoleByCode: jest.fn(async (c: keyof typeof roles) => roles[c] ?? null),
    findUserById: jest.fn(async (id: string) => ({ id, etablissementId: 'e1' })),
    assignRole: jest.fn(async () => true),
    revokeRole: jest.fn(async () => true),
    listRoles: jest.fn(async () => Object.values(roles)),
  };
  const events = { publish: jest.fn(async () => ({}) as never) };
  const access = { invalidate: jest.fn(async () => undefined) };
  const svc = new UsersService(repo as unknown as AuthRepository, new NoopUnitOfWork(), events, { get: jest.fn() }, access as unknown as AccessService);
  return { svc, repo, events, access };
}
const actor = (over: Partial<ActorRef> = {}): ActorRef => ({ userId: 'a1', etablissementId: 'e1', permissions: ['AUTH_ROLE_UPDATE'], roles: ['GESTIONNAIRE'], ...over });

describe('UsersService : droits', () => {
  it('refuse d\'accorder un rôle plus étendu que le sien', async () => {
    const { svc, repo } = setup();
    await expect(svc.assignRole('u2', 'DIRECTEUR', actor())).rejects.toMatchObject({ code: 'privilege_escalation' });
    expect(repo.assignRole).not.toHaveBeenCalled();
  });
  it('accorde un rôle couvert par ses permissions, publie l\'événement et invalide le cache', async () => {
    const { svc, events, access } = setup();
    await svc.assignRole('u2', 'AUDITEUR', actor({ permissions: ['AUTH_ROLE_READ'] }));
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'role.granted' }), undefined);
    expect(access.invalidate).toHaveBeenCalledWith('u2');
  });
  it('l\'administrateur provisionne, mais jamais pour lui-même', async () => {
    const { svc } = setup();
    const admin = actor({ roles: ['ADMIN_SYSTEME'] });
    await expect(svc.assignRole('u2', 'DIRECTEUR', admin)).resolves.toBeUndefined();
    await expect(svc.assignRole('a1', 'DIRECTEUR', admin)).rejects.toMatchObject({ code: 'self_grant_forbidden' });
  });
  it('refuse de retirer son propre rôle', async () => {
    const { svc } = setup();
    await expect(svc.revokeRole('a1', 'AUDITEUR', actor({ roles: ['AUDITEUR'], permissions: ['AUTH_ROLE_READ'] }))).rejects.toMatchObject({ code: 'self_revoke_forbidden' });
  });
  it('isole les établissements', async () => {
    const { svc, repo } = setup();
    repo.findUserById.mockResolvedValueOnce({ id: 'u9', etablissementId: 'autre' });
    await expect(svc.assignRole('u9', 'AUDITEUR', actor({ permissions: ['AUTH_ROLE_READ'] }))).rejects.toMatchObject({ code: 'user_not_found' });
  });
  it('exporte la matrice en CSV en neutralisant les formules', async () => {
    const { svc, repo } = setup();
    repo.listRoles.mockResolvedValueOnce([{ id: 'x', code: '=CMD', label: 'x', active: true, permissions: ['P1'] }] as never);
    const csv = (await svc.rolesMatrix('csv')) as string;
    expect(csv.split('\n')[1]).toBe("'=CMD,X");
  });
});
