# Guide de Mise en Place d'une Démo BeTrack

Ce document explique comment configurer une nouvelle entreprise de démonstration dans BeTrack, step par step. Les fichiers Excel de démonstration se trouvent dans le dossier `demo/`.

---

## Prérequis

- Application BeTrack lancée (`npm run dev`)
- Accès avec un compte **admin** ou **admin_entreprise**
- Fichiers Excel de démo disponibles dans `demo/` :
  - `entreprises_projets.xlsx`
  - `utilisateurs.xlsx`
  - `leviers_demo.xlsx`
  - `base_etp_demo.xlsx`

---

## Étape 1 : Créer les entreprises

1. Ouvrez l'application et naviguez vers **Admin > Entreprises**
2. Cliquez sur **Ajouter**
3. Renseignez les informations de l'entreprise :
   - **Nom** : ex. `Acme Corp`
   - **Secteur** : ex. `Industrie Manufacturière`
   - **Début exercice** : `2026-01-01`
   - **Fin exercice** : `2026-12-31`
4. Cliquez sur **Enregistrer**
5. Répétez pour chaque entreprise à créer

> **Astuce** : Vous pouvez aussi créer les entreprises manuellement en suivant le fichier `demo/entreprises_projets.xlsx` (feuille "Entreprises") pour un repère visuel des données.

---

## Étape 2 : Créer les projets

1. Naviguez vers **Admin > Projets**
2. Cliquez sur **Ajouter**
3. Pour chaque projet, renseignez :
   - **Entreprise** : sélectionnez l'entreprise créée à l'étape 1
   - **Nom du projet** : ex. `Transformation Excellence 2026`
   - **Sponsor** : ex. `CEO Office`
   - **Cible (€M)** : ex. `50`
4. Cliquez sur **Enregistrer**

> Référez-vous à la feuille "Projets" du fichier `demo/entreprises_projets.xlsx` pour la liste des projets de démo.

---

## Étape 3 : Créer les utilisateurs

1. Naviguez vers **Admin > Utilisateurs**
2. Cliquez sur **Ajouter**
3. Pour chaque utilisateur, renseignez :
   - **Identifiant** : ex. `demo.cto-acme`
   - **Prénom / Nom** : ex. `Marie` / `Durand`
   - **Nom affiché** : ex. `Marie Durand`
   - **Rôle** : sélectionnez le rôle souhaité (CTO, Sponsor, Lever Owner, Finance, HR, Ops)
   - **Mot de passe** : `test` (par défaut pour la démo)
   - **Entreprise** : sélectionnez l'entreprise associée
4. Cliquez sur **Enregistrer**

### Rôles disponibles

| Rôle | Description |
|------|-------------|
| `admin` | Administrateur global (voit toutes les entreprises) |
| `admin_entreprise` | Admin d'une entreprise (gère users, projets, cycle de vie) |
| `cto` | Chef de la transformation — vue globale |
| `sponsor` | Sponsor exécutif — validé les leviers critiques |
| `lever` | Owner de leviers — gère les leviers assignés |
| `finance` | Finance — suivi des impacts financiers |
| `hr` | Ressources Humaines — gestion de la base ETP |
| `ops` | Opérations — suivi production et KPIs |

> Le fichier `demo/utilisateurs.xlsx` contient un exemple complet (un utilisateur par rôle).

---

## Étape 4 : Configurer le cycle de vie

1. Naviguez vers **Admin > Cycle de vie**
2. Sélectionnez l'entreprise créée dans le sélecteur
3. Le cycle de vie par défaut comporte 5 étapes :
   - **L1 · Idée** — Pas de validation requise
   - **L2 · Qualifié** — Pas de validation requise
   - **L3 · Validé** — **Gate de validation** (obligatoire pour avancer)
   - **L4 · Planifié** — Pas de validation requise
   - **L5 · Réalisé** — Pas de validation requise
4. Personnalisez si nécessaire :
   - Renommez les étapes en cliquant sur les champs de texte
   - Activez/désactivez les validations (gate) en cliquant sur le bouton **Oui/Non**
   - Réordonnez les étapes avec les flèches haut/bas
5. Cliquez sur **Enregistrer**

> La configuration par défaut est généralement suffisante pour une démo. Vous pouvez la personnaliser pour simuler un processus client spécifique.

---

## Étape 5 : Importer les leviers

1. Naviguez vers **Dashboard** (ou **Leviers**)
2. Cliquez sur **Importer Excel**
3. Sélectionnez le fichier `demo/leviers_demo.xlsx`
4. La prévisualisation affiche :
   - Le nombre de lignes valides (7 leviers attendus)
   - Le nombre de lignes ignorées
   - Les avertissements éventuels (workstream ou compte P&L inconnu, etc.)
