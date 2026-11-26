# 00 — Conventions communes (contrat entre tous les documents)

> Ce fichier est la **source de vérité** pour les noms de modules, rôles, permissions, événements et conventions de données. Tout autre document de `docs/` doit s'y conformer.

## 1. Décisions d'architecture structurantes

| # | Décision | Justification | Alternative écartée |
|---|----------|---------------|---------------------|
| D1 | **Monolithe modulaire** (1 déploiement backend, 29 modules isolés, communication par EventBus uniquement) | Équipe réduite, cohérence transactionnelle (admission, dispensation, paiement), exploitation simple dans un hôpital de district ; frontières déjà posées pour extraction ultérieure en microservices | Microservices d'emblée : coût opérationnel, transactions distribuées, hors de portée d'une petite DSI |
| D2 | **Node.js + Express + TypeScript** (et non NestJS) | Le §4 du cahier impose un pattern strict `Route → Middleware → Controller → Service → Repository → Model` avec ordre de middlewares explicite ; Express le reproduit à l'identique. TypeScript est requis par l'étape `typecheck` de la CI. NestJS reste une alternative valide (guards/interceptors/pipes) mais impose un autre ordre d'exécution | NestJS |
| D3 | **PostgreSQL 16 + Prisma**, **un schéma PostgreSQL par module** (`patients`, `pharmacie`, …) | Isolation logique forte, extraction facilitée, droits SQL par schéma | Schéma unique `public` |
| D4 | **EventBus** : EventEmitter in-process pour le synchrone intra-transaction, **BullMQ (Redis)** pour l'asynchrone et la fiabilité (outbox pattern) | Aucun import direct entre modules ; garantie de livraison des événements critiques | Appels directs entre services |
| D5 | **Configuration en base** (module `parametrage`) : aucune valeur métier en dur, versionnée, auditée, rechargée à chaud via cache Redis + événement `parametre.updated` | Exigence clé du cahier | Fichiers de config, variables d'env métier |
| D6 | **FHIR-ready** : chaque entité clinique a une table de correspondance de ressource FHIR R4 (non exposée en V1) | Interopérabilité future sans refonte | Modèle propriétaire fermé |
| D7 | **Données médicales immuables et versionnées** (append-only, `version`, `superseded_by`), jamais de DELETE physique | Valeur légale du dossier médical | UPDATE en place |

## 2. Les 29 modules (slug = nom de dossier backend ET de `features/` frontend)

| N° | Slug | Libellé | Préfixe permission | Schéma PG |
|----|------|---------|--------------------|-----------|
| 1 | `auth` | Auth / Utilisateurs / Rôles / Permissions / MFA | `AUTH` | `auth` |
| 2 | `parametrage` | Paramétrage (structure, tarifs, référentiels, workflows, templates) | `PARAM` | `parametrage` |
| 3 | `patients` | Gestion des patients (dossier unique, MPI, antécédents, allergies) | `PATIENT` | `patients` |
| 4 | `admission` | Accueil / Admission / Orientation | `ADMISSION` | `admission` |
| 5 | `consultation` | Rendez-vous / Consultations externes | `CONSULT` | `consultation` |
| 6 | `urgences` | Urgences (triage, prise en charge, orientation) | `URGENCES` | `urgences` |
| 7 | `hospitalisation` | Hospitalisation (lits, chambres, pavillons, mouvements) | `HOSPI` | `hospitalisation` |
| 8 | `bloc-operatoire` | Bloc opératoire / Chirurgie | `BLOC` | `bloc` |
| 9 | `maternite` | Maternité / Obstétrique | `MATERNITE` | `maternite` |
| 10 | `laboratoire` | Laboratoire d'analyses médicales | `LABO` | `laboratoire` |
| 11 | `imagerie` | Imagerie médicale (DICOM) | `IMAGERIE` | `imagerie` |
| 12 | `pharmacie` | Pharmacie (stock, dispensation, officine, interne) | `PHARMACIE` | `pharmacie` |
| 13 | `sterilisation` | Stérilisation | `STERIL` | `sterilisation` |
| 14 | `banque-sang` | Banque du sang / Transfusion | `SANG` | `banque_sang` |
| 15 | `reanimation` | Réanimation / Soins intensifs | `REA` | `reanimation` |
| 16 | `soins-infirmiers` | Soins infirmiers (plan de soins, administrations) | `SOINS` | `soins_infirmiers` |
| 17 | `facturation` | Facturation / Caisse / Assurances / Mutuelles / Tiers payant | `FACT` | `facturation` |
| 18 | `personnel` | Ressources humaines (plannings, gardes, congés, paie, contrats) | `RH` | `personnel` |
| 19 | `stock` | Gestion des stocks & approvisionnements (magasin général) | `STOCK` | `stock` |
| 20 | `maintenance` | Maintenance biomédicale & technique | `MAINT` | `maintenance` |
| 21 | `restauration` | Restauration / Cuisine | `RESTO` | `restauration` |
| 22 | `hygiene` | Hygiène et assainissement | `HYGIENE` | `hygiene` |
| 23 | `archivage` | Archivage médical | `ARCHIVE` | `archivage` |
| 24 | `notifications` | Notifications (SMS, email, push, portail) | `NOTIF` | `notifications` |
| 25 | `reporting` | Reporting / Statistiques / BI | `REPORT` | `reporting` |
| 26 | `audit` | Audit & Traçabilité | `AUDIT` | `audit` |
| 27 | `administration` | Administration système / DSI | `ADMIN` | `administration` |
| 28 | `portail-patient` | Portail patient | `PORTAIL` | `portail` |
| 29 | `teleconsultation` | Téléconsultation (V2) | `TELECONSULT` | `teleconsultation` |

