# Contribuer à BeTrack

## Branches

- `main` — toujours déployable, protégée.
- `feat/<sujet>` — nouvelle fonctionnalité (ex: `feat/finance-editable-table`).
- `fix/<sujet>` — correction de bug.
- `chore/<sujet>` — outillage, config, dépendances, refactor sans impact fonctionnel.

Une branche = un sujet. Ne pas mélanger plusieurs features dans la même branche/PR.

## Commits

Format : `type: sujet court à l'impératif`

Types : `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `test`.

Exemple : `feat: ajoute le filtre RAG sur la page pipeline`

## Pull Requests

- 1 PR = 1 sujet fonctionnel clair, taille raisonnable pour être relue en une passe.
- Avant d'ouvrir une PR, vérifier localement :
  - `npm run typecheck` — zéro erreur TypeScript
  - `npm run lint` — zéro erreur ESLint
  - `npm run dev` — la page concernée a été testée manuellement dans le navigateur
- La description de la PR explique le **pourquoi**, pas seulement le quoi (le diff montre déjà le quoi).
- Au moins une review avant merge sur `main`.

## Éviter les conflits de merge

Le code est organisé par feature pour permettre le travail en parallèle sans se marcher dessus :

- `app/<feature>/` — une page/module par dossier (dashboard, levers, finance, hr, operations, governance). Ne touchez qu'au dossier de votre feature.
- `components/shared/` — composants réutilisés par plusieurs features. Toute modification ici impacte tout le monde : discuter avant de changer la signature d'un composant partagé existant.
- `types/index.ts` et `lib/hooks/useStorage.ts` sont des fichiers partagés à fort risque de conflit — préférer des ajouts (nouveaux champs optionnels, nouvelles fonctions) plutôt que des modifications de signatures existantes, et prévenir l'équipe avant d'y toucher.

## Setup local

```bash
npm install
npm run dev       # http://localhost:3000
npm run typecheck
npm run lint
npm run format     # prettier --write
```

Un hook pre-commit (husky + lint-staged) formate et lint automatiquement les fichiers stagés.

## Tests

- `npm test` (Vitest) — tests unitaires de `lib/**` et des composants (`**/__tests__`).
- `npm run test:rules` — tests des règles Firestore (`scripts/test-firestore-rules.js`) sur
  l'émulateur (port 8181, `firebase.rules-test.json`). **À lancer avant tout déploiement de
  `firestore.rules`** (`npx firebase-tools deploy --only firestore:rules --project betrack-4a630`),
  puis ajouter les cas de toute nouvelle règle. Java requis : `brew install openjdk` et
  `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.
- **Pas de tests end-to-end pour l'instant.** L'ancienne suite Playwright (`e2e/smoke.spec.ts`,
  `playwright.config.ts`, scripts `test:e2e`) a été supprimée : elle simulait la connexion en
  injectant une session dans localStorage, ce qui ne fonctionne plus avec l'authentification et
  les données Firebase. Elle est à réécrire
  contre l'**émulateur Firebase** (`firebase emulators:start` avec Auth + Firestore, données de
  démo seedées, app lancée avec les variables d'environnement pointant vers l'émulateur) avant
  d'être réintégrée au workflow. La dépendance `@playwright/test` est conservée pour cette réécriture.

## Préparer les données de la vidéo Plan Stratégique

Script : `scripts/prepare-demo-strat-video.js` (logique pure et testée dans
`scripts/lib/demoStratVideoPlan.js`, tests `lib/__tests__/demoStratVideoPlan.test.ts`). Cible :
programme « Excellence Opérationnelle 2026-2028 » (`p-strat-demo-2026`) d'Acme Corp (`c1`).

