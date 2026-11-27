export const PATIENT_PERMISSION_CATALOG: { code: string; resource: string; action: string }[] = [
  { code: 'PATIENT_DOSSIER_READ', resource: 'DOSSIER', action: 'READ' },
  { code: 'PATIENT_DOSSIER_CREATE', resource: 'DOSSIER', action: 'CREATE' },
  { code: 'PATIENT_DOSSIER_UPDATE', resource: 'DOSSIER', action: 'UPDATE' },
  { code: 'PATIENT_DOSSIER_READ_RESTRICTED', resource: 'DOSSIER', action: 'READ_RESTRICTED' },
];