Transverse partagé (`src/shared/`) : `Role`, `Permission`, `AuditLog`, `Notification`, `Document`, `OutboxEvent`.

## 3. Rôles (code = valeur de `roles.code`)

`DIRECTEUR`, `CHEF_SERVICE`, `MEDECIN`, `CHIRURGIEN`, `ANESTHESISTE`, `OBSTETRICIEN`, `PEDIATRE`, `IDE`, `IADE`, `IBODE`, `SAGE_FEMME`, `AIDE_SOIGNANT`, `PHARMACIEN`, `PREPARATEUR_PHARMA`, `BIOLOGISTE`, `TECH_LABO`, `RADIOLOGUE`, `MANIP_RADIO`, `RECEPTIONNISTE`, `CAISSIER`, `GESTIONNAIRE_STOCK`, `RESP_RH`, `AGENT_SECURITE`, `ARCHIVISTE`, `AGENT_MAINTENANCE_BIO`, `AGENT_HYGIENE`, `PATIENT`, `ADMIN_SYSTEME`, `AUDITEUR`.

- Les **spécialités** (cardiologue, interne, externe, etc.) sont des **attributs paramétrables** du `Personnel`, pas des rôles : un `MEDECIN` peut avoir la spécialité `CARDIOLOGIE`.
- Les rôles sont **paramétrables** : l'hôpital peut en créer, cloner, désactiver ; les 29 ci-dessus sont fournis par le seed.

## 4. Permissions

Format : `{PREFIXE_MODULE}_{RESSOURCE}_{ACTION}` en MAJUSCULES, ex. `PHARMACIE_DISPENSATION_CREATE`, `PATIENT_DOSSIER_READ`, `FACT_PAIEMENT_CREATE`.

