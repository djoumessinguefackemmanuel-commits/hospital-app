import type { NewParametreDefinition, ParametreType, ScopeType, Validation } from './models/parametre.model';

/**
 * Catalogue de référence des paramètres (conception §5.4). Il est chargé en base par le seed ;
 * l'hôpital modifie ensuite les VALEURS depuis la console, jamais ce fichier.
 * Les valeurs par défaut sont des points de départ à valider par l'établissement.
 */

const G: ScopeType[] = ['GLOBAL'];
const GE: ScopeType[] = ['GLOBAL', 'ETABLISSEMENT'];
const GER: ScopeType[] = ['GLOBAL', 'ETABLISSEMENT', 'ROLE'];

function def(
  code: string,
  type: ParametreType,
  fr: string,
  defaultValue: unknown,
  opts: { validation?: Validation; scopes?: ScopeType[]; permission: string; critical?: boolean },
): NewParametreDefinition {
  return {
    code,
    module: code.split('.')[0] ?? code,
    label: { fr },
    type,
    defaultValue,
    validation: opts.validation ?? {},
    allowedScopes: opts.scopes ?? GE,
    editPermission: opts.permission,
    critical: opts.critical ?? false,
  };
}

/** Rôles soumis au MFA par défaut (conception §4.1, colonne « Obligatoire »). */
export const DEFAULT_MFA_ROLES = [
  'DIRECTEUR',
  'CHEF_SERVICE',
  'MEDECIN',
  'CHIRURGIEN',
  'ANESTHESISTE',
  'OBSTETRICIEN',
  'PEDIATRE',
  'PHARMACIEN',
  'BIOLOGISTE',
  'RADIOLOGUE',
  'CAISSIER',
  'RESP_RH',
  'ARCHIVISTE',
  'ADMIN_SYSTEME',
  'AUDITEUR',
];

export const SOD_DEFAULT_RULES = {
  medicament: ['PRESCRIBE', 'VALIDATE', 'DISPENSE', 'ADMINISTER'],
  laboratoire: ['ENTER_RESULT', 'VALIDATE_RESULT'],
  facturation: ['CREATE_INVOICE', 'COLLECT_PAYMENT', 'REFUND'],
  achats: ['ORDER', 'RECEIVE', 'PAY_SUPPLIER'],
};

