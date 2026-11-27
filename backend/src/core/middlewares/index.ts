import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import type { Cache } from '../cache/cache';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthenticatedError,
  ValidationError,
} from '../errors/app-error';
import { wrap } from '../http/async-handler';
import type { Logger } from '../logger/logger';
import type { JwtService } from '../security/jwt';
import type { AccessProvider, AuditWriter, SettingsReader } from '../../shared/contracts';

export interface MiddlewareDeps {
  jwt: JwtService;
  access: AccessProvider;
  settings: SettingsReader;
  audit: AuditWriter;
  cache: Cache;
  logger: Logger;
}

export interface AuditOptions {
  resource?: string;
  resourceId?: (req: Request) => string | undefined;
  patientId?: (req: Request) => string | undefined;
}

export interface RateLimitOptions {
  /** Nom du compteur (une limite par route sensible). */
  name: string;
  windowSec: number;
  max: number;
  key?: (req: Request) => string;
}

/** Identifiant de corrélation + adresse et agent de l'appelant, pour les logs et l'audit. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.ctx = { correlationId, ip: req.ip ?? 'inconnue', userAgent: req.header('user-agent') };
  req.validated = {};
  res.setHeader('x-correlation-id', correlationId);
  next();
};

export const notFoundHandler: RequestHandler = (req) => {
  throw new NotFoundError(`Route inconnue : ${req.method} ${req.path}`, 'route_not_found');
};

/** Convertit toute erreur en RFC 9457 sans jamais exposer de détail interne. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = req.ctx?.correlationId;
    let appError: AppError;

    if (err instanceof AppError) {
      appError = err;
    } else if (err instanceof ZodError) {
      appError = new ValidationError('Données invalides', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    } else if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
      appError = new ValidationError('Corps JSON invalide');
    } else if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') {
      appError = new AppError(413, 'payload_too_large', 'Requête trop volumineuse');
    } else {
      logger.error({ err, correlationId, path: req.path }, 'erreur non gérée');
      appError = new AppError(500, 'internal_error', 'Erreur interne', 'Une erreur est survenue');
    }

    if (appError instanceof TooManyRequestsError) res.setHeader('Retry-After', String(appError.retryAfterSec));
    res.status(appError.status).type('application/problem+json').json(appError.toProblem(req.originalUrl, correlationId));
  };
}

export function createMiddlewares(deps: MiddlewareDeps) {
  const { jwt, access, settings, audit, cache, logger } = deps;

  async function writeAudit(req: Request, action: string, result: 'SUCCESS' | 'DENIED' | 'FAILURE', opts: AuditOptions = {}) {
    try {
      await audit.write({
        etablissementId: req.user?.etablissementId,
        userId: req.user?.userId,
        action,
        resource: opts.resource ?? `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
        resourceId: opts.resourceId?.(req),
        patientId: opts.patientId?.(req),
        result,
        ip: req.ctx.ip,
        userAgent: req.ctx.userAgent,
        correlationId: req.ctx.correlationId,
      });
    } catch (err) {
      // L'échec d'écriture de l'audit est une alerte critique (voir conception §6.3).
      logger.error({ err, action, correlationId: req.ctx.correlationId, alert: 'audit_write_failed' }, 'écriture d\'audit impossible');
    }
  }

  /** 1. JWT d'accès → req.user (droits chargés côté serveur, jamais lus dans le jeton). */
  const authenticate: RequestHandler = wrap(async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthenticatedError();
    const claims = jwt.verify(header.slice(7), ['access']);
    const userAccess = await access.getAccess(claims.sub);
    if (!userAccess?.active) throw new UnauthenticatedError('Compte inactif ou inconnu', 'invalid_token');

    const mfaRoles = await settings.get<string[]>('security.mfa.required_roles', { etablissementId: userAccess.etablissementId });
    if (!claims.mfa && userAccess.roles.some((r) => mfaRoles.includes(r))) {
      throw new ForbiddenError('Second facteur requis pour ce rôle', 'mfa_required');
    }
    req.user = { ...userAccess, mfaVerified: claims.mfa, purpose: 'access' };
    next();
  });

  /** 2. RBAC : toutes les permissions listées sont exigées. Un refus est audité. */
  const authorize = (...permissions: string[]): RequestHandler =>
    wrap(async (req, _res, next) => {
      if (!req.user) throw new UnauthenticatedError();
      const granted = new Set(req.user.permissions);
      const missing = permissions.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        await writeAudit(req, 'AUTHORIZE', 'DENIED', { resource: `${req.method} ${req.originalUrl}` });
        throw new ForbiddenError(`Permission manquante : ${missing.join(', ')}`, 'permission_denied');
      }
      next();
    });

  /** 3. Audit : trace chaque appel (succès, refus ou échec), après la réponse. */
  const auditLog =
    (action: string, opts: AuditOptions = {}): RequestHandler =>
    (req, res, next) => {
      res.on('finish', () => {
        const result = res.statusCode < 400 ? 'SUCCESS' : res.statusCode === 401 || res.statusCode === 403 ? 'DENIED' : 'FAILURE';
        void writeAudit(req, action, result, opts);
      });
      next();
    };

  /** 4. Validation Zod : req.validated.{body,query,params} contient les données typées. */
  const validate =
    (schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler =>
    (req, _res, next) => {
      try {
        if (schemas.body) req.validated.body = schemas.body.parse(req.body);
        if (schemas.query) req.validated.query = schemas.query.parse(req.query);
        if (schemas.params) req.validated.params = schemas.params.parse(req.params);
        next();
      } catch (err) {
        next(err);
      }
    };

  /** 5. Limitation fine par utilisateur et par route (fenêtre fixe, compteur partagé via Redis). */
  const rateLimit = (options: RateLimitOptions): RequestHandler =>
    wrap(async (req, res, next) => {
      const subject = options.key?.(req) ?? req.user?.userId ?? req.ctx.ip;
      const windowIndex = Math.floor(Date.now() / (options.windowSec * 1000));
      const count = await cache.incr(`rl:${options.name}:${subject}:${windowIndex}`, options.windowSec);
      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, options.max - count)));
      if (count > options.max) throw new TooManyRequestsError(options.windowSec);
      next();
    });

  return { authenticate, authorize, auditLog, validate, rateLimit };
}

export type Middlewares = ReturnType<typeof createMiddlewares>;