Actions standard : `READ`, `CREATE`, `UPDATE`, `DELETE` (soft), `EXPORT`.
Actions métier : `VALIDATE`, `DISPENSE`, `SIGN`, `APPROVE`, `CANCEL`, `ADMIT`, `DISCHARGE`, `TRANSFER`, `PRESCRIBE`, `ADMINISTER`, `REFUND`, `BREAK_GLASS` (accès d'urgence tracé).

**Séparation des tâches (SoD)** appliquée par le service, pas seulement par le RBAC : `PRESCRIBE` ≠ `VALIDATE` (pharmacie) ≠ `DISPENSE` ≠ `ADMINISTER` ≠ `FACT_PAIEMENT_CREATE` ; une même personne ne peut jamais cumuler deux étapes d'une même chaîne sur le même objet (règle `sod.enforce`, paramétrable mais non désactivable pour le circuit du médicament).

**ABAC** (en plus du RBAC) : attributs `etablissement_id`, `service_id`, `relation_de_soin` (le soignant est affecté au patient), `niveau_confidentialite` du dossier (VIP, militaire…).

## 5. Événements (EventBus)

Format : `domaine.sujet.verbe_au_passé` ou `domaine.verbe` ; payload = `{ event_id, occurred_at, actor_id, etablissement_id, correlation_id, data }`.

Événements canoniques imposés par le cahier : `patient.admitted`, `patient.discharged`, `prescription.validated`, `pharmacie.dispensed`, `lab.result.ready`, `facture.paid`, `stock.low`, `alert.critical`. Les autres suivent le même format (ex. `parametre.updated`, `rdv.created`, `lit.assigned`, `bloc.intervention.completed`, `imagerie.report.signed`).

Règle : un module **n'importe jamais** un autre module ; il publie/écoute uniquement des événements ou appelle l'API publique d'un autre module via une interface déclarée dans `shared/contracts/`.

## 6. Conventions de données

- `snake_case`, tables au **pluriel**, **UUID v4** pour les clés primaires.
- Colonnes d'audit sur toute table : `created_at`, `updated_at`, `created_by`, `updated_by`.
- **Soft delete** : `deleted_at`, `deleted_by` (tables administratives). **Immuabilité** (tables médicales) : pas d'UPDATE/DELETE ; correction = nouvelle ligne avec `version` + 1 et `supersedes_id`.
- `etablissement_id` sur toute table métier (multi-établissements).
- Colonnes chiffrées (AES-256-GCM applicatif) : identité (nom, date de naissance, pièce d'identité), contact, données de santé sensibles (VIH, santé mentale, etc.).
- Montants : `NUMERIC(14,2)` + `devise` (ISO 4217). Dates : `timestamptz` en UTC, fuseau d'affichage paramétrable.

## 7. Conventions API

- Préfixe `/api/v1/{slug}/...`, ressources au pluriel, JSON, pagination par curseur, filtres `?filter[...]`, erreurs au format RFC 9457 (`application/problem+json`).
- Idempotence : header `Idempotency-Key` obligatoire sur les POST financiers et de dispensation.
- Versioning : `/v1`, dépréciation annoncée 6 mois avant retrait.

## 8. Ordre des middlewares (§4 du cahier) et renforcement

Chaîne par route : `authenticate → authorize(permission) → auditLog(action) → validate(dto) → rateLimit → controller`.

**Point d'attention (renforcement documenté)** : un `rateLimit` global (par IP, avant `authenticate`) est ajouté en amont pour protéger les endpoints d'authentification et absorber les abus avant tout traitement coûteux ; le `rateLimit` par route/par utilisateur reste à la position imposée.

## 9. Langue et ton

Documents en **français**. Identifiants techniques (tables, colonnes, permissions, événements, endpoints) en français sans accents ou en anglais selon les conventions ci-dessus ; ne jamais mélanger dans un même identifiant.

## 10. Arborescence de la documentation

```
docs/
├── 00-conventions.md
├── 01-resume-executif.md
├── 02-architecture-globale.md
├── 03-modules/            (NN-slug.md : 1 fichier par module, NN = n° du §2)
├── 04-modele-donnees.md
├── 05-rbac/               (matrice .md + .csv)
├── 06-parametres.md
├── 07-api/                (openapi.yaml + README)
├── 08-architecture-backend-frontend.md
├── 09-user-stories.md
├── 10-workflows.md
├── 11-roadmap.md
├── 12-plan-de-tests.md
├── 13-deploiement.md
├── 14-ci-cd/              (pipeline YAML + description)
├── 15-runbooks.md
├── 16-sauvegarde-pra-pca.md
├── 17-documentation-utilisateur.md
├── 18-checklist-validation.md
├── 19-securite-conformite.md
├── 20-interoperabilite.md
└── README.md              (index)
```
