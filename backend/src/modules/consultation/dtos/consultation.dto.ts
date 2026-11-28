import { z } from 'zod';

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure HH:MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date YYYY-MM-DD');

export const practitionerParamsDto = z.object({ practitionerId: z.string().uuid() });

export const scheduleDto = z.object({
  rules: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), start: hm, end: hm }).refine((r) => r.start < r.end, 'La fin doit suivre le début'))
    .max(50),
});

export const slotsQueryDto = z.object({ from: day, to: day }).refine((v) => v.from <= v.to, 'from doit précéder to');

export const createAppointmentDto = z.object({
  patientId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  startsAt: z.coerce.date(),
  reason: z.string().trim().max(300).optional(),
});

export const listAppointmentsQueryDto = z.object({
  practitionerId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const appointmentIdParamsDto = z.object({ id: z.string().uuid() });
export const cancelDto = z.object({ reason: z.string().trim().min(3).max(300) });

export type ScheduleDto = z.infer<typeof scheduleDto>;
export type SlotsQueryDto = z.infer<typeof slotsQueryDto>;
export type CreateAppointmentDto = z.infer<typeof createAppointmentDto>;
export type ListAppointmentsQueryDto = z.infer<typeof listAppointmentsQueryDto>;
