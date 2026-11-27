import { AppError, ForbiddenError, NotFoundError } from '../../../core/errors/app-error';
import { decryptString, encryptString } from '../../../core/security/crypto';
import { EventTypes, type EventPublisher, type SettingsReader, type UnitOfWork } from '../../../shared/contracts';
import type { PatientActor, PatientPatch, PatientRecord, PatientView } from '../models/patient.model';
import type { PatientRepository } from '../repositories/patient.repository';
import type { CreatePatientDto, SearchQueryDto, UpdatePatientDto } from '../dtos/patient.dto';
import { formatMrn, maskNationalId, nationalIdHash, normalizeName, scoreCandidate, toCandidate } from './patient.logic';

export const RESTRICTED_PERMISSION = 'PATIENT_DOSSIER_READ_RESTRICTED';

export class PatientService {
  constructor(
    private readonly repo: PatientRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly settings: SettingsReader,
    private readonly encryptionKey: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private view(p: PatientRecord): PatientView {
    return {
      id: p.id,
      mrn: p.mrn,
      lastName: p.lastName,
      firstName: p.firstName,
      birthDate: p.birthDate.toISOString().slice(0, 10),
      sex: p.sex,
      phone: p.phone,
      email: p.email,
      address: p.address,
      nationalIdMasked: p.nationalIdEnc ? maskNationalId(decryptString(this.encryptionKey, p.nationalIdEnc)) : null,
      confidentiality: p.confidentiality,
      active: p.active,
    };
  }

  private canSeeRestricted(actor: PatientActor) {
    return actor.permissions.includes(RESTRICTED_PERMISSION);
  }

  /** Charge un dossier en appliquant l'isolement par établissement et la confidentialité. */
  private async load(id: string, actor: PatientActor): Promise<PatientRecord> {
    const p = await this.repo.findById(id);
    if (!p || p.etablissementId !== actor.etablissementId) throw new NotFoundError('Dossier introuvable', 'patient_not_found');
    if (p.confidentiality === 'RESTRICTED' && !this.canSeeRestricted(actor)) {
      throw new ForbiddenError('Dossier à accès restreint', 'patient_restricted');
    }
    return p;
  }

  async create(input: CreatePatientDto, actor: PatientActor): Promise<PatientView> {
    if (input.confidentiality === 'RESTRICTED' && !this.canSeeRestricted(actor)) {
      throw new ForbiddenError('Droit insuffisant pour créer un dossier restreint', 'patient_restricted');
    }
    const scope = { etablissementId: actor.etablissementId };
    const lastNameNorm = normalizeName(input.lastName);
    const firstNameNorm = normalizeName(input.firstName);
    const idHash = input.nationalId ? nationalIdHash(this.encryptionKey, input.nationalId) : undefined;

    if (!input.confirmNotDuplicate) {
      const threshold = await this.settings.get<number>('patient.duplicate.threshold', scope);
      const candidates = (await this.repo.findDuplicateCandidates(actor.etablissementId, input.birthDate, idHash))
        .map((c) => ({ c, score: scoreCandidate({ lastNameNorm, firstNameNorm, nationalIdHash: idHash }, c) }))
        .filter((x) => x.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (candidates.length > 0) {
        // Les homonymes de dossiers restreints ne sont pas divulgués : on ne signale que leur existence.
        const visible = candidates.filter((x) => x.c.confidentiality === 'NORMAL' || this.canSeeRestricted(actor));
        throw new AppError(409, 'possible_duplicate', 'Doublon possible', 'Un dossier similaire existe déjà', {
          candidates: visible.map((x) => toCandidate(x.c, x.score)),
          hiddenCandidates: candidates.length - visible.length,
        });
      }
    }

    const [format, site] = await Promise.all([
      this.settings.get<string>('patient.mrn.format', scope),
      this.repo.etablissementCode(actor.etablissementId),
    ]);
    if (!site) throw new NotFoundError('Établissement introuvable', 'etablissement_not_found');
    const year = this.clock().getUTCFullYear();

    const created = await this.uow.run(async (tx) => {
      const seq = await this.repo.nextSequence(actor.etablissementId, year, tx);
      const patient = await this.repo.create(
        {
          etablissementId: actor.etablissementId,
          mrn: formatMrn(format, site, year, seq),
          lastName: input.lastName,
          firstName: input.firstName,
          lastNameNorm,
          firstNameNorm,
          birthDate: input.birthDate,
          sex: input.sex,
          phone: input.phone,
          email: input.email,
          address: input.address,
          nationalIdEnc: input.nationalId ? encryptString(this.encryptionKey, input.nationalId) : undefined,
          nationalIdHash: idHash,
          confidentiality: input.confidentiality,
          createdBy: actor.userId,
        },
        tx,
      );
      await this.events.publish(
        { type: EventTypes.PATIENT_CREATED, data: { patientId: patient.id, mrn: patient.mrn }, actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId },
        tx,
      );
      return patient;
    });
    return this.view(created);
  }

  async get(id: string, actor: PatientActor): Promise<PatientView> {
    return this.view(await this.load(id, actor));
  }

  async update(id: string, input: UpdatePatientDto, actor: PatientActor): Promise<PatientView> {
    const current = await this.load(id, actor);
    if (input.confidentiality && input.confidentiality !== current.confidentiality && !this.canSeeRestricted(actor)) {
      throw new ForbiddenError('Droit insuffisant pour changer la confidentialité', 'patient_restricted');
    }
    const patch: PatientPatch = { ...input };
    if (input.lastName) patch.lastNameNorm = normalizeName(input.lastName);
    if (input.firstName) patch.firstNameNorm = normalizeName(input.firstName);
    const updated = await this.uow.run(async (tx) => {
      const p = await this.repo.update(id, patch, actor.userId, tx);
      await this.events.publish(
        { type: EventTypes.PATIENT_UPDATED, data: { patientId: id, fields: Object.keys(input) }, actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId },
        tx,
      );
      return p;
    });
    return this.view(updated);
  }

  async search(q: SearchQueryDto, actor: PatientActor): Promise<PatientView[]> {
    const rows = await this.repo.search(
      actor.etablissementId,
      { text: q.q ? normalizeName(q.q) : undefined, birthDate: q.birthDate },
      this.canSeeRestricted(actor),
      q.limit,
      q.offset,
    );
    return rows.map((p) => this.view(p));
  }
}