**Prérequis** : une personne ayant les droits IAM sur le projet Firebase `betrack-4a630` lance
`firebase login` sur son poste (le script réutilise cette session comme identifiants, voir
`scripts/lib/firebaseCliAdc.js`) ; `.env.local` doit contenir `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.

**Tournage à 3 connexions seulement** : `test.cto` (pilote du plan), `--sponsor` (défaut
`thomas.petit`, sponsor du chantier « Optimisation Supply Chain ») et `--restricted-user` (défaut
`comex.test`, membre du COMEX qui voit tout le plan, sans habilitation « Confidentiel »). Deux comptes EXISTANTS jamais connectés
servent de figurants : `--project-owner` (défaut `pierre.lefevre`, responsable projet) et
`--contributor` (défaut `nadia.klein`, contributeur projet). Un figurant inexistant, filmé,
pilote/admin, sponsor de l'axe du chantier ou impliqué dans « Talents & Organisation » est
remplacé automatiquement (voir les notes du dry run).

```bash
# 1. Dry run (défaut) : lit Firestore, affiche le plan, n'écrit rien
npm run prepare-demo-strat-video
# options : date de référence du tournage, distribution
node scripts/prepare-demo-strat-video.js --now 2026-10-05T09:00:00Z   --sponsor thomas.petit --restricted-user comex.test   --project-owner pierre.lefevre --contributor nadia.klein

# 2. Application (mêmes options que le dry run validé)
CONFIRM_PROD_MIGRATION=yes node scripts/prepare-demo-strat-video.js --now 2026-10-05T09:00:00Z --apply

# 3. Après le tournage : nettoyage (dry run, puis réel)
node scripts/prepare-demo-strat-video.js --cleanup
CONFIRM_PROD_MIGRATION=yes node scripts/prepare-demo-strat-video.js --cleanup --apply
```

**Ce que le script modifie** (idempotent : une relance le même jour n'écrit rien) :

- Figurants (`adminUsers`) : `profiles` ← un seul profil stratégique sur `p-strat-demo-2026`
  (`chantier_contributor` pour le responsable projet, `projet_contributor` pour le contributeur ;
  un profil stratégique existant sur ce programme est remplacé le temps du tournage, règle
  « un profil par piste et par programme »).
- Chantier « Optimisation Supply Chain » : `pilote` ← `--sponsor` s'il diffère ; 3 projets
  `demo-video-*` : 2 au sponsor (un en retard, un à échéance sous 3 semaines avec 2 livrables
  datés et un prérequis FS vers le premier → Chronologie, Dépendances, Mon espace du sponsor) et 1
  au responsable projet figurant avec le contributeur figurant (porte les demandes). Les projets
  réels (« Refonte réseau logistique EU », « Mise en place S&OP ») ne sont pas touchés.
- KPI « NPS » (axe Expérience Client) : responsable de saisie (`additionalAuthorizedUserIds`) =
  `[--sponsor]` (au lieu de `["test.cto"]`) → une valeur saisie par le sponsor affiche « Sera
  validée par Sponsor d'axe puis Pilote du plan stratégique ». Mesures intactes.
- `strategicApprovals` : demande budget du contributeur validée au palier 1 par le responsable
  projet et en attente au palier 2/2 chez le sponsor ; demande d'échéance du responsable projet en
  attente chez le sponsor (scène téléphone) ; historique du sponsor : échéance approuvée, budget
  approuvé (2 paliers), budget refusé par lui au palier 2, et dans « Mes demandes » une hausse
  d'enveloppe du chantier approuvée par le sponsor d'axe puis le pilote.
- `chantierStaffing` : 2 lignes `demo-video-*` datées qui portent une équipe de la base ETP à
  ~135 % de son disponible sur les 2 prochains mois.
- Confidentialité : ajoute « Confidentiel » à `Company.confidentialityLevels` si absent et
  l'applique à l'axe « Talents & Organisation » ; `--restricted-user` reçoit une surcharge
  individuelle (`confidentialityClearance`, celle de « Surcharges individuelles ») au niveau
  juste sous « Confidentiel » ; `test.cto` en reçoit une à « Confidentiel » seulement s'il ne voit
  pas déjà ce niveau via son rôle.

Chaque valeur écrasée est sauvegardée dans `demoData/demo-video-backup` ; `--cleanup` supprime
les documents `demo-video-*`, restaure ces valeurs (profils et habilitations compris) puis
supprime la sauvegarde. Le script ne crée **aucun** compte : il vérifie seulement que les 3
comptes filmés et les 2 figurants existent (et sont actifs) et l'affiche (OK / KO).
