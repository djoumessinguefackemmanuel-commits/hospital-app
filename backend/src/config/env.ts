import { z } from 'zod';

/**
 * Variables d'environnement TECHNIQUES uniquement (connexions, secrets).
 * Toute valeur métier (durées, seuils, tarifs…) vit dans le module `parametrage`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET : 32 caractères minimum'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET : 32 caractères minimum'),
  /** Clé AES-256 en base64 (32 octets). */
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY : 32 octets en base64 attendus'),
  CORS_ORIGINS: z.string().default(''),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(2000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  return parsed.data;
}
