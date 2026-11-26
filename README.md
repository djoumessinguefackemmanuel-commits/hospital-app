# HMS Hospital-App

Système d'information hospitalier modulaire et paramétrable (monolithe modulaire : Node.js, Express, TypeScript, PostgreSQL, Prisma, Redis, React).

- Conception : [`docs/conception-initiale.md`](docs/conception-initiale.md)
- Conventions (source de vérité) : [`docs/00-conventions.md`](docs/00-conventions.md)
- `backend/` : 29 modules sous `src/modules/<slug>/` (controllers, services, repositories, models, routes, dtos, validators, tests)
- `frontend/` : un dossier par module sous `src/features/<slug>/`
- Démarrage de l'infrastructure locale : `docker compose up -d`

État : structure uniquement, pas encore de code applicatif.