5. Vérifiez les avertissements — si un workstream est inconnu, il faudra d'abord le créer via le dashboard ou le paramétrage
6. Cliquez sur **Confirmer l'import**

> Les leviers couvrent tous les statuts (L1 à L5), les workstreams, les types et les géographies pour montrer la diversité des données.

### Données incluses dans leviers_demo.xlsx

| Code | Nom | Statut | Type |
|------|-----|--------|------|
| AC-001 | Regroupement fournisseurs packaging | L3 · Validé | Sourcing & Achats |
| AC-002 | Réduction temps d'arrêt lignes B | L4 · Planifié | Excellence Opérationnelle |
| AC-003 | Automatisation back-office finance | L2 · Qualifié | Digitalisation & Automatisation |
| AC-004 | Fusion équipes SC France-Allemagne | L1 · Idée | Réorganisation & Effectifs |
| AC-005 | Revue tarifaire produits premium | L5 · Réalisé | Pricing & Revenue Management |
| AC-006 | Optimisation réseau entrepôts EMEA | L3 · Validé | Supply Chain & Logistique |
| AC-007 | Programme qualité production Belgique | L2 · Qualifié | Excellence Opérationnelle |

---

## Étape 6 : Importer la base ETP

1. Naviguez vers **HR > Base ETP**
2. Cliquez sur **Importer Excel**
3. Sélectionnez le fichier `demo/base_etp_demo.xlsx`
4. Le fichier contient deux feuilles :
   - **Base ETP** : 18 employés répartis sur France, Allemagne et Belgique
   - **Mouvements** : 9 mouvements (Redéploiement, Suppression, Recrutement, Reconversion)
5. La prévisualisation affiche les employés et mouvements détectés
6. Vérifiez les avertissements (départements inconnus, matricules absents, etc.)
7. Cliquez sur **Confirmer l'import**

> Les mouvements sont cohérents avec les leviers importés (codes AC-001 à AC-007).

---

## Étape 7 : Vérification

Après les imports, vérifiez que les données apparaissent correctement :

### Dashboard Principal
- **KPIs** : Vérifiez que les totaux (impact brut/net, ETP, population) sont cohérents
- **Kanban** : Les 7 leviers doivent apparaître dans les colonnes L1 à L5
- **Graphiques** : Vérifiez la répartition par workstream et le burndown

### HR Dashboard
- **Effectifs** : Vérifiez que les 18 employés apparaissent dans la base
- **Mouvements** : Les 9 mouvements doivent être visibles
- **Départements** : Vérifiez la répartition par département et région
- **Impact masse salariale** : Vérifiez que les impacts sont correctement calculés

### Détails d'un levier
- Cliquez sur un levier (ex. AC-001) pour vérifier :
  - Les informations générales (owner, sponsor, dates)
  - Le statut et la progression
  - Les dépendances entre leviers
  - L'impact financier

---

## Étape 8 : Personnaliser le cycle de vie (optionnel)

Si le client souhaite un processus différent :

1. **Ajouter une étape** : Ajoutez une étape personnalisée (ex. "Pré-validation")
2. **Renommer les étapes** : Adaptez les libellés au vocabulaire du client (ex. "L3 · Validé" → "L3 · Approuvé Comité")
3. **Configurer les gates** : Activez la validation sur les étapes stratégiques
4. **Réordonner** : Adaptez l'ordre des étapes au processus métier

### Exemple de configuration personnalisée

Pour un client avec un processus en 4 étapes :

| Clé | Libellé | Validation |
|-----|---------|------------|
| `idea` | Exploration | Non |
| `qualified` | Qualifié | Non |
| `validated` | **Approuvé** | **Oui** (gate) |
| `in_progress` | En déploiement | Non |
| `delivered` | Livré | Non |

---

## Fichiers de démo disponibles

| Fichier | Description | Contenu |
|---------|-------------|---------|
| `demo/leviers_demo.xlsx` | Template import leviers | 7 leviers (L1-L5, 6 workstreams) |
| `demo/base_etp_demo.xlsx` | Template import RH | 18 employés + 9 mouvements |
| `demo/entreprises_projets.xlsx` | Setup entreprises/projets | 3 entreprises + 5 projets |
| `demo/utilisateurs.xlsx` | Setup utilisateurs | 11 utilisateurs (tous rôles) |

---

## Génération des fichiers de démo

Pour régénérer les fichiers Excel de démo (par exemple après modification des données) :

```bash
node scripts/generate-demo-excel.js
```

> Le script utilise la librairie `xlsx` déjà présente dans le projet. Les fichiers sont générés dans le dossier `demo/`.
