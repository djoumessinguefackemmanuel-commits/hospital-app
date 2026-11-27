import type { Cache } from '../../../core/cache/cache';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../core/errors/app-error';
import {
  EventTypes,
  type DomainEvent,
  type EventPublisher,
  type SettingScope,
  type SettingsReader,
  type UnitOfWork,
} from '../../../shared/contracts';
import {
  GLOBAL_SCOPE_ID,
  type Actor,
  type ChangelogEntry,
  type ParametreDefinition,
  type ParametreValue,
  type ScopeRef,
  type ScopeType,
} from '../models/parametre.model';
import type { ParametrageRepository } from '../repositories/parametrage.repository';
import { assertValidValue } from '../validators/value.validator';

/** Durée de vie du cache : borne aussi le retard d'application d'une date d'effet planifiée. */
const CACHE_TTL_SEC = 60;
const DEFINITION_TTL_SEC = 300;

export interface EffectiveSetting {
  code: string;
  value: unknown;
  source: { scopeType: ScopeType; scopeId: string; version: number } | 'default';
}

export interface SetValueInput extends ScopeRef {
  value: unknown;
  reason: string;
  effectiveFrom?: Date;
}

export class ParametrageService implements SettingsReader {
  constructor(
    private readonly repo: ParametrageRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly cache: Cache,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ── Lecture ────────────────────────────────────────────────────────────────

  private async definition(code: string): Promise<ParametreDefinition> {
    const key = `settingdef:${code}`;
    const cached = await this.cache.get<ParametreDefinition>(key);
    if (cached) return cached;
    const def = await this.repo.findDefinition(code);
    if (!def) throw new NotFoundError(`Paramètre inconnu : ${code}`, 'parameter_not_found');
    await this.cache.set(key, def, DEFINITION_TTL_SEC);
    return def;
  }

  /** Portées candidates, de la plus spécifique à la plus générale. */
  private candidates(def: ParametreDefinition, scope: SettingScope): ScopeRef[] {
    const all: ScopeRef[] = [];
    if (scope.roleCode) all.push({ scopeType: 'ROLE', scopeId: scope.roleCode });
    if (scope.serviceId) all.push({ scopeType: 'SERVICE', scopeId: scope.serviceId });
    if (scope.etablissementId) all.push({ scopeType: 'ETABLISSEMENT', scopeId: scope.etablissementId });
    all.push({ scopeType: 'GLOBAL', scopeId: GLOBAL_SCOPE_ID });
    return all.filter((c) => def.allowedScopes.includes(c.scopeType));
  }

  async resolve(code: string, scope: SettingScope = {}): Promise<EffectiveSetting> {
    const key = `setting:${code}:${scope.roleCode ?? ''}:${scope.serviceId ?? ''}:${scope.etablissementId ?? ''}`;
    const cached = await this.cache.get<EffectiveSetting>(key);
    if (cached) return cached;

    const def = await this.definition(code);
    const now = this.clock();
    let result: EffectiveSetting = { code, value: def.defaultValue, source: 'default' };
    for (const c of this.candidates(def, scope)) {
      const found = await this.repo.findEffectiveValue(def.id, c.scopeType, c.scopeId, now);
      if (found) {
        result = { code, value: found.value, source: { scopeType: c.scopeType, scopeId: c.scopeId, version: found.version } };
        break;
      }
    }
    await this.cache.set(key, result, CACHE_TTL_SEC);
    return result;
  }

  async get<T>(code: string, scope: SettingScope = {}): Promise<T> {
    return (await this.resolve(code, scope)).value as T;
  }

  listDefinitions(module?: string) {
    return this.repo.listDefinitions(module);
  }

  async history(code: string, scope?: ScopeRef): Promise<ChangelogEntry[]> {
    const def = await this.definition(code);
    return this.repo.listHistory(def.id, scope?.scopeType, scope?.scopeId);
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  private normalizeScope(def: ParametreDefinition, scope: ScopeRef): ScopeRef {
    if (!def.allowedScopes.includes(scope.scopeType)) {
      throw new BusinessRuleError(`Portée ${scope.scopeType} non autorisée pour ${def.code}`, 'scope_not_allowed');
    }
    const scopeId = scope.scopeType === 'GLOBAL' ? GLOBAL_SCOPE_ID : scope.scopeId;
    if (scope.scopeType !== 'GLOBAL' && (!scopeId || scopeId === GLOBAL_SCOPE_ID)) {
      throw new BusinessRuleError(`scopeId requis pour la portée ${scope.scopeType}`, 'scope_id_required');
    }
    return { scopeType: scope.scopeType, scopeId };
  }

  private assertCanEdit(def: ParametreDefinition, actor: Actor): void {
    if (!actor.permissions.includes(def.editPermission)) {
      throw new ForbiddenError(`Permission manquante : ${def.editPermission}`, 'permission_denied');
    }
  }

  private async invalidate(code: string): Promise<void> {
    await this.cache.delByPrefix(`setting:${code}:`);
  }

  /**
   * Crée une nouvelle version. Un paramètre critique attend l'approbation d'une AUTRE personne ;
   * sinon la version est publiée immédiatement. Toute modification est journalisée et émet
   * `parametre.updated` dans la même transaction (outbox).
   */
  async setValue(code: string, input: SetValueInput, actor: Actor): Promise<ParametreValue> {
    const def = await this.definition(code);
    this.assertCanEdit(def, actor);
    const scope = this.normalizeScope(def, input);
    assertValidValue(def, input.value);

    const now = this.clock();
    const published = !def.critical;

    const created = await this.uow.run(async (tx) => {
      const previous = await this.repo.findEffectiveValue(def.id, scope.scopeType, scope.scopeId, now);
      const version = (await this.repo.latestVersion(def.id, scope.scopeType, scope.scopeId, tx)) + 1;
      const value = await this.repo.createValue(
        {
          definitionId: def.id,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          version,
          value: input.value,
          status: published ? 'PUBLISHED' : 'PENDING_APPROVAL',
          effectiveFrom: input.effectiveFrom ?? now,
          reason: input.reason,
          createdBy: actor.userId,
        },
        tx,
      );
      await this.repo.addChangelog(
        {
          definitionId: def.id,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          action: published ? 'PUBLISH' : 'CREATE_DRAFT',
          oldValue: previous?.value ?? def.defaultValue,
          newValue: input.value,
          reason: input.reason,
          actorId: actor.userId,
          ip: actor.ip ?? null,
        },
        tx,
      );
      if (published) await this.emitUpdated(def, scope, version, actor, tx);
      return value;
    });

    if (published) await this.invalidate(code);
    return created;
  }

  /** Approbation d'une version en attente : l'approbateur doit différer de l'auteur (séparation des tâches). */
  async approve(code: string, ref: ScopeRef & { version: number }, actor: Actor): Promise<ParametreValue> {
    const def = await this.definition(code);
    const scope = this.normalizeScope(def, ref);

    const published = await this.uow.run(async (tx) => {
      const target = await this.repo.findValue(def.id, scope.scopeType, scope.scopeId, ref.version, tx);
      if (!target) throw new NotFoundError(`Version ${ref.version} introuvable`, 'version_not_found');
      if (target.status !== 'PENDING_APPROVAL') {
        throw new BusinessRuleError('Cette version n\'est pas en attente d\'approbation', 'not_pending_approval');
      }
      if (target.createdBy === actor.userId) {
        throw new BusinessRuleError('L\'auteur d\'une modification ne peut pas l\'approuver', 'sod_violation');
      }
      const previous = await this.repo.findEffectiveValue(def.id, scope.scopeType, scope.scopeId, this.clock());
      const value = await this.repo.publishValue(target.id, actor.userId, this.clock(), tx);
      await this.repo.addChangelog(
        {
          definitionId: def.id,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          action: 'APPROVE',
          oldValue: previous?.value ?? def.defaultValue,
          newValue: target.value,
          reason: target.reason,
          actorId: actor.userId,
          ip: actor.ip ?? null,
        },
        tx,
      );
      await this.emitUpdated(def, scope, target.version, actor, tx);
      return value;
    });

    await this.invalidate(code);
    return published;
  }

  /**
   * Retour arrière : recrée une NOUVELLE version avec la valeur d'une ancienne (l'historique n'est jamais réécrit).
   * Un paramètre critique repasse par l'approbation.
   */
  async rollback(code: string, ref: ScopeRef & { toVersion: number; reason: string }, actor: Actor): Promise<ParametreValue> {
    const def = await this.definition(code);
    const scope = this.normalizeScope(def, ref);
    const target = await this.repo.findValue(def.id, scope.scopeType, scope.scopeId, ref.toVersion);
    if (!target || (target.status !== 'PUBLISHED' && target.status !== 'RETIRED')) {
      throw new NotFoundError(`Version ${ref.toVersion} introuvable ou jamais publiée`, 'version_not_found');
    }
    return this.setValue(
      code,
      { ...scope, value: target.value, reason: `Retour à la version ${ref.toVersion} : ${ref.reason}` },
      actor,
    );
  }

  private emitUpdated(def: ParametreDefinition, scope: ScopeRef, version: number, actor: Actor, tx: unknown): Promise<DomainEvent> {
    return this.events.publish(
      {
        type: EventTypes.PARAMETRE_UPDATED,
        data: { code: def.code, scopeType: scope.scopeType, scopeId: scope.scopeId, version },
        actorId: actor.userId,
        etablissementId: actor.etablissementId,
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /** Abonné à `parametre.updated` : invalide le cache local (utile si le cache n'est pas partagé). */
  async onParametreUpdated(event: DomainEvent): Promise<void> {
    const code = (event.data as { code?: string }).code;
    if (code) {
      await this.invalidate(code);
      await this.cache.del(`settingdef:${code}`);
    }
  }
}
