import type { PrismaClient } from '@prisma/client';
import { dbOf } from '../../../core/database/prisma';
import type { Tx } from '../../../shared/contracts';
import type { NewPatient, PatientPatch, PatientRecord } from '../models/patient.model';

export interface PatientRepository {
  /** Incrémente atomiquement le compteur annuel et retourne la nouvelle valeur. */
  nextSequence(etablissementId: string, year: number, tx?: Tx): Promise<number>;
  etablissementCode(etablissementId: string): Promise<string | null>;
  create(input: NewPatient, tx?: Tx): Promise<PatientRecord>;
  findById(id: string): Promise<PatientRecord | null>;
  update(id: string, patch: PatientPatch, updatedBy: string, tx?: Tx): Promise<PatientRecord>;
  findDuplicateCandidates(etablissementId: string, birthDate: Date, nationalIdHash?: string): Promise<PatientRecord[]>;
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
      where: { etablissementId, OR: [{ birthDate }, ...(nationalIdHash ? [{ nationalIdHash }] : [])] },
      take: 200,
    });
    return rows as PatientRecord[];
  }

  async search(etablissementId: string, query: { text?: string; birthDate?: Date }, includeRestricted: boolean, limit: number, offset: number) {
    const text = query.text;
    const rows = await this.prisma.patient.findMany({
      where: {
        etablissementId,
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
}
