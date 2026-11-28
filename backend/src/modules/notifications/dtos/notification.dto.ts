import { z } from 'zod';

export const listNotificationsQueryDto = z.object({
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED']).optional(),
  patientId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const notificationIdParamsDto = z.object({ id: z.string().uuid() });
