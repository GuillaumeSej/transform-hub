# BeTrack — Script de démonstration

Ce document donne un déroulé pas-à-pas pour animer une démo de BeTrack, avec les comptes de test
et les leviers à utiliser pour illustrer chaque fonctionnalité. Deux parcours possibles :

- **Démo rapide (15-20 min)** : partir de l'entreprise de démo **Acme Corp**, déjà peuplée.
- **Démo "from scratch" (30-40 min)** : créer une nouvelle entreprise en direct pour montrer tout
  le cycle de setup (arborescences, utilisateurs, import Excel).

---

## 1. Connexion

URL : page de login BeTrack. Identifiant au format `prenom.nom`, mot de passe `test123` pour tous
les comptes de démo.

| Identifiant    | Rôle             | Entreprise | Ce que ce compte voit                                           |
| -------------- | ---------------- | ---------- | --------------------------------------------------------------- |
| `admin`        | Super-admin      | Toutes     | Gestion multi-entreprises, création de compagnies               |
| `admin.c1`     | Admin entreprise | Acme Corp  | Tout Acme + configuration (utilisateurs, arborescences, risque) |
| `test.cto`     | CTO              | Acme Corp  | Vue exécutive complète, tous les leviers                        |
| `test.sponsor` | Sponsor          | Acme Corp  | Leviers dont il est sponsor                                     |
| `test.lever`   | Lever Owner      | Acme Corp  | Uniquement ses propres leviers                                  |
| `test.finance` | Finance          | Acme Corp  | Module Finance, agrégats P&L                                    |
| `test.hr`      | RH               | Acme Corp  | Dashboard RH, base ETP                                          |
| `test.ops`     | Ops              | Acme Corp  | Vue opérationnelle                                              |

Pour la démo "from scratch", utiliser `admin` (super-admin, aucune entreprise associée) afin de
créer une nouvelle entreprise en direct.

---

## 2. Démo rapide — Acme Corp

Se connecter en **`test.cto`** (vue la plus complète). Acme Corp est l'entreprise de démo
principale : ~11 leviers actifs, arborescence financière (P&L → Aggrégat) et géographique
(Continent → Pays) toutes deux configurées, alertes et dépendances déjà en place.

### 2.1 Tableau de bord exécutif

- **KPI "Économies réalisées"** : pointer le bloc "Ambition Programme" séparé visuellement de la
  cible bottom-up — expliquer la différence (cible = somme des leviers ; ambition = objectif
  macro fixé par le programme, pas forcément atteint par la somme des leviers identifiés à date).
- **Filtres dynamiques** : montrer que la barre de filtres affiche **Continent** ET **Pays**
  séparément (2 niveaux géographiques configurés → 2 filtres distincts), et **P&L** / **Aggrégat**
  séparément pour la hiérarchie financière. Message clé : le nombre de filtres suit exactement le
  nombre de niveaux configurés pour l'entreprise — une entreprise avec 4 niveaux géographiques
  verrait 4 filtres.
- **Widget "Impact P&L par compte"** : montre TOUS les comptes P&L définis dans l'arborescence,
  y compris ceux sans levier dessus (barre vide) — pas seulement ceux qui ont un impact.

### 2.2 Bibliothèque des leviers (tableau)

- Faire défiler les colonnes jusqu'à la colonne **P&L** : une seule colonne (le niveau macro),
  pas une par niveau — survoler la cellule pour révéler le détail complet (tous les niveaux,
  du macro au plus fin) en tooltip.
- Ouvrir le levier marqué d'une alerte (icône ⚠ à côté du code, ex. COM-002) pour enchaîner sur le
  Focus Levier.

### 2.3 Focus Levier

- Montrer les blocs **Description / Identité / Périmètre / Planning / Courbe en J & Timeline /
  Dépendances** : chacun a un chevron cliquable, repliable indépendamment des autres. Replier
  "Description" pour illustrer, puis rouvrir.
