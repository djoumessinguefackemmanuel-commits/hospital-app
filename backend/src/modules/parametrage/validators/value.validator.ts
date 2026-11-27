import { z, type ZodTypeAny } from 'zod';
import { BusinessRuleError } from '../../../core/errors/app-error';
import type { ParametreDefinition, Validation } from '../models/parametre.model';

function numberSchema(v: Validation, integer: boolean): ZodTypeAny {
  let s = integer ? z.number().int() : z.number();
  if (v.min !== undefined) s = s.min(v.min);
  if (v.max !== undefined) s = s.max(v.max);
  return s;
}

function stringSchema(v: Validation): ZodTypeAny {
  let s = z.string();
  if (v.min !== undefined) s = s.min(v.min);
  if (v.max !== undefined) s = s.max(v.max);
  if (v.pattern) s = s.regex(new RegExp(v.pattern));
  if (v.enum) {
    const allowed = v.enum;
    return s.refine((x) => allowed.includes(x), { message: `valeur parmi : ${allowed.join(', ')}` });
  }
  return s;
}

/** Construit le schéma Zod qui valide la valeur d'un paramètre selon sa définition. */
export function buildValueSchema(def: ParametreDefinition): ZodTypeAny {
  const v = def.validation;
  switch (def.type) {
    case 'INT':
      return numberSchema(v, true);
    case 'DECIMAL':
      return numberSchema(v, false);
    case 'BOOL':
      return z.boolean();
    case 'STRING':
    case 'ENUM':
      return stringSchema(v);
    case 'LIST': {
      const item = v.itemType === 'int' ? z.number().int() : stringSchema({ enum: v.enum, pattern: v.pattern });
      let s = z.array(item);
      if (v.minItems !== undefined) s = s.min(v.minItems);
      if (v.maxItems !== undefined) s = s.max(v.maxItems);
      return s;
    }
    case 'MAP':
      return z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
    case 'JSON':
      return z.unknown().refine((x) => x !== undefined, { message: 'valeur requise' });
    case 'DATE':
      return z.string().refine((x) => !Number.isNaN(Date.parse(x)), { message: 'date ISO 8601 attendue' });
    case 'DURATION':
      return z.number().int().positive();
    case 'CRON':
      return z.string().regex(/^(\S+\s+){4}\S+$/, 'expression cron à 5 champs attendue');
    case 'URL':
      return z.string().url();
    case 'SECRET':
      throw new BusinessRuleError(
        'Les paramètres de type SECRET sont gérés dans le coffre de secrets, pas dans la console',
        'secret_not_supported',
      );
  }
}

/** Valide `value` ; lève une erreur métier (422) listant les écarts. */
export function assertValidValue(def: ParametreDefinition, value: unknown): void {
  const parsed = buildValueSchema(def).safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => i.message).join(' ; ');
    throw new BusinessRuleError(`Valeur invalide pour ${def.code} : ${detail}`, 'invalid_parameter_value');
  }
}