export const PARAMETRE_CATALOG: NewParametreDefinition[] = [
  // Localisation
  def('i18n.default_locale', 'STRING', 'Langue par défaut', 'fr', { validation: { pattern: '^[a-z]{2}(-[A-Z]{2})?$' }, permission: 'PARAM_LOCALISATION_UPDATE' }),
  def('i18n.enabled_locales', 'LIST', 'Langues actives', ['fr', 'en'], { validation: { itemType: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$', minItems: 1 }, permission: 'PARAM_LOCALISATION_UPDATE' }),
  def('l10n.timezone', 'STRING', 'Fuseau horaire', 'UTC', { validation: { pattern: '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' }, permission: 'PARAM_LOCALISATION_UPDATE' }),
  def('l10n.date_format', 'ENUM', 'Format de date', 'DD/MM/YYYY', { validation: { enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] }, permission: 'PARAM_LOCALISATION_UPDATE' }),
  def('l10n.currency.base', 'STRING', 'Devise de base (ISO 4217)', 'EUR', { validation: { pattern: '^[A-Z]{3}$' }, permission: 'PARAM_LOCALISATION_UPDATE', critical: true }),

  // Sécurité
  def('security.password.min_length', 'INT', 'Longueur minimale du mot de passe', 12, { validation: { min: 8, max: 128 }, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.password.max_age_days', 'INT', 'Durée de vie du mot de passe (jours, 0 = illimitée)', 90, { validation: { min: 0, max: 365 }, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.password.history', 'INT', 'Mots de passe mémorisés', 5, { validation: { min: 0, max: 24 }, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.mfa.required_roles', 'LIST', 'Rôles soumis au second facteur', DEFAULT_MFA_ROLES, { validation: { itemType: 'string', pattern: '^[A-Z_]+$' }, permission: 'PARAM_SECURITE_UPDATE', critical: true }),
  def('security.mfa.methods', 'LIST', 'Méthodes de second facteur', ['totp'], { validation: { itemType: 'string', enum: ['totp', 'sms'], minItems: 1 }, scopes: G, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.session.idle_timeout_min', 'INT', 'Inactivité avant déconnexion (minutes)', 15, { validation: { min: 1, max: 120 }, scopes: GER, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.session.access_ttl_min', 'INT', 'Durée du jeton d\'accès (minutes)', 15, { validation: { min: 1, max: 60 }, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.session.absolute_hours', 'INT', 'Durée maximale d\'une session (heures)', 12, { validation: { min: 1, max: 24 }, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.login.max_attempts', 'INT', 'Échecs de connexion avant verrouillage', 5, { validation: { min: 3, max: 10 }, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.login.lockout_min', 'INT', 'Durée de verrouillage (minutes)', 15, { validation: { min: 1, max: 1440 }, permission: 'PARAM_SECURITE_UPDATE' }),
  def('security.sod.rules', 'JSON', 'Règles de séparation des tâches', SOD_DEFAULT_RULES, { scopes: G, permission: 'PARAM_SECURITE_UPDATE', critical: true }),
  def('security.breakglass.duration_min', 'INT', 'Durée de l\'accès d\'urgence (minutes)', 60, { validation: { min: 5, max: 240 }, permission: 'PARAM_SECURITE_UPDATE' }),

  // Audit et sauvegardes (la durée légale est à fixer avec le juridique)
  def('audit.retention_years', 'INT', 'Rétention des journaux d\'audit (années)', 10, { validation: { min: 1, max: 100 }, permission: 'PARAM_AUDIT_UPDATE', critical: true }),
  def('backup.schedule', 'CRON', 'Planification des sauvegardes', '0 2 * * *', { scopes: G, permission: 'PARAM_SAUVEGARDE_UPDATE' }),
  def('backup.retention_days', 'INT', 'Rétention des sauvegardes (jours)', 35, { validation: { min: 7, max: 3650 }, scopes: G, permission: 'PARAM_SAUVEGARDE_UPDATE' }),

  // Patients et rendez-vous
  def('patient.mrn.format', 'STRING', 'Format du numéro de dossier', '{SITE}-{YYYY}-{SEQ:6}', { validation: { min: 3, max: 60 }, permission: 'PARAM_PATIENT_UPDATE', critical: true }),
  def('patient.duplicate.threshold', 'DECIMAL', 'Seuil de similarité pour doublon', 0.85, { validation: { min: 0.5, max: 1 }, permission: 'PARAM_PATIENT_UPDATE' }),
  def('patient.merge.requires_approval', 'BOOL', 'Fusion de dossiers soumise à approbation', true, { permission: 'PARAM_PATIENT_UPDATE' }),
  def('appointment.slot_minutes', 'INT', 'Durée d\'un créneau (minutes)', 20, { validation: { min: 5, max: 240 }, permission: 'PARAM_RDV_UPDATE' }),
  def('appointment.cancel_deadline_h', 'INT', 'Délai d\'annulation d\'un rendez-vous (heures)', 24, { validation: { min: 0, max: 168 }, permission: 'PARAM_RDV_UPDATE' }),
  def('appointment.reminder_offsets_h', 'LIST', 'Rappels avant rendez-vous (heures)', [48, 2], { validation: { itemType: 'int', maxItems: 5 }, permission: 'PARAM_RDV_UPDATE' }),

  // Facturation
  def('billing.payment.methods', 'LIST', 'Moyens de paiement', ['CASH', 'CARD', 'TRANSFER', 'MOBILE'], { validation: { itemType: 'string', pattern: '^[A-Z_]+$', minItems: 1 }, permission: 'PARAM_FACTURATION_UPDATE' }),
  def('billing.invoice.due_days', 'INT', 'Délai de paiement des factures (jours)', 30, { validation: { min: 0, max: 365 }, permission: 'PARAM_FACTURATION_UPDATE' }),

  // Notifications
  def('notif.channels.enabled', 'LIST', 'Canaux de notification actifs', ['email', 'sms'], { validation: { itemType: 'string', enum: ['email', 'sms'], minItems: 0 }, permission: 'PARAM_NOTIF_UPDATE' }),
  def('notif.quiet_hours', 'MAP', 'Plage sans envoi de notifications', { start: '21:00', end: '07:00' }, { permission: 'PARAM_NOTIF_UPDATE' }),
  def('notif.retry.max', 'INT', 'Réessais d\'envoi de notification', 3, { validation: { min: 0, max: 10 }, permission: 'PARAM_NOTIF_UPDATE' }),
];

/** Permissions du module parametrage (format PREFIXE_RESSOURCE_ACTION). */
export const PARAMETRAGE_PERMISSIONS: { code: string; resource: string; action: string }[] = [
  { code: 'PARAM_PARAMETRE_READ', resource: 'PARAMETRE', action: 'READ' },
  { code: 'PARAM_PARAMETRE_UPDATE', resource: 'PARAMETRE', action: 'UPDATE' },
  { code: 'PARAM_PARAMETRE_APPROVE', resource: 'PARAMETRE', action: 'APPROVE' },
  ...['LOCALISATION', 'SECURITE', 'AUDIT', 'SAUVEGARDE', 'PATIENT', 'RDV', 'FACTURATION', 'NOTIF'].map((r) => ({
    code: `PARAM_${r}_UPDATE`,
    resource: r,
    action: 'UPDATE',
  })),
];
