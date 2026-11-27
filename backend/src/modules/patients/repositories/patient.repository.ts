import type { PrismaClient } from '@prisma/client';
import { dbOf } from '../../../core/database/prisma';
import type { Tx } from '../../../shared/contracts';
import type { MergeRecord, MergeStatus, NewPatient, PatientPatch, PatientRecord } from '../models/patient.model';

export interface PatientRepository {
  /** Incrémente atomiquement le compteur annuel et retourne la nouvelle valeur. */
  nextSequence(etablissementId: string, year: number, tx?: Tx): Promise<number>;
  etablissementCode(etablissementId: string): Promise<string | null>;
  create(input: NewPatient, tx?: Tx): Promise<PatientRecord>;
  findById(id: string): Promise<PatientRecord | null>;
  update(id: string, patch: PatientPatch, updatedBy: string, tx?: Tx): Promise<PatientRecord>;
  findDuplicateCandidates(etablissementId: string, birthDate: Date, nationalIdHash?: string): Promise<PatientRecord[]>;
  createMerge(input: { etablissementId: string; sourceId: string; targetId: string; reason: string; requestedBy: string; status: MergeStatus; decidedAt?: Date }, tx?: Tx): Promise<MergeRecord>;
  findMerge(id: string): Promise<MergeRecord | null>;
  findPendingMergeFor(etablissementId: string, patientIds: string[]): Promise<MergeRecord | null>;
  listMerges(etablissementId: string, status: MergeStatus | undefined, limit: number, offset: number): Promise<MergeRecord[]>;
  /** Décision atomique : ne s'applique que si la demande est encore en attente. Retourne false sinon. */
  decideMerge(id: string, status: 'COMPLETED' | 'REJECTED', decidedBy: string, note: string | undefined, at: Date, tx?: Tx): Promise<boolean>;
  markMerged(sourceId: string, targetId: string, by: string, tx?: Tx): Promise<void>;
  search(etablissementId: string, query: { text?: string; birthDate?: Date }, includeRestricted: boolean, limit: number, offset: number): Promise<PatientRecord[]>;
}

export class PrismaPatientRepository implements PatientRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async nextSequence(etablissementId: string, year: number, tx?: Tx) {
    const row = await dbOf(this.prisma, tx).mrnCounter.upsert({
      where: { etablissementId_year: { etablissementId, year } },
      create: { etablissementId, year, last: 1 },
      update: { last: { increment: 1 } },
    });
    return row.last;
  }

  async etablissementCode(etablissementId: string) {
    const e = await this.prisma.etablissement.findUnique({ where: { id: etablissementId }, select: { code: true } });
    return e?.code ?? null;
  }

  async create(input: NewPatient, tx?: Tx) {
    return (await dbOf(this.prisma, tx).patient.create({ data: input })) as PatientRecord;
  }

  async findById(id: string) {
    return (await this.prisma.patient.findUnique({ where: { id } })) as PatientRecord | null;
  }

  async update(id: string, patch: PatientPatch, updatedBy: string, tx?: Tx) {
    return (await dbOf(this.prisma, tx).patient.update({ where: { id }, data: { ...patch, updatedBy } })) as PatientRecord;
  }

  async findDuplicateCandidates(etablissementId: string, birthDate: Date, nationalIdHash?: string) {
    const rows = await this.prisma.patient.findMany({
      where: { etablissementId, mergedIntoId: null, OR: [{ birthDate }, ...(nationalIdHash ? [{ nationalIdHash }] : [])] },
      take: 200,
    });
    return rows as PatientRecord[];
  }

  async search(etablissementId: string, query: { text?: string; birthDate?: Date }, includeRestricted: boolean, limit: number, offset: number) {
    const text = query.text;
    const rows = await this.prisma.patient.findMany({
      where: {
        etablissementId,
        mergedIntoId: null,
        ...(includeRestricted ? {} : { confidentiality: 'NORMAL' as const }),
        ...(query.birthDate ? { birthDate: query.birthDate } : {}),
        ...(text
          ? { OR: [{ mrn: { equals: text, mode: 'insensitive' as const } }, { lastNameNorm: { startsWith: text } }, { firstNameNorm: { startsWith: text } }] }
          : {}),
      },
      orderBy: [{ lastNameNorm: 'asc' }, { firstNameNorm: 'asc' }],
      take: limit,
      skip: offset,
    });
    return rows as PatientRecord[];
  }

  async createMerge(input: Parameters<PatientRepository['createMerge']>[0], tx?: Tx) {
    return (await dbOf(this.prisma, tx).patientMerge.create({ data: input })) as MergeRecord;
  }

  async findMerge(id: string) {
    return (await this.prisma.patientMerge.findUnique({ where: { id } })) as MergeRecord | null;
  }

  async findPendingMergeFor(etablissementId: string, patientIds: string[]) {
    return (await this.prisma.patientMerge.findFirst({
      where: { etablissementId, status: 'PENDING', OR: [{ sourceId: { in: patientIds } }, { targetId: { in: patientIds } }] },
    })) as MergeRecord | null;
  }

  async listMerges(etablissementId: string, status: MergeStatus | undefined, limit: number, offset: number) {
    return (await this.prisma.patientMerge.findMany({
      where: { etablissementId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })) as MergeRecord[];
  }

  async decideMerge(id: string, status: 'COMPLETED' | 'REJECTED', decidedBy: string, note: string | undefined, at: Date, tx?: Tx) {
    const res = await dbOf(this.prisma, tx).patientMerge.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, decidedBy, decisionNote: note, decidedAt: at },
    });
    return res.count === 1;
  }

  async markMerged(sourceId: string, targetId: string, by: string, tx?: Tx) {
    await dbOf(this.prisma, tx).patient.update({ where: { id: sourceId }, data: { active: false, mergedIntoId: targetId, updatedBy: by } });
  }
}
