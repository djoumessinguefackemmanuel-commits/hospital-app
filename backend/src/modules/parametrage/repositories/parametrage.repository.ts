import type { Prisma, PrismaClient } from '@prisma/client';
import { dbOf } from '../../../core/database/prisma';
import type { Tx } from '../../../shared/contracts';
import type {
  ChangelogEntry,
  NewParametreDefinition,
  ParametreDefinition,
  ParametreStatus,
  ParametreValue,
  ScopeType,
  Validation,
} from '../models/parametre.model';

/** Accès aux données uniquement : aucune règle métier ici. */
export interface ParametrageRepository {
  findDefinition(code: string): Promise<ParametreDefinition | null>;
  listDefinitions(module?: string): Promise<ParametreDefinition[]>;
  upsertDefinition(def: NewParametreDefinition): Promise<ParametreDefinition>;

  /** Version la plus récente PUBLIÉE dont la date d'effet est atteinte. */
  findEffectiveValue(definitionId: string, scopeType: ScopeType, scopeId: string, at: Date): Promise<ParametreValue | null>;
  findValue(definitionId: string, scopeType: ScopeType, scopeId: string, version: number, tx?: Tx): Promise<ParametreValue | null>;
  latestVersion(definitionId: string, scopeType: ScopeType, scopeId: string, tx?: Tx): Promise<number>;
  createValue(
    data: {
      definitionId: string;
      scopeType: ScopeType;
      scopeId: string;
      version: number;
      value: unknown;
      status: ParametreStatus;
      effectiveFrom: Date;
      reason?: string;
      createdBy?: string;
    },
    tx?: Tx,
  ): Promise<ParametreValue>;
  publishValue(id: string, approvedBy: string, at: Date, tx?: Tx): Promise<ParametreValue>;

  addChangelog(entry: Omit<ChangelogEntry, 'id' | 'occurredAt'>, tx?: Tx): Promise<void>;
  listHistory(definitionId: string, scopeType?: ScopeType, scopeId?: string): Promise<ChangelogEntry[]>;
}

type DefinitionRow = Prisma.ParametreDefinitionGetPayload<object>;

function toDefinition(r: DefinitionRow): ParametreDefinition {
  return {
    id: r.id,
    code: r.code,
    module: r.module,
    label: r.label as Record<string, string>,
    type: r.type,
    defaultValue: r.defaultValue,
    validation: r.validation as Validation,
    allowedScopes: r.allowedScopes,
    editPermission: r.editPermission,
    critical: r.critical,
  };
}

function toValue(r: Prisma.ParametreValueGetPayload<object>): ParametreValue {
  return { ...r, scopeId: r.scopeId };
}

export class PrismaParametrageRepository implements ParametrageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findDefinition(code: string) {
    const r = await this.prisma.parametreDefinition.findUnique({ where: { code } });
    return r ? toDefinition(r) : null;
  }

  async listDefinitions(module?: string) {
    const rows = await this.prisma.parametreDefinition.findMany({ where: module ? { module } : {}, orderBy: { code: 'asc' } });
    return rows.map(toDefinition);
  }

  async upsertDefinition(def: NewParametreDefinition) {
    const data = {
      module: def.module,
      label: def.label as Prisma.InputJsonValue,
      type: def.type,
      defaultValue: def.defaultValue as Prisma.InputJsonValue,
      validation: def.validation as Prisma.InputJsonValue,
      allowedScopes: def.allowedScopes,
      editPermission: def.editPermission,
      critical: def.critical,
    };
    const r = await this.prisma.parametreDefinition.upsert({
      where: { code: def.code },
      create: { code: def.code, ...data },
      update: data,
    });
    return toDefinition(r);
  }

  async findEffectiveValue(definitionId: string, scopeType: ScopeType, scopeId: string, at: Date) {
    const r = await this.prisma.parametreValue.findFirst({
      where: { definitionId, scopeType, scopeId, status: 'PUBLISHED', effectiveFrom: { lte: at } },
      orderBy: { version: 'desc' },
    });
    return r ? toValue(r) : null;
  }

  async findValue(definitionId: string, scopeType: ScopeType, scopeId: string, version: number, tx?: Tx) {
    const r = await dbOf(this.prisma, tx).parametreValue.findUnique({
      where: { definitionId_scopeType_scopeId_version: { definitionId, scopeType, scopeId, version } },
    });
    return r ? toValue(r) : null;
  }

  async latestVersion(definitionId: string, scopeType: ScopeType, scopeId: string, tx?: Tx) {
    const r = await dbOf(this.prisma, tx).parametreValue.aggregate({
      where: { definitionId, scopeType, scopeId },
      _max: { version: true },
    });
    return r._max.version ?? 0;
  }

  async createValue(data: Parameters<ParametrageRepository['createValue']>[0], tx?: Tx) {
    const r = await dbOf(this.prisma, tx).parametreValue.create({
      data: { ...data, value: data.value as Prisma.InputJsonValue },
    });
    return toValue(r);
  }

  async publishValue(id: string, approvedBy: string, at: Date, tx?: Tx) {
    const r = await dbOf(this.prisma, tx).parametreValue.update({
      where: { id },
      data: { status: 'PUBLISHED', approvedBy, approvedAt: at },
    });
    return toValue(r);
  }

  async addChangelog(entry: Omit<ChangelogEntry, 'id' | 'occurredAt'>, tx?: Tx) {
    await dbOf(this.prisma, tx).parametreChangelog.create({
      data: {
        definitionId: entry.definitionId,
        scopeType: entry.scopeType,
        scopeId: entry.scopeId,
        action: entry.action,
        oldValue: (entry.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
        newValue: (entry.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: entry.reason,
        actorId: entry.actorId,
        ip: entry.ip,
      },
    });
  }

  async listHistory(definitionId: string, scopeType?: ScopeType, scopeId?: string) {
    const rows = await this.prisma.parametreChangelog.findMany({
      where: { definitionId, ...(scopeType ? { scopeType } : {}), ...(scopeId ? { scopeId } : {}) },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...r, action: r.action as ChangelogEntry['action'] }));
  }
}
