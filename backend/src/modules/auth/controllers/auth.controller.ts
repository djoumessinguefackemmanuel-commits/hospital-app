import type { Request, Response } from 'express';
import type { AuthService } from '../services/auth.service';
import type { UsersService } from '../services/users.service';
import type { CreateUserDto, LoginDto, MfaVerifyDto } from '../dtos/auth.dto';
import type { ActorRef, CallContext } from '../models/auth.model';

/** Contrôleur : lit req, appelle les services, écrit res. Aucune règle métier. */
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  private ctx(req: Request): CallContext {
    return { ip: req.ctx.ip, userAgent: req.ctx.userAgent, correlationId: req.ctx.correlationId };
  }

  private actor(req: Request): ActorRef {
    const u = req.user!;
    return { userId: u.userId, etablissementId: u.etablissementId, permissions: u.permissions, roles: u.roles, correlationId: req.ctx.correlationId };
  }

  login = async (req: Request, res: Response) => {
    const { email, password } = req.validated.body as LoginDto;
    res.json({ data: await this.auth.login(email, password, this.ctx(req)) });
  };

  verifyMfa = async (req: Request, res: Response) => {
    const { mfaToken, code } = req.validated.body as MfaVerifyDto;
    res.json({ data: { status: 'AUTHENTICATED', ...(await this.auth.verifyMfa(mfaToken, code, this.ctx(req))) } });
  };

  startMfaSetup = async (req: Request, res: Response) => {
    const { setupToken } = req.validated.body as { setupToken: string };
    res.json({ data: await this.auth.startMfaSetup(setupToken) });
  };

  confirmMfaSetup = async (req: Request, res: Response) => {
    const { setupToken, code } = req.validated.body as { setupToken: string; code: string };
    res.json({ data: { status: 'AUTHENTICATED', ...(await this.auth.confirmMfaSetup(setupToken, code, this.ctx(req))) } });
  };

  refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.validated.body as { refreshToken: string };
    res.json({ data: await this.auth.refresh(refreshToken, this.ctx(req)) });
  };

  logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.validated.body as { refreshToken: string };
    await this.auth.logout(refreshToken);
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    const { userId, email, etablissementId, serviceId, roles, permissions } = req.user!;
    res.json({ data: { userId, email, etablissementId, serviceId, roles, permissions } });
  };

  createUser = async (req: Request, res: Response) => {
    const body = req.validated.body as CreateUserDto;
    res.status(201).json({ data: await this.users.createUser(body, this.actor(req)) });
  };

  listUsers = async (req: Request, res: Response) => {
    const { limit, offset } = req.validated.query as { limit: number; offset: number };
    res.json({ data: await this.users.listUsers(this.actor(req), limit, offset) });
  };

  assignRole = async (req: Request, res: Response) => {
    const { id } = req.validated.params as { id: string };
    const { roleCode } = req.validated.body as { roleCode: string };
    await this.users.assignRole(id, roleCode, this.actor(req));
    res.status(204).end();
  };

  revokeRole = async (req: Request, res: Response) => {
    const { id, roleCode } = req.validated.params as { id: string; roleCode: string };
    await this.users.revokeRole(id, roleCode, this.actor(req));
    res.status(204).end();
  };

  listRoles = async (_req: Request, res: Response) => {
    res.json({ data: await this.users.listRoles() });
  };

  rolesMatrix = async (req: Request, res: Response) => {
    const { format } = req.validated.query as { format: 'json' | 'csv' };
    const matrix = await this.users.rolesMatrix(format);
    if (format === 'csv') {
      res.type('text/csv').setHeader('Content-Disposition', 'attachment; filename="matrice-roles.csv"');
      res.send(matrix);
      return;
    }
    res.json({ data: matrix });
  };
}
