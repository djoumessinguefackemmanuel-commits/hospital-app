export type AppointmentStatus = 'BOOKED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

export interface ScheduleRuleRecord {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface AppointmentRecord {
  id: string;
  etablissementId: string;
  practitionerId: string;
  patientId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  reason: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  createdBy: string;
}

export interface NewAppointment {
  etablissementId: string;
  practitionerId: string;
  patientId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string;
  createdBy: string;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
}

export interface ConsultActor {
  userId: string;
  etablissementId: string;
  permissions: string[];
  correlationId?: string;
}

export interface AppointmentFilter {
  practitionerId?: string;
  patientId?: string;
  from?: Date;
  to?: Date;
  status?: AppointmentStatus;
}
