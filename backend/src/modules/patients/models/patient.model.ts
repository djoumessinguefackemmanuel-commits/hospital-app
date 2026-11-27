export type Sex = 'M' | 'F' | 'OTHER' | 'UNKNOWN';
export type Confidentiality = 'NORMAL' | 'RESTRICTED';

export interface PatientRecord {
  id: string;
  etablissementId: string;
  mrn: string;
  lastName: string;
  firstName: string;
  lastNameNorm: string;
  firstNameNorm: string;
  birthDate: Date;
  sex: Sex;
  phone: string | null;
  email: string | null;
  address: string | null;
  nationalIdEnc: string | null;
  nationalIdHash: string | null;
  confidentiality: Confidentiality;
  active: boolean;
  mergedIntoId: string | null;
}

export interface NewPatient {
  etablissementId: string;
  mrn: string;
  lastName: string;
  firstName: string;
  lastNameNorm: string;
  firstNameNorm: string;
  birthDate: Date;
  sex: Sex;
  phone?: string;
  email?: string;
  address?: string;
  nationalIdEnc?: string;
  nationalIdHash?: string;
  confidentiality: Confidentiality;
  createdBy: string;
}

export type PatientPatch = Partial<
  Pick<PatientRecord, 'lastName' | 'firstName' | 'lastNameNorm' | 'firstNameNorm' | 'birthDate' | 'sex' | 'phone' | 'email' | 'address' | 'confidentiality' | 'active' | 'mergedIntoId' | 'nationalIdEnc' | 'nationalIdHash'>
>;

/** Vue publique : l'identifiant national n'est jamais renvoyé en clair. */
export interface PatientView {
  id: string;
  mrn: string;
  lastName: string;
  firstName: string;
  birthDate: string;
  sex: Sex;
  phone: string | null;
  email: string | null;
  address: string | null;
  nationalIdMasked: string | null;
  confidentiality: Confidentiality;
  active: boolean;
  mergedIntoId: string | null;
}

export interface DuplicateCandidate {
  id: string;
  mrn: string;
  lastName: string;
  firstName: string;
  birthDate: string;
  score: number;
}

export interface PatientActor {
  userId: string;
  etablissementId: string;
  permissions: string[];
  correlationId?: string;
}

export type MergeStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';

export interface MergeRecord {
  id: string;
  etablissementId: string;
  sourceId: string;
  targetId: string;
  status: MergeStatus;
  reason: string;
  requestedBy: string;
  decidedBy: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}
