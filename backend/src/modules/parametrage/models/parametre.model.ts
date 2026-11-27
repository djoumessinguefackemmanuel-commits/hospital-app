export type ParametreType =
  | 'STRING'
  | 'INT'
  | 'DECIMAL'
  | 'BOOL'
  | 'ENUM'
  | 'LIST'
  | 'MAP'
  | 'JSON'
  | 'DATE'
  | 'DURATION'
  | 'CRON'
  | 'URL'
  | 'SECRET';

export type ScopeType = 'GLOBAL' | 'ETABLISSEMENT' | 'SERVICE' | 'ROLE';
export type ParametreStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'RETIRED';

/** Identifiant de portée pour GLOBAL (pas de NULL en base). */
export const GLOBAL_SCOPE_ID = '*';

export interface Validation {
  min?: number;
  max?: number;
  enum?: string[];
  pattern?: string;
  itemType?: 'string' | 'int';
  minItems?: number;
  maxItems?: number;
}

export interface ParametreDefinition {
  id: string;
  code: string;
  module: string;
  label: Record<string, string>;
  type: ParametreType;
  defaultValue: unknown;
  validation: Validation;
  allowedScopes: ScopeType[];
  editPermission: string;
  critical: boolean;
}

export type NewParametreDefinition = Omit<ParametreDefinition, 'id'>;

export interface ParametreValue {
  id: string;
  definitionId: string;
  scopeType: ScopeType;
  scopeId: string;
  version: number;
  value: unknown;
  status: ParametreStatus;
  effectiveFrom: Date;
  reason: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface ChangelogEntry {
  id: string;
  definitionId: string;
  scopeType: ScopeType;
  scopeId: string;
  action: 'CREATE_DRAFT' | 'PUBLISH' | 'APPROVE' | 'ROLLBACK';
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  actorId: string | null;
  ip: string | null;
  occurredAt: Date;
}

/** Appelant d'une opération de paramétrage (issu de req.user). */
export interface Actor {
  userId: string;
  etablissementId: string;
  permissions: string[];
  correlationId?: string;
  ip?: string;
}

export interface ScopeRef {
  scopeType: ScopeType;
  scopeId: string;
}
