/**
 * Contrats partagés : interfaces que les modules déclarent et que la racine de composition
 * (src/app.ts) branche. C'est le SEUL moyen, avec les événements, pour qu'un module utilise
 * un autre module (docs/00-conventions.md §5).
 */

/** Contexte transactionnel opaque : chaque repository sait le convertir. */
export type Tx = unknown;

export interface UnitOfWork {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// ── Événements ────────────────────────────────────────────────────────────────

export interface DomainEvent<T = unknown> {
  eventId: string;
  type: string;
  occurredAt: string;
  actorId?: string;
  etablissementId?: string;
  correlationId?: string;
  data: T;
}

export interface EventInput<T = unknown> {
  type: string;
  data: T;
  actorId?: string;
  etablissementId?: string;
  correlationId?: string;
}

export interface EventPublisher {
  /** Écrit l'événement dans l'outbox, dans la transaction `tx` si fournie. */
  publish<T>(input: EventInput<T>, tx?: Tx): Promise<DomainEvent<T>>;
}

export const EventTypes = {
  PARAMETRE_UPDATED: 'parametre.updated',
  USER_LOGGED_IN: 'user.logged_in',
  USER_LOCKED: 'user.locked',
  USER_CREATED: 'user.created',
  MFA_FAILED: 'mfa.failed',
  ROLE_GRANTED: 'role.granted',
  ROLE_REVOKED: 'role.revoked',
  PATIENT_CREATED: 'patient.created',
  PATIENT_UPDATED: 'patient.updated',
  PATIENT_MERGED: 'patient.merged',
  RDV_CREATED: 'rdv.created',
  RDV_CANCELLED: 'rdv.cancelled',
} as const;

// ── Paramétrage ───────────────────────────────────────────────────────────────

export interface SettingScope {
  etablissementId?: string;
  serviceId?: string;
  roleCode?: string;
}

/** Lecture d'un paramètre : implémenté par le module parametrage. */
export interface SettingsReader {
  get<T>(code: string, scope?: SettingScope): Promise<T>;
}

// ── Accès (RBAC + ABAC) ───────────────────────────────────────────────────────

export interface UserAccess {
  userId: string;
  email: string;
  etablissementId: string;
  serviceId?: string;
  roles: string[];
  permissions: string[];
  active: boolean;
}

/** Résolution des droits d'un utilisateur : implémenté par le module auth. */
export interface AccessProvider {
  getAccess(userId: string): Promise<UserAccess | null>;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILURE';

export interface AuditEntry {
  etablissementId?: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  patientId?: string;
  result: AuditResult;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export interface AuditWriter {
  write(entry: AuditEntry): Promise<void>;
}

// ── Patients ──────────────────────────────────────────────────────────────────

/** Existence et visibilité d'un patient pour un appelant : implémenté par le module patients. */
export interface PatientDirectory {
  isAccessible(patientId: string, actor: { etablissementId: string; permissions: string[] }): Promise<boolean>;
}
