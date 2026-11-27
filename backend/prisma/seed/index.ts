/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PARAMETRE_CATALOG, PARAMETRAGE_PERMISSIONS } from '../../src/modules/parametrage/catalog';
import { AUTH_PERMISSION_CATALOG } from '../../src/modules/auth/catalog';
import { hashPassword } from '../../src/core/security/password';

const ROLES = [
  'DIRECTEUR', 'CHEF_SERVICE', 'MEDECIN', 'CHIRURGIEN', 'ANESTHESISTE', 'OBSTETRICIEN', 'PEDIATRE', 'IDE', 'IADE', 'IBODE',
  'SAGE_FEMME', 'AIDE_SOIGNANT', 'PHARMACIEN', 'PREPARATEUR_PHARMA', 'BIOLOGISTE', 'TECH_LABO', 'RADIOLOGUE', 'MANIP_RADIO',
  'RECEPTIONNISTE', 'CAISSIER', 'GESTIONNAIRE_STOCK', 'RESP_RH', 'AGENT_SECURITE', 'ARCHIVISTE', 'AGENT_MAINTENANCE_BIO',
  'AGENT_HYGIENE', 'PATIENT', 'ADMIN_SYSTEME', 'AUDITEUR',
];

const label = (code: string) => code.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Séparation des tâches : l'approbateur d'un paramètre critique n'est pas l'administrateur qui le modifie. */
const ROLE_PERMISSIONS: Record<string, (code: string) => boolean> = {
  ADMIN_SYSTEME: (c) => c !== 'PARAM_PARAMETRE_APPROVE',
  DIRECTEUR: (c) => ['PARAM_PARAMETRE_READ', 'PARAM_PARAMETRE_APPROVE', 'AUTH_USER_READ', 'AUTH_ROLE_READ'].includes(c),
  AUDITEUR: (c) => ['PARAM_PARAMETRE_READ', 'AUTH_USER_READ', 'AUTH_ROLE_READ', 'AUTH_ROLE_EXPORT'].includes(c),
};

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL requis');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const etab = await prisma.etablissement.upsert({
    where: { code: 'PRINCIPAL' },
    update: {},
    create: { code: 'PRINCIPAL', name: 'Établissement principal' },
  });

  const permissions = [
    ...PARAMETRAGE_PERMISSIONS.map((p) => ({ ...p, module: 'parametrage' })),
    ...AUTH_PERMISSION_CATALOG.map((p) => ({ ...p, module: 'auth' })),
  ];
  for (const p of permissions) {
    await prisma.permission.upsert({ where: { code: p.code }, update: {}, create: p });
  }
  for (const code of ROLES) {
    await prisma.role.upsert({ where: { code }, update: {}, create: { code, label: label(code), system: true } });
  }
  for (const [roleCode, allow] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    for (const p of permissions.filter((x) => allow(x.code))) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code: p.code } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  for (const d of PARAMETRE_CATALOG) {
    const data = {
      module: d.module,
      label: d.label as object,
      type: d.type,
      defaultValue: d.defaultValue as object,
      validation: d.validation as object,
      allowedScopes: d.allowedScopes,
      editPermission: d.editPermission,
      critical: d.critical,
    };
    await prisma.parametreDefinition.upsert({ where: { code: d.code }, update: data, create: { code: d.code, ...data } });
  }

  // Compte administrateur initial : uniquement si les deux variables sont fournies (jamais de secret en dur).
  const email = process.env['SEED_ADMIN_EMAIL']?.trim().toLowerCase();
  const password = process.env['SEED_ADMIN_PASSWORD'];
  if (email && password) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN_SYSTEME' } });
      const user = await prisma.user.create({
        data: { etablissementId: etab.id, email, displayName: 'Administrateur système', passwordHash: await hashPassword(password) },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
      console.log(`Administrateur créé : ${email} (second facteur à configurer à la première connexion)`);
    }
  } else {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD absents : aucun administrateur créé.');
  }
  console.log(`Seed terminé : ${ROLES.length} rôles, ${permissions.length} permissions, ${PARAMETRE_CATALOG.length} paramètres.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
