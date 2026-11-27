import { z } from 'zod';

const name = z.string().trim().min(1).max(100);
const birthDate = z.coerce.date().refine((d) => d <= new Date() && d.getFullYear() > 1880, 'Date de naissance invalide');
const phone = z.string().trim().regex(/^\+?[0-9 .()-]{6,20}$/, 'Téléphone invalide');

export const createPatientDto = z.object({
  lastName: name,
  firstName: name,
  birthDate,
  sex: z.enum(['M', 'F', 'OTHER', 'UNKNOWN']).default('UNKNOWN'),
  phone: phone.optional(),
  email: z.string().trim().email().max(254).optional(),
  address: z.string().trim().max(300).optional(),
  nationalId: z.string().trim().min(4).max(40).optional(),
  confidentiality: z.enum(['NORMAL', 'RESTRICTED']).default('NORMAL'),
  /** L'utilisateur a examiné les doublons proposés et confirme la création. */
  confirmNotDuplicate: z.boolean().default(false),
});

export const updatePatientDto = z
  .object({
    lastName: name,
    firstName: name,
    birthDate,
    sex: z.enum(['M', 'F', 'OTHER', 'UNKNOWN']),
    phone,
    email: z.string().trim().email().max(254),
    address: z.string().trim().max(300),
    confidentiality: z.enum(['NORMAL', 'RESTRICTED']),
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Aucune modification fournie');

export const patientIdParamsDto = z.object({ id: z.string().uuid() });

export const searchQueryDto = z
  .object({
    q: z.string().trim().min(2).max(60).optional(),
    birthDate: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((v) => v.q !== undefined || v.birthDate !== undefined, 'Précisez q ou birthDate');

export type CreatePatientDto = z.infer<typeof createPatientDto>;
export type UpdatePatientDto = z.infer<typeof updatePatientDto>;
export type SearchQueryDto = z.infer<typeof searchQueryDto>;

export const requestMergeDto = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});
export const rejectMergeDto = z.object({ note: z.string().trim().min(3).max(500) });
export const mergeIdParamsDto = z.object({ id: z.string().uuid() });
export const listMergesQueryDto = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
