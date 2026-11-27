import { hash, verify } from '@node-rs/argon2';

/** Argon2id (paramètres par défaut de la bibliothèque : 19 Mio, 2 itérations). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export interface PasswordPolicy {
  minLength: number;
}

/** Retourne la liste des règles non respectées (vide = conforme). */
export function checkPasswordPolicy(password: string, policy: PasswordPolicy, personal: string[] = []): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) problems.push(`au moins ${policy.minLength} caractères`);
  if (!/[a-z]/.test(password)) problems.push('une minuscule');
  if (!/[A-Z]/.test(password)) problems.push('une majuscule');
  if (!/[0-9]/.test(password)) problems.push('un chiffre');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('un caractère spécial');
  const lower = password.toLowerCase();
  if (personal.some((p) => p.length >= 4 && lower.includes(p.toLowerCase()))) {
    problems.push('ne pas contenir votre identifiant ou votre nom');
  }
  return problems;
}
