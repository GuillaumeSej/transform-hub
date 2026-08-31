# BeTrack — Script de démonstration

Ce document donne un déroulé pas-à-pas pour animer une démo de BeTrack, avec les comptes de test
et les leviers à utiliser pour illustrer chaque fonctionnalité. Deux parcours possibles :

- **Démo rapide (15-20 min)** : partir de l'entreprise de démo **Acme Corp**, déjà peuplée.
- **Démo "from scratch" (30-40 min)** : créer une nouvelle entreprise en direct pour montrer tout
  le cycle de setup (arborescences, utilisateurs, import Excel).

---

## 1. Connexion

URL : page de login BeTrack. Aucun compte n'est pré-seedé — préparation avant la démo :

1. Créer le premier compte admin : `npm run create-admin` (prompts interactifs, ou
   `npm run create-admin -- --username admin --password "..." --first Admin --last BeTrack`).
2. Se connecter avec ce compte, puis créer les comptes de rôle nécessaires à la démo via
   **Admin > Utilisateurs** (un par rôle : CTO, Sponsor, Lever Owner, Finance, RH, Ops...),
   rattachés à l'entreprise **Acme Corp** (déjà peuplée par le seed de démo automatique).

Pour la démo "from scratch", se connecter avec le compte super-admin (aucune entreprise associée)
afin de créer une nouvelle entreprise en direct.

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

Se connecter en **`admin`** (super-admin). Les 4 fichiers Excel du dossier [`demo/`](../demo/)
couvrent ce parcours de bout en bout — régénérés par `node scripts/generate-demo-excel.js` si les
formats d'import changent, ne jamais les éditer à la main.

1. **Admin > Entreprises > Nouvelle entreprise** : créer l'entreprise (nom, secteur, exercice
   fiscal). Pas de fichier Excel pour cette étape — formulaire uniquement.
2. **Configurer les arborescences** (onglets "Arborescence financière" / "Arborescence
   géographique" de la fiche entreprise) :
   - Financière : ajouter un niveau macro nommé **P&L** (usage standard "Ligne P&L") puis un
     niveau **Centre de coût**, enregistrer la structure, puis importer
     [`demo/arborescence_financiere_demo.xlsx`](../demo/arborescence_financiere_demo.xlsx) (10
     nœuds : 4 comptes P&L, 6 centres de coût).
   - Géographique : ajouter un niveau macro nommé **Continent** puis un niveau **Pays**,
     enregistrer la structure, puis importer
     [`demo/arborescence_geographique_demo.xlsx`](../demo/arborescence_geographique_demo.xlsx) (6
     nœuds : 2 continents, 4 pays).
   - Les libellés de niveaux doivent être nommés exactement ainsi (ou les mêmes clés) : la colonne
     "Niveau" du fichier matche par libellé ou par clé, insensible à la casse.
3. **Créer un utilisateur** (onglet "Utilisateurs") avec un rôle autre qu'Admin Entreprise (ex.
   CTO) pour accéder aux pages Dashboard/Leviers/RH — Admin Entreprise ne voit que la
   configuration de l'entreprise, pas les pages opérationnelles.
4. **Import des données**, connecté avec ce nouvel utilisateur :
   - Leviers + Actions + Impacts via Bibliothèque des leviers > Importer un fichier >
     [`demo/leviers_demo.xlsx`](../demo/leviers_demo.xlsx) (7 leviers, dont 4 workstreams
     auto-créés et 1 dépendance).
   - Base ETP + mouvements via Base ETP > Importer Excel >
     [`demo/base_etp_demo.xlsx`](../demo/base_etp_demo.xlsx) (12 employés, 6 mouvements liés aux
     leviers importés).
5. **Vérifier les affichages** : dashboard exécutif (KPIs, filtres dynamiques selon les niveaux
   configurés, graphique P&L par compte), bibliothèque des leviers (colonne P&L macro + tooltip),
   Focus Levier (sections repliables, risque calculé).

Ce parcours a été validé de bout en bout deux fois : sur une entreprise fictive ("NordicRetail",
via import direct de fichiers legacy) et sur une entreprise "DemoCheck" créée uniquement à partir
des 4 fichiers ci-dessus (tous importés sans une seule ligne en erreur), avant suppression des
données de test.

### Leviers de démo pour illustrer les moteurs de risque

Le fichier `leviers_demo.xlsx` ci-dessus couvre la diversité des statuts/workstreams mais pas les
moteurs de risque. Pour les démontrer isolément, trois leviers ont été ajoutés au jeu de données
`data/mockData.ts` (visibles après un reset de démo sur Acme, ou reproductibles à la main sur
n'importe quelle entreprise) :

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
