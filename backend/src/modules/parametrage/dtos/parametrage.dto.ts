import { z } from 'zod';

const scopeType = z.enum(['GLOBAL', 'ETABLISSEMENT', 'SERVICE', 'ROLE']);
const scopeId = z.string().min(1).max(100).optional();

export const codeParamsDto = z.object({ code: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_<>]+)*$/i).max(120) });

export const definitionsQueryDto = z.object({ module: z.string().max(60).optional() });

export const effectiveQueryDto = z.object({
  etablissementId: z.string().max(100).optional(),
  serviceId: z.string().max(100).optional(),
  roleCode: z.string().max(100).optional(),
});

export const setValueDto = z.object({
  scopeType,
  scopeId,
  value: z.unknown().refine((v) => v !== undefined, 'value requis'),
  reason: z.string().trim().min(3, 'Un motif est obligatoire').max(500),
  effectiveFrom: z.coerce.date().optional(),
});

export const approveDto = z.object({
  scopeType,
  scopeId,
  version: z.number().int().positive(),
});

export const rollbackDto = z.object({
  scopeType,
  scopeId,
  toVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export const historyQueryDto = z.object({ scopeType: scopeType.optional(), scopeId });

export type SetValueDto = z.infer<typeof setValueDto>;
export type ApproveDto = z.infer<typeof approveDto>;
export type RollbackDto = z.infer<typeof rollbackDto>;
