/**
 * Règles d'architecture (docs/00-conventions.md §5 et conception §6.2).
 * La CI échoue si une règle est violée.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-import',
      comment: 'Un module n\'importe jamais un autre module : événements ou shared/contracts uniquement.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: '^src/modules/$1/' },
    },
    {
      name: 'core-and-shared-do-not-import-modules',
      comment: 'Le noyau et le transverse ne dépendent d\'aucun module métier.',
      severity: 'error',
      from: { path: '^src/(core|shared|config)/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'controller-no-repository',
      comment: 'Un controller n\'accède jamais à la base : il appelle un service.',
      severity: 'error',
      from: { path: '/controllers/' },
      to: { path: '/(repositories|models)/|@prisma/client' },
    },
    {
      name: 'service-no-http',
      comment: 'Un service ne connaît ni req/res ni Express.',
      severity: 'error',
      from: { path: '/services/' },
      to: { path: '^node_modules/(express|helmet|cors)(/|$)|/(controllers|routes)/' },
    },
    {
      name: 'repository-no-business-layers',
      comment: 'Un repository ne contient que de l\'accès aux données.',
      severity: 'error',
      from: { path: '/repositories/' },
      to: { path: '/(services|controllers|routes)/' },
    },
    {
      name: 'routes-no-repository',
      severity: 'error',
      from: { path: '/routes/' },
      to: { path: '/(repositories|models)/' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$|/tests/' },
  },
};
