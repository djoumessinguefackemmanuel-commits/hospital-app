import pino, { type Logger } from 'pino';

export type { Logger };

/** Chemins masqués : aucune donnée d'authentification ni de santé ne doit finir dans les logs. */
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.mfaToken',
  '*.setupToken',
  '*.code',
  '*.mfaSecret',
  '*.secret',
];

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    redact: { paths: REDACT, censor: '[masqué]' },
    base: { service: 'hms-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
