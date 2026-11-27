/** Permissions du module auth (format PREFIXE_RESSOURCE_ACTION, conventions §6). */
export const AUTH_PERMISSION_CATALOG: { code: string; resource: string; action: string }[] = [
  { code: 'AUTH_USER_READ', resource: 'USER', action: 'READ' },
  { code: 'AUTH_USER_CREATE', resource: 'USER', action: 'CREATE' },
  { code: 'AUTH_USER_UPDATE', resource: 'USER', action: 'UPDATE' },
  { code: 'AUTH_ROLE_READ', resource: 'ROLE', action: 'READ' },
  { code: 'AUTH_ROLE_UPDATE', resource: 'ROLE', action: 'UPDATE' },
  { code: 'AUTH_ROLE_EXPORT', resource: 'ROLE', action: 'EXPORT' },
];
