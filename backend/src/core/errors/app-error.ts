/**
 * Erreurs métier typées. Le errorHandler les convertit en RFC 9457 (application/problem+json)
 * sans jamais exposer de détail interne.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
  errors?: unknown;
  [extension: string]: unknown;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    detail?: string,
    public readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.name = new.target.name;
  }

  toProblem(instance?: string, correlationId?: string): ProblemDetails {
    return {
      type: `urn:hms:problem:${this.code}`,
      code: this.code,
      title: this.title,
      status: this.status,
      detail: this.message === this.title ? undefined : this.message,
      instance,
      correlationId,
      ...this.extensions,
    };
  }
}

export class ValidationError extends AppError {
  constructor(detail = 'Données invalides', errors?: unknown) {
    super(400, 'validation_error', 'Requête invalide', detail, errors ? { errors } : {});
  }
}

export class UnauthenticatedError extends AppError {
  constructor(detail = 'Authentification requise', code = 'unauthenticated') {
    super(401, code, 'Non authentifié', detail);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'Accès refusé', code = 'forbidden') {
    super(403, code, 'Accès refusé', detail);
  }
}

export class NotFoundError extends AppError {
  constructor(detail = 'Ressource introuvable', code = 'not_found') {
    super(404, code, 'Introuvable', detail);
  }
}

export class ConflictError extends AppError {
  constructor(detail = 'Conflit', code = 'conflict') {
    super(409, code, 'Conflit', detail);
  }
}

export class BusinessRuleError extends AppError {
  constructor(detail: string, code = 'business_rule_violation') {
    super(422, code, 'Règle métier non respectée', detail);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(public readonly retryAfterSec: number) {
    super(429, 'too_many_requests', 'Trop de requêtes', 'Veuillez réessayer plus tard', { retryAfterSec });
  }
}
