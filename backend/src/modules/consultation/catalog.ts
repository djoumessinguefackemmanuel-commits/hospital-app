/** Permissions du module consultation (préfixe CONSULT, conventions §2). */
export const CONSULT_PERMISSION_CATALOG: { code: string; resource: string; action: string }[] = [
  { code: 'CONSULT_RDV_READ', resource: 'RDV', action: 'READ' },
  { code: 'CONSULT_RDV_CREATE', resource: 'RDV', action: 'CREATE' },
  { code: 'CONSULT_RDV_CANCEL', resource: 'RDV', action: 'CANCEL' },
  { code: 'CONSULT_RDV_CANCEL_LATE', resource: 'RDV', action: 'CANCEL_LATE' },
  /** Marque un utilisateur comme praticien dont l'agenda peut recevoir des rendez-vous. */
  { code: 'CONSULT_RDV_PRACTITIONER', resource: 'RDV', action: 'PRACTITIONER' },
  { code: 'CONSULT_AGENDA_UPDATE', resource: 'AGENDA', action: 'UPDATE' },
];
