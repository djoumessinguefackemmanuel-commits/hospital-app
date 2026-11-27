import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const code6 = z.string().regex(/^\d{6}$/, 'Code à 6 chiffres');

export const loginDto = z.object({ email, password: z.string().min(1).max(256) });
export const mfaVerifyDto = z.object({ mfaToken: z.string().min(10), code: code6 });
export const mfaSetupStartDto = z.object({ setupToken: z.string().min(10) });
export const mfaSetupConfirmDto = z.object({ setupToken: z.string().min(10), code: code6 });
export const refreshDto = z.object({ refreshToken: z.string().min(20).max(512) });

export const createUserDto = z.object({
  email,
  displayName: z.string().trim().min(2).max(120),
  password: z.string().min(1).max(256),
  serviceId: z.string().uuid().optional(),
  roleCodes: z.array(z.string().regex(/^[A-Z_]+$/)).max(10).default([]),
});

export const listUsersQueryDto = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const userIdParamsDto = z.object({ id: z.string().uuid() });
export const userRoleParamsDto = z.object({ id: z.string().uuid(), roleCode: z.string().regex(/^[A-Z_]+$/) });
export const assignRoleDto = z.object({ roleCode: z.string().regex(/^[A-Z_]+$/) });
export const matrixQueryDto = z.object({ format: z.enum(['json', 'csv']).default('json') });

export type LoginDto = z.infer<typeof loginDto>;
export type MfaVerifyDto = z.infer<typeof mfaVerifyDto>;
export type CreateUserDto = z.infer<typeof createUserDto>;