- Sur un levier en alerte : le bloc **Risque** (bandeau du haut) reflète un risque calculé
  automatiquement à partir des alertes actives (pas une valeur saisie à la main) — deux moteurs
  l'alimentent déjà :
  - **Retard planning** : un levier "en cours" dont la progression réelle est très en retard sur
    la progression attendue (calculée à partir des dates début/fin) génère une alerte dont le
    montant d'impact est proportionnel au retard ET au net savings visé — donc "beaucoup de
    retard sur un gros levier" pousse mécaniquement le risque en Critical, alors qu'un petit
    retard sur un petit levier reste Low.
  - **Dérive des investissements** : si les coûts réactualisés (CAPEX + OPEX one-off) dépassent le
    plan initial figé, la différence génère une alerte de risque du même type, indépendamment du
    planning.
  - Les deux moteurs sont cumulatifs : un levier peut être à risque à la fois pour retard et pour
    dérive de coûts, et les deux s'additionnent avant seuillage (Low/Medium/High/Critical).

### 2.4 Import Excel des leviers

- **Template Excel** → montrer les 3 onglets (Leviers / Actions / Impacts) et la colonne
  optionnelle "Programme".
- Importer un fichier contenant un Workstream inexistant → il est **créé automatiquement**
  (pas besoin d'aller le créer à la main avant).
- Un Programme inconnu dans la colonne "Programme", lui, reste une erreur de ligne — il doit déjà
  exister (créé dans Admin > Programmes) avant l'import.

---

## 3. Démo "from scratch" — nouvelle entreprise

Se connecter en **`admin`** (super-admin).

1. **Admin > Entreprises > Nouvelle entreprise** : créer l'entreprise (nom, secteur, exercice
   fiscal).
2. **Configurer les arborescences** : ajouter les niveaux financiers (ex. P&L → Centre de coût) et
   géographiques (ex. Continent → Pays), puis les nœuds de chaque arborescence.
3. **Paramètres de setup** : créer les utilisateurs (rôles), définir la confidentialité
   (`roleClearance`) et les seuils de risque (`riskThresholds`) de l'entreprise.
4. **Import des données** :
   - Base ETP (effectifs) et mouvements RH via Dashboard RH > Import.
   - Leviers + Actions + Impacts via Bibliothèque des leviers > Importer un fichier.
5. **Vérifier les affichages** : dashboard exécutif (KPIs, filtres dynamiques selon les niveaux
   configurés, graphique P&L par compte), bibliothèque des leviers (colonne P&L macro + tooltip),
   Focus Levier (sections repliables, risque calculé).

Ce parcours a été validé de bout en bout sur une entreprise fictive ("NordicRetail") : création,
configuration des deux arborescences, import ETP/mouvements/leviers, et vérification que le
graphique P&L affiche bien tous les comptes définis (y compris ceux sans levier).

### Leviers de démo pour illustrer les moteurs de risque

Trois leviers ont été ajoutés au jeu de données de démo (`data/mockData.ts`, visibles après un
reset de démo ou dans un nouveau jeu de données construit sur le même modèle) pour illustrer
chaque moteur de risque isolément :

| Code    | Nom                                       | Ce qu'il démontre                                                                                                                                                  |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ORG-003 | Renégociation baux immobiliers Europe     | Retard planning seul (90% du délai écoulé, 25% de progression) → risque Critical par le montant du retard                                                          |
| DIG-003 | Automatisation support client US          | Dérive des investissements seule (CAPEX+OPEX réactualisés bien au-dessus du plan) → risque High                                                                    |
| SC-003  | Mutualisation flotte véhicules Sud Europe | Levier sain, avec une dépendance amont (illustre le bloc Dépendances) et un drill-down complet sur les deux arborescences (P&L + Centre de coût, Continent + Pays) |

---

## 4. Points de vigilance à mentionner si la question vient

- Les données RH/ETP ne sont pas encore multi-tenant : elles sont partagées entre toutes les
  entreprises de démo (limitation connue, pas encore corrigée).
- Un levier importé par Excel n'a pas de rattachement précis à l'arborescence tant qu'il n'a pas
  été édité manuellement dans le formulaire de levier (le rattachement macro P&L via le code de
  compte legacy fonctionne en repli automatique, mais le picker d'arborescence fin reste manuel).
