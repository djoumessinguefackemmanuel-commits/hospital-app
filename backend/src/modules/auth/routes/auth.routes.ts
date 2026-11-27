import { Router } from 'express';
import type { Request } from 'express';
import type { Middlewares } from '../../../core/middlewares';
import { wrap } from '../../../core/http/async-handler';
import type { AuthController } from '../controllers/auth.controller';
import {
  assignRoleDto,
  createUserDto,
  listUsersQueryDto,
  loginDto,
  matrixQueryDto,
  mfaSetupConfirmDto,
  mfaSetupStartDto,
  mfaVerifyDto,
  refreshDto,
  userIdParamsDto,
  userRoleParamsDto,
} from '../dtos/auth.dto';

export const AUTH_PERMISSIONS = {
  USER_READ: 'AUTH_USER_READ',
  USER_CREATE: 'AUTH_USER_CREATE',
  ROLE_READ: 'AUTH_ROLE_READ',
  ROLE_UPDATE: 'AUTH_ROLE_UPDATE',
  ROLE_EXPORT: 'AUTH_ROLE_EXPORT',
} as const;

/** Chaîne imposée : authenticate → authorize → auditLog → validate → rateLimit → controller. */
export function createAuthRoutes(c: AuthController, m: Middlewares): Router {
  const r = Router();

  // Routes publiques : limitation par IP (+ e-mail pour le login), audit systématique.
  const loginKey = (req: Request) => `${req.ctx.ip}:${String((req.body as { email?: unknown })?.email ?? '').toLowerCase()}`;
  const publicLimit = (name: string, max: number, key?: (req: Request) => string) => m.rateLimit({ name, windowSec: 60, max, key });

  r.post('/login', m.auditLog('AUTH_LOGIN'), m.validate({ body: loginDto }), publicLimit('login', 10, loginKey), wrap(c.login));
  r.post('/mfa/verify', m.auditLog('AUTH_MFA_VERIFY'), m.validate({ body: mfaVerifyDto }), publicLimit('mfa-verify', 10), wrap(c.verifyMfa));
  r.post('/mfa/setup', m.auditLog('AUTH_MFA_SETUP_START'), m.validate({ body: mfaSetupStartDto }), publicLimit('mfa-setup', 10), wrap(c.startMfaSetup));
  r.post('/mfa/setup/confirm', m.auditLog('AUTH_MFA_SETUP_CONFIRM'), m.validate({ body: mfaSetupConfirmDto }), publicLimit('mfa-confirm', 10), wrap(c.confirmMfaSetup));
  r.post('/refresh', m.auditLog('AUTH_REFRESH'), m.validate({ body: refreshDto }), publicLimit('refresh', 30), wrap(c.refresh));
  r.post('/logout', m.auditLog('AUTH_LOGOUT'), m.validate({ body: refreshDto }), publicLimit('logout', 30), wrap(c.logout));

  r.get('/me', m.authenticate, m.rateLimit({ name: 'me', windowSec: 60, max: 120 }), wrap(c.me));

  r.get('/users', m.authenticate, m.authorize(AUTH_PERMISSIONS.USER_READ), m.auditLog('AUTH_USER_LIST'), m.validate({ query: listUsersQueryDto }), wrap(c.listUsers));
  r.post(
    '/users',
    m.authenticate,
    m.authorize(AUTH_PERMISSIONS.USER_CREATE),
    m.auditLog('AUTH_USER_CREATE'),
    m.validate({ body: createUserDto }),
    m.rateLimit({ name: 'user-create', windowSec: 60, max: 20 }),
    wrap(c.createUser),
  );
  r.post(
    '/users/:id/roles',
    m.authenticate,
    m.authorize(AUTH_PERMISSIONS.ROLE_UPDATE),
    m.auditLog('AUTH_ROLE_GRANT', { resourceId: (req) => req.params['id'] }),
    m.validate({ params: userIdParamsDto, body: assignRoleDto }),
    m.rateLimit({ name: 'role-update', windowSec: 60, max: 30 }),
    wrap(c.assignRole),
  );
  r.delete(
    '/users/:id/roles/:roleCode',
    m.authenticate,
    m.authorize(AUTH_PERMISSIONS.ROLE_UPDATE),
    m.auditLog('AUTH_ROLE_REVOKE', { resourceId: (req) => req.params['id'] }),
    m.validate({ params: userRoleParamsDto }),
    m.rateLimit({ name: 'role-update', windowSec: 60, max: 30 }),
    wrap(c.revokeRole),
  );
  r.get('/roles', m.authenticate, m.authorize(AUTH_PERMISSIONS.ROLE_READ), m.auditLog('AUTH_ROLE_LIST'), wrap(c.listRoles));
  r.get(
    '/roles/matrix',
    m.authenticate,
    m.authorize(AUTH_PERMISSIONS.ROLE_EXPORT),
    m.auditLog('AUTH_ROLE_MATRIX_EXPORT'),
    m.validate({ query: matrixQueryDto }),
    wrap(c.rolesMatrix),
  );

  return r;
}
