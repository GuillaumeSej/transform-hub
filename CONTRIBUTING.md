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
- `types/index.ts` et `lib/storage.ts` sont des fichiers partagés à fort risque de conflit — préférer des ajouts (nouveaux champs optionnels, nouvelles fonctions) plutôt que des modifications de signatures existantes, et prévenir l'équipe avant d'y toucher.

## Setup local

```bash
npm install
npm run dev       # http://localhost:3000
npm run typecheck
npm run lint
npm run format     # prettier --write
```

Un hook pre-commit (husky + lint-staged) formate et lint automatiquement les fichiers stagés.
