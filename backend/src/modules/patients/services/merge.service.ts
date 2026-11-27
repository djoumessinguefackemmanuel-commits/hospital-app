import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../../core/errors/app-error';
import { EventTypes, type EventPublisher, type SettingsReader, type UnitOfWork } from '../../../shared/contracts';
import type { MergeRecord, MergeStatus, PatientActor, PatientRecord } from '../models/patient.model';
import type { PatientRepository } from '../repositories/patient.repository';

export const MERGE_APPROVE_PERMISSION = 'PATIENT_FUSION_APPROVE';

/**
 * Fusion de dossiers : le dossier source n'est jamais supprimé (données médicales immuables),
 * il est désactivé et pointe vers le dossier cible. Les autres modules réagissent à `patient.merged`.
 */
export class MergeService {
  constructor(
    private readonly repo: PatientRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly settings: SettingsReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async loadPatient(id: string, actor: PatientActor): Promise<PatientRecord> {
    const p = await this.repo.findById(id);
    if (!p || p.etablissementId !== actor.etablissementId) throw new NotFoundError('Dossier introuvable', 'patient_not_found');
    if (p.confidentiality === 'RESTRICTED' && !actor.permissions.includes('PATIENT_DOSSIER_READ_RESTRICTED')) {
      throw new ForbiddenError('Dossier à accès restreint', 'patient_restricted');
    }
    return p;
  }

  async request(input: { sourceId: string; targetId: string; reason: string }, actor: PatientActor): Promise<MergeRecord> {
    if (input.sourceId === input.targetId) throw new BusinessRuleError('Source et cible identiques', 'merge_same_patient');
    const [source, target] = await Promise.all([this.loadPatient(input.sourceId, actor), this.loadPatient(input.targetId, actor)]);
    if (source.mergedIntoId || target.mergedIntoId) throw new BusinessRuleError('Un des dossiers est déjà fusionné', 'patient_merged');
    if (await this.repo.findPendingMergeFor(actor.etablissementId, [source.id, target.id])) {
      throw new ConflictError('Une fusion est déjà en attente pour l\'un de ces dossiers', 'merge_pending');
    }
    const needsApproval = await this.settings.get<boolean>('patient.merge.requires_approval', { etablissementId: actor.etablissementId });
    const now = this.clock();

    return this.uow.run(async (tx) => {
      const merge = await this.repo.createMerge(
        { etablissementId: actor.etablissementId, sourceId: source.id, targetId: target.id, reason: input.reason, requestedBy: actor.userId, status: needsApproval ? 'PENDING' : 'COMPLETED', decidedAt: needsApproval ? undefined : now },
        tx,
      );
      if (!needsApproval) await this.execute(merge, actor, tx);
      return merge;
    });
  }

  private async execute(merge: MergeRecord, actor: PatientActor, tx: unknown) {
    await this.repo.markMerged(merge.sourceId, merge.targetId, actor.userId, tx);
    await this.events.publish(
      { type: EventTypes.PATIENT_MERGED, data: { mergeId: merge.id, sourceId: merge.sourceId, targetId: merge.targetId }, actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId },
      tx,
    );
  }

  private async loadMerge(id: string, actor: PatientActor): Promise<MergeRecord> {
    const m = await this.repo.findMerge(id);
    if (!m || m.etablissementId !== actor.etablissementId) throw new NotFoundError('Demande de fusion introuvable', 'merge_not_found');
    return m;
  }

  async approve(id: string, actor: PatientActor): Promise<MergeRecord> {
    const merge = await this.loadMerge(id, actor);
    if (merge.status !== 'PENDING') throw new ConflictError('Demande déjà traitée', 'merge_already_decided');
    // Séparation des tâches : celui qui demande n'approuve jamais sa propre fusion.
    if (merge.requestedBy === actor.userId) throw new ForbiddenError('Vous ne pouvez pas approuver votre propre demande', 'sod_violation');
    await Promise.all([this.loadPatient(merge.sourceId, actor), this.loadPatient(merge.targetId, actor)]);

    return this.uow.run(async (tx) => {
      const decided = await this.repo.decideMerge(id, 'COMPLETED', actor.userId, undefined, this.clock(), tx);
      if (!decided) throw new ConflictError('Demande déjà traitée', 'merge_already_decided');
      await this.execute(merge, actor, tx);
      return { ...merge, status: 'COMPLETED' as const, decidedBy: actor.userId };
    });
  }

  async reject(id: string, note: string, actor: PatientActor): Promise<MergeRecord> {
    const merge = await this.loadMerge(id, actor);
    if (merge.status !== 'PENDING') throw new ConflictError('Demande déjà traitée', 'merge_already_decided');
    const decided = await this.repo.decideMerge(id, 'REJECTED', actor.userId, note, this.clock());
    if (!decided) throw new ConflictError('Demande déjà traitée', 'merge_already_decided');
    return { ...merge, status: 'REJECTED', decidedBy: actor.userId, decisionNote: note };
  }

  list(status: MergeStatus | undefined, limit: number, offset: number, actor: PatientActor) {
    return this.repo.listMerges(actor.etablissementId, status, limit, offset);
  }
}
