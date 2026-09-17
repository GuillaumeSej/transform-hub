/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Génère les 4 fichiers Excel de démo (dans demo/), au format EXACT attendu par les imports
 * actuels de l'app — à régénérer avec ce script si un des formats d'import change
 * (lib/hierarchyExcel.ts, lib/leverExcelImport.ts, lib/hrExcel.ts) plutôt que de les éditer à la
 * main, pour ne pas les laisser diverger silencieusement en production.
 *
 * Ne génère PAS de fichier "entreprises_projets.xlsx" ni "utilisateurs.xlsx" : la création
 * d'entreprises et d'utilisateurs se fait uniquement via les formulaires Admin, il n'existe pas
 * de fonctionnalité d'import Excel pour ces deux objets.
 */
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

const DEMO_DIR = path.resolve(__dirname, "..", "demo");
if (!fs.existsSync(DEMO_DIR)) fs.mkdirSync(DEMO_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// 1. arborescence_financiere_demo.xlsx — import HierarchyEditor, domain "financial"
//    Format : lib/hierarchyExcel.ts HIERARCHY_EXCEL_HEADERS = Niveau / Code / Libellé / Code parent
//    À importer APRÈS avoir configuré 2 niveaux financiers "P&L" (macro) et "Centre de coût".
// ─────────────────────────────────────────────────────────────────────────────

const HIERARCHY_HEADERS = ["Niveau", "Code", "Libellé", "Code parent"];

const FINANCIAL_ROWS = [
  ["P&L", "REV", "Revenue", ""],
  ["P&L", "COGS", "Cost of Goods Sold", ""],
  ["P&L", "SGA", "Selling & Marketing", ""],
  ["P&L", "GA", "General & Admin", ""],
  ["Centre de coût", "CC-PROC-001", "Achats directs", "COGS"],
  ["Centre de coût", "CC-OPS-001", "Production", "COGS"],
  ["Centre de coût", "CC-SGA-001", "Marketing", "SGA"],
  ["Centre de coût", "CC-SGA-002", "Ventes", "SGA"],
  ["Centre de coût", "CC-GA-001", "IT", "GA"],
  ["Centre de coût", "CC-GA-002", "RH", "GA"],
];

const finWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  finWb,
  XLSX.utils.aoa_to_sheet([HIERARCHY_HEADERS, ...FINANCIAL_ROWS]),
  "Arborescence"
);
XLSX.writeFile(finWb, path.join(DEMO_DIR, "arborescence_financiere_demo.xlsx"));

// ─────────────────────────────────────────────────────────────────────────────
// 2. arborescence_geographique_demo.xlsx — import HierarchyEditor, domain "geographic"
//    À importer APRÈS avoir configuré 2 niveaux géographiques "Continent" (macro) et "Pays".
// ─────────────────────────────────────────────────────────────────────────────

const GEOGRAPHY_ROWS = [
  ["Continent", "Europe", "Europe", ""],
  ["Continent", "Americas", "Amériques", ""],
  ["Pays", "France", "France", "Europe"],
  ["Pays", "Germany", "Allemagne", "Europe"],
  ["Pays", "Spain", "Espagne", "Europe"],
  ["Pays", "USA", "Etats-Unis", "Americas"],
];

const geoWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  geoWb,
  XLSX.utils.aoa_to_sheet([HIERARCHY_HEADERS, ...GEOGRAPHY_ROWS]),
  "Arborescence"
);
XLSX.writeFile(geoWb, path.join(DEMO_DIR, "arborescence_geographique_demo.xlsx"));

// ─────────────────────────────────────────────────────────────────────────────
// 3. leviers_demo.xlsx — import LeverImportButton (page Leviers)
//    3 feuilles Leviers / Actions / Impacts, sans onglet sous-levier (n'existe plus).
//    Compte P&L / Centre de coût / Géographie / Pays réutilisent les codes des 2 fichiers
//    d'arborescence ci-dessus pour rester cohérents si les 4 fichiers sont importés à la suite.
//    Colonne "Programme" laissée vide : un Programme inconnu est une erreur de ligne (pas
//    d'auto-création, contrairement au Workstream) — à ne remplir qu'après avoir créé le
//    Programme dans Admin > Programmes.
// ─────────────────────────────────────────────────────────────────────────────

const LEVER_HEADERS = [
  "Code",
  "Type de levier",
  "Nom du levier",
  "Workstream",
  "Programme",
  "Owner",
  "Owner (initiales)",
  "Sponsor",
  "Sponsor (initiales)",
  "Géographie",
  "Pays",
  "Entité",
  "Fonction",
  "Centre de coût",
  "Compte P&L impacté",
  "Date de départ",
  "Date de fin estimée",
  "Statut",
  "Progression (%)",
  "Impact estimé brut (€M)",
  "Impact estimé net (€M)",
  "Impact estimé (ETP)",
  "Population impactée",
  "CAPEX (€M)",
  "OPEX one-off (€M)",
  "OPEX récurrent (€M/an)",
  "Dépendances (ID:type, séparées par ;)",
  "Description",
];

// 30 leviers générés à partir de pools cycliques (déterministe, pas de Math.random, pour que le
// diff reste stable d'une régénération à l'autre). Chaque pool reste cohérent en interne
// (workstream <-> type <-> fonction, géographie <-> pays <-> entité, compte P&L <-> centre de
// coût parent — voir FINANCIAL_ROWS/GEOGRAPHY_ROWS plus haut).
const LEVER_WORKSTREAMS = [
  "Achats & Supply Chain",
  "Excellence Opérationnelle",
  "Digital & IT",
  "Marketing & Ventes",
  "Finance & Contrôle de gestion",
  "RH & Organisation",
];
const LEVER_PROFILES = [
  {
    ws: "Achats & Supply Chain",
    type: "Sourcing & Achats",
    fn: "Procurement",
    pnl: "COGS",
    cc: "CC-PROC-001",
  },
  {
    ws: "Excellence Opérationnelle",
    type: "Excellence Opérationnelle",
    fn: "Operations",
    pnl: "COGS",
    cc: "CC-OPS-001",
  },
  {
    ws: "Digital & IT",
    type: "Digitalisation & Automatisation",
    fn: "IT",
    pnl: "GA",
    cc: "CC-GA-001",
  },
  {
    ws: "Marketing & Ventes",
    type: "Pricing & Revenue Management",
    fn: "Sales",
    pnl: "REV",
    cc: "CC-SGA-002",
  },
  {
    ws: "Marketing & Ventes",
    type: "Réorganisation & Effectifs",
    fn: "Marketing",
    pnl: "SGA",
    cc: "CC-SGA-001",
  },
  {
    ws: "Achats & Supply Chain",
    type: "Supply Chain & Logistique",
    fn: "Supply Chain",
    pnl: "COGS",
    cc: "CC-OPS-001",
  },
  {
    ws: "Finance & Contrôle de gestion",
    type: "Digitalisation & Automatisation",
    fn: "Finance",
    pnl: "GA",
    cc: "CC-GA-002",
  },
  {
    ws: "RH & Organisation",
    type: "Réorganisation & Effectifs",
    fn: "HR",
    pnl: "GA",
    cc: "CC-GA-002",
  },
];
const LEVER_GEOS = [
  { geo: "Europe", country: "France", entity: "Acme France SAS" },
  { geo: "Europe", country: "Germany", entity: "Acme Deutschland GmbH" },
  { geo: "Europe", country: "Spain", entity: "Acme Iberia SL" },
  { geo: "Americas", country: "USA", entity: "Acme USA Inc." },
];
const LEVER_PEOPLE = [
  ["Isabelle Roy", "IR"],
  ["Thomas Petit", "TP"],
  ["Claire Fontaine", "CF"],
  ["Nadia Klein", "NK"],
  ["Elena Ruiz", "ER"],
  ["Ryan Cole", "RC"],
  ["Marc Dubois", "MD"],
  ["Léa Moreau", "LM"],
  ["Julien Blanc", "JB"],
  ["Sofia Alvarez", "SA"],
  ["Henrik Dahl", "HD"],
  ["Camille Vasseur", "CV"],
];
const LEVER_SPONSORS = [
  ["CEO Office", "CEO"],
  ["Directeur Industriel", "DI"],
  ["CFO", "CFO"],
  ["CMO", "CMO"],
  ["Directeur Commercial", "DC"],
  ["Directrice RH", "DRH"],
];
// Libellés RÉELLEMENT affichés sur la plateforme pour le cycle de vie par défaut
// (DEFAULT_LIFECYCLE_STAGES dans lib/status-config.ts, résolus via resolveStatusLabel/
// useLifecycleLabels — Kanban, dropdown de statut du formulaire, stepper du détail levier) plutôt
// que les anciens libellés longs "Excel" (STATUS_LABEL) : sans ça, une démo qui importe ce fichier
// puis affiche les leviers montre un texte différent de celui tapé dans Excel, ce qui est
// justement le bug rapporté par le PO. lib/leverExcelImport.ts accepte de toute façon les deux
// formes (courte affichée + longue historique) à l'import, donc ce choix ne casse rien côté
// validation — seule la cohérence Excel <-> écran change.
const LEVER_STATUS_LABELS = ["Identifié", "Validé", "Planifié", "Exécuté", "Réalisé"];
const LEVER_NAME_TEMPLATES = [
  "Regroupement fournisseurs {n}",
  "Réduction temps d'arrêt {n}",
  "Automatisation back-office {n}",
  "Fusion équipes {n}",
  "Revue tarifaire {n}",
  "Optimisation réseau {n}",
  "Programme qualité {n}",
  "Renégociation baux {n}",
  "Centralisation achats indirects {n}",
  "Digitalisation reporting {n}",
  "Rationalisation gamme {n}",
  "Mutualisation flotte {n}",
  "Automatisation support client {n}",
  "Optimisation stocks {n}",
  "Réorganisation service client {n}",
];
const LEVER_NAME_SUFFIXES = [
  "Europe",
  "France",
  "Allemagne",
  "Espagne",
  "US",
  "EMEA",
  "Nord",
  "Sud",
  "Groupe",
  "Retail",
];

// Utilitaires déterministes partagés par la génération Leviers/Actions/Impacts ci-dessous — même
// convention que lib/mockActionMigration.ts (midpoint/round2/netSavings = savings − opexRec), pour
// que chaque levier généré reconcilie EXACTEMENT (capex/opexOneOff/opexRec/netSavings/fteImpact)
// avec la somme de ses propres lignes Actions/Impacts, au lieu de laisser le levier "planifié"
// diverger silencieusement de son détail (bug d'origine : seuls 3 des 30 leviers avaient des
// lignes Actions/Impacts, et aucune ne matchait les totaux du levier).
const round2 = (value) => Math.round(value * 100) / 100;
function midDate(startISO, endISO, ratio) {
  const a = new Date(startISO).getTime();
  const b = new Date(endISO).getTime();
  return new Date(a + (b - a) * ratio).toISOString().slice(0, 10);
}
function actionStatusFor(progress, phase) {
  if (progress >= 100) return "Terminé";
  if (phase === 1) {
    if (progress >= 30) return "Terminé";
    if (progress > 0) return "En cours";
    return "À faire";
  }
  if (progress >= 70) return "Terminé";
  if (progress >= 30) return "En cours";
  return "À faire";
}

const LEVER_COUNT = 30;
const LEVER_ROWS = [];
const ACTION_ROWS = [];
const IMPACT_ROWS = [];
// Métadonnées par levier réutilisées par la génération des mouvements RH plus bas (pour construire
// des mouvements qui convergent vers le fteImpact de CHAQUE levier plutôt que d'être générés
// indépendamment — voir la section Mouvements).
const LEVER_META = [];
for (let i = 0; i < LEVER_COUNT; i++) {
  const code = `AC-${String(i + 1).padStart(3, "0")}`;
  const profile = LEVER_PROFILES[i % LEVER_PROFILES.length];
  const geo = LEVER_GEOS[i % LEVER_GEOS.length];
  const [owner, ownerInit] = LEVER_PEOPLE[i % LEVER_PEOPLE.length];
  const [sponsor, sponsorInit] = LEVER_SPONSORS[i % LEVER_SPONSORS.length];
  const status = LEVER_STATUS_LABELS[i % LEVER_STATUS_LABELS.length];
  const name = LEVER_NAME_TEMPLATES[i % LEVER_NAME_TEMPLATES.length].replace(
    "{n}",
    LEVER_NAME_SUFFIXES[i % LEVER_NAME_SUFFIXES.length]
  );
  const progress =
    status === "Exécuté"
      ? 25 + (i % 6) * 10
      : status === "Réalisé"
        ? 100
        : status === "Planifié"
          ? 5 + (i % 3) * 5
          : 0;
  const netSavings = Math.round((0.6 + (i % 9) * 0.45) * 100) / 100;
  const grossSavings = Math.round(netSavings * 1.12 * 100) / 100;
  const capex = Math.round(netSavings * 0.12 * 100) / 100;
  const opexOneOff = Math.round(netSavings * 0.08 * 100) / 100;
  const opexRec = Math.round(netSavings * 0.02 * 100) / 100;
  const fteImpact = i % 4 === 0 ? 0 : -(2 + (i % 5));
  const popImpacted = Math.abs(fteImpact) * (6 + (i % 4));
  // Les dates sont choisies en fonction du STATUT pour rester cohérentes avec "aujourd'hui"
  // (DEMO_TODAY, ~2026-09-17) : un levier "Réalisé" doit avoir terminé ses actions AVANT
  // aujourd'hui (sinon le calcul de "Réalisé à date", basé sur les dates de livraison réelles —
  // voir lib/leverConsolidate.ts::leverJCurve — affiche €0K malgré un statut à 100%, ce qui a été
  // repéré comme une incohérence lors de l'audit). Un levier "Identifié"/"Planifié" doit au
  // contraire démarrer après aujourd'hui (rien n'a encore pu être livré). "Exécuté" chevauche
  // aujourd'hui (en cours). Toujours déterministe (i % N), pas de Math.random().
  let startMonth, durationMonths;
  if (status === "Réalisé") {
    // Termine strictement avant DEMO_TODAY (mois 1 à 8 = janvier à août 2026).
    durationMonths = 2 + (i % 4); // 2 à 5 mois
    const endMonth = 3 + (i % 6); // fin en mars..août 2026
    startMonth = Math.max(1, endMonth - durationMonths);
  } else if (status === "Exécuté") {
    // Chevauche DEMO_TODAY : commence avant, finit après.
    startMonth = 1 + (i % 8); // janvier à août 2026
    durationMonths = 7 + (i % 6); // finit entre avril 2027 et fin d'année, toujours après septembre 2026
  } else if (status === "Planifié") {
    // Démarre juste après DEMO_TODAY : quasiment rien n'a pu être livré.
    startMonth = 9 + (i % 3); // septembre à novembre 2026
    durationMonths = 5 + (i % 6);
  } else {
    // "Identifié" (et statuts par défaut) : entièrement dans le futur.
    startMonth = 11 + (i % 3); // novembre 2026 à janvier 2027
    durationMonths = 5 + (i % 6);
  }
  const endMonthRaw = startMonth + durationMonths;
  const startYear = startMonth > 12 ? 2027 : 2026;
  const startMonthNorm = ((startMonth - 1) % 12) + 1;
  const startDate = `${startYear}-${String(startMonthNorm).padStart(2, "0")}-01`;
  const endYear = startYear + (endMonthRaw > 12 ? 1 : 0);
  const endMonth = ((endMonthRaw - 1) % 12) + 1;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-28`;

  // Dépendances : résolues par Code contre les leviers déjà upsertés PLUS TÔT dans le fichier
  // (voir leversLogic.bulkUpsertLeversByCode) — donc uniquement des indices < i. But d'une
  // toile dense : environ 2 leviers sur 3 dépendent d'un prédécesseur immédiat, et un sur quatre
  // a une seconde dépendance vers un levier plus ancien, pour croiser plusieurs chaînes.
  const depTypes = ["FS", "SS", "FF", "SF"];
  const deps = [];
  if (i >= 1 && i % 3 !== 0) {
    const targetIdx = i - 1 - (i % 2);
    if (targetIdx >= 0)
      deps.push(`AC-${String(targetIdx + 1).padStart(3, "0")}:${depTypes[i % 4]}`);
  }
  if (i >= 5 && i % 4 === 0) {
    const targetIdx = i - 5;
    deps.push(`AC-${String(targetIdx + 1).padStart(3, "0")}:${depTypes[(i + 2) % 4]}`);
  }

  LEVER_ROWS.push([
    code,
    profile.type,
    name,
    profile.ws,
    "",
    owner,
    ownerInit,
    sponsor,
    sponsorInit,
    geo.geo,
    geo.country,
    geo.entity,
    profile.fn,
    profile.cc,
    profile.pnl,
    startDate,
    endDate,
    status,
    progress,
    grossSavings,
    netSavings,
    fteImpact,
    popImpacted,
    capex,
    opexOneOff,
    opexRec,
    deps.join(";"),
    `Levier de démo généré (${profile.type.toLowerCase()}, ${geo.country}).`,
  ]);

  // ── Actions + Impacts du levier — construits DIRECTEMENT à partir des mêmes champs que la
  //    ligne Leviers ci-dessus (capex/opexOneOff/opexRec/netSavings/fteImpact), pour que la somme
  //    des lignes Impacts reconcilie EXACTEMENT avec le levier, comme le fait
  //    lib/mockActionMigration.ts (buildSimpleActions/financialImpacts) pour le seed Acme. Chaque
  //    levier a 2 actions : (1) cadrage/déploiement portant CAPEX + OPEX one-off, (2) réalisation
  //    des gains portant OPEX récurrent + le gain net (et l'ETP, jamais posé sur une ligne Gain
  //    quand il s'agit d'une augmentation d'effectif — ici toujours négatif ou nul, cf. fteImpact
  //    ci-dessus, donc toujours la contrepartie RH directe du gain).
  const action1Name = `${name} — Cadrage & déploiement`;
  const action1End = midDate(startDate, endDate, 0.45);
  const action2Name = `${name} — Réalisation des gains`;
  const action2Start = midDate(startDate, endDate, 0.5);
  const action2End = endDate;
  const action1Status = actionStatusFor(progress, 1);
  const action2Status = actionStatusFor(progress, 2);

  ACTION_ROWS.push([code, action1Name, owner, startDate, action1End, action1Status]);
  ACTION_ROWS.push([code, action2Name, owner, action2Start, action2End, action2Status]);

  if (capex > 0) {
    IMPACT_ROWS.push([
      code,
      action1Name,
      "Coût",
      "CAPEX",
      capex,
      "",
      "",
      action1End,
      "",
      "",
      "",
      profile.cc,
      profile.pnl,
      "",
    ]);
  }
  if (opexOneOff > 0) {
    IMPACT_ROWS.push([
      code,
      action1Name,
      "Coût",
      "One-off",
      opexOneOff,
      "",
      "",
      "",
      "",
      "",
      "",
      profile.cc,
      profile.pnl,
      "",
    ]);
  }
  if (opexRec > 0) {
    IMPACT_ROWS.push([
      code,
      action2Name,
      "Coût",
      "OPEX récurrent",
      opexRec,
      "",
      "",
      "",
      "",
      "",
      "",
      profile.cc,
      profile.pnl,
      "",
    ]);
  }
  // netSavings = savings − opexRec (même convention que lib/leverConsolidate.ts) : la ligne de
  // gain porte le montant BRUT (netSavings + opexRec), la ligne OPEX récurrent ci-dessus déduisant
  // le reste — reconstituant exactement `netSavings` une fois consolidé côté import.
  const grossValue = round2(netSavings + opexRec);
  if (grossValue > 0) {
    const savingTypeLabel = profile.pnl === "REV" ? "Augmentation du CA" : "Réduction de coût";
    IMPACT_ROWS.push([
      code,
      action2Name,
      "Gain",
      "OPEX récurrent",
      grossValue,
      fteImpact !== 0 ? fteImpact : "",
      savingTypeLabel,
      "",
      action2End,
      "",
      "",
      profile.cc,
      profile.pnl,
      "",
    ]);
  }

  LEVER_META.push({ code, fteImpact, status, progress });
}

const ACTION_HEADERS = [
  "Code Levier",
  "Nom de l'action",
  "Owner",
  "Date début",
  "Date fin",
  "Statut",
];

// ACTION_ROWS est désormais généré ci-dessus, DANS la boucle des leviers (une action "Cadrage &
// déploiement" + une action "Réalisation des gains" par levier), pour que les 30 leviers aient
// tous un plan d'action au lieu des 3 leviers historiquement couverts.

const IMPACT_HEADERS = [
  "Code Levier",
  "Nom de l'action",
  "Type",
  "Nature",
  "Montant (€M)",
  "ETP",
  "Type de gain",
  "Date CAPEX",
  "Date gain",
  "Reconnaissance",
  "Poste de coût",
  "Centre de coût",
  "Entité P&L",
  "Commentaire",
];

// IMPACT_ROWS est désormais généré ci-dessus, DANS la boucle des leviers, directement à partir des
// champs capex/opexOneOff/opexRec/netSavings/fteImpact de CHAQUE levier (voir financialImpacts()
// côté lib/mockActionMigration.ts pour la même convention) — la somme des lignes Impacts d'un
// levier reconcilie donc exactement avec sa propre ligne Leviers, pour les 30 leviers.

const leverWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  leverWb,
  XLSX.utils.aoa_to_sheet([LEVER_HEADERS, ...LEVER_ROWS]),
  "Leviers"
);
XLSX.utils.book_append_sheet(
  leverWb,
  XLSX.utils.aoa_to_sheet([ACTION_HEADERS, ...ACTION_ROWS]),
  "Actions"
);
XLSX.utils.book_append_sheet(
  leverWb,
  XLSX.utils.aoa_to_sheet([IMPACT_HEADERS, ...IMPACT_ROWS]),
  "Impacts"
);
XLSX.writeFile(leverWb, path.join(DEMO_DIR, "leviers_demo.xlsx"));

// ─────────────────────────────────────────────────────────────────────────────
// 4. base_etp_demo.xlsx — import HrExcelButtons (Dashboard RH > Base ETP)
//    2 feuilles Base ETP / Mouvements. Les mouvements référencent les codes leviers ci-dessus
//    (AC-001 à AC-030) pour que l'impact RH remonte correctement sur les leviers importés.
// ─────────────────────────────────────────────────────────────────────────────

const EMPLOYEE_HEADERS = [
  "Matricule",
  "Nom",
  "Département",
  "Direction",
  "RH local",
  "Région",
  "Pays",
  "Fonction",
  "Équipe",
  "BU",
  "Entité",
  "Niveau",
  "ETP",
  "Salaire brut annuel (€)",
  "Date d'entrée",
  "Départ retraite",
];

// 100 employés générés à partir de pools cycliques croisés (prénom x nom x département), avec
// dates d'entrée/salaires variés mais déterministes — même logique que les leviers ci-dessus.
const EMP_FIRST_NAMES = [
  "Emma",
  "Louis",
  "Camille",
  "Antoine",
  "Julie",
  "Hans",
  "Léa",
  "Paul",
  "Sofia",
  "Mateo",
  "Ryan",
  "Sarah",
  "Nadia",
  "Marc",
  "Elena",
  "Thomas",
  "Claire",
  "Julien",
  "Henrik",
  "Ines",
];
const EMP_LAST_NAMES = [
  "Lambert",
  "Garnier",
  "Petit",
  "Roy",
  "Moreau",
  "Klein",
  "Fontaine",
  "Weber",
  "Ruiz",
  "Diaz",
  "Cole",
  "Bennett",
  "Girard",
  "Bernard",
  "Alvarez",
  "Dahl",
  "Vasseur",
  "Blanc",
  "Nystrom",
  "Keller",
];
const EMP_DEPTS = [
  {
    dept: "Achats",
    dir: "Supply Chain",
    fn: "Procurement",
    team: "Achats directs",
    hrOwner: "Sophie Dubois",
  },
  {
    dept: "Production",
    dir: "Opérations",
    fn: "Operations",
    team: "Ligne de production",
    hrOwner: "Sophie Dubois",
  },
  {
    dept: "Marketing",
    dir: "Commercial",
    fn: "Marketing",
    team: "Marketing Central",
    hrOwner: "Claire Moreau",
  },
  {
    dept: "Finance",
    dir: "Finance",
    fn: "Finance",
    team: "Comptabilité",
    hrOwner: "Claire Moreau",
  },
  {
    dept: "Ventes",
    dir: "Commercial",
    fn: "Sales",
    team: "Ventes terrain",
    hrOwner: "Sophie Dubois",
  },
  {
    dept: "Logistique",
    dir: "Supply Chain",
    fn: "Supply Chain",
    team: "Entrepôts",
    hrOwner: "Sophie Dubois",
  },
  { dept: "IT", dir: "IT", fn: "IT", team: "Support SI", hrOwner: "Claire Moreau" },
  { dept: "RH", dir: "RH", fn: "HR", team: "RH Généraliste", hrOwner: "Claire Moreau" },
];
const EMP_GEOS = [
  { region: "Europe", country: "France", bu: "Acme France", entity: "Acme France SAS" },
  { region: "Europe", country: "Germany", bu: "Acme Deutschland", entity: "Acme Deutschland GmbH" },
  { region: "Europe", country: "Spain", bu: "Acme Iberia", entity: "Acme Iberia SL" },
  { region: "Americas", country: "USA", bu: "Acme USA", entity: "Acme USA Inc." },
];
const EMP_LEVELS = ["Local", "Local", "Local", "Régional", "Global"];

const EMPLOYEE_COUNT = 100;
const EMPLOYEE_ROWS = [];
for (let i = 0; i < EMPLOYEE_COUNT; i++) {
  const matricule = `M${String(i + 1).padStart(3, "0")}`;
  const firstName = EMP_FIRST_NAMES[i % EMP_FIRST_NAMES.length];
  const lastName =
    EMP_LAST_NAMES[(i + Math.floor(i / EMP_FIRST_NAMES.length)) % EMP_LAST_NAMES.length];
  const d = EMP_DEPTS[i % EMP_DEPTS.length];
  const g = EMP_GEOS[i % EMP_GEOS.length];
  const level = EMP_LEVELS[i % EMP_LEVELS.length];
  const salary = 38000 + ((i * 733) % 42000);
  const hireYear = 2012 + (i % 13);
  const hireMonth = 1 + (i % 12);
  const hireDate = `${hireYear}-${String(hireMonth).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`;
  const retireYear = hireYear + 21 + (i % 15);
  const retireDate = `${retireYear}-${String(((i + 5) % 12) + 1).padStart(2, "0")}-28`;

  EMPLOYEE_ROWS.push([
    matricule,
    `${lastName} ${firstName}`,
    d.dept,
    d.dir,
    d.hrOwner,
    g.region,
    g.country,
    d.fn,
    d.team,
    g.bu,
    g.entity,
    level,
    1,
    salary,
    hireDate,
    retireDate,
  ]);
}

const MOVEMENT_HEADERS = [
  "ID mouvement",
  "Matricule",
  "Employé / Poste",
  "Type",
  "ETP concernés",
  "Département",
  "Département d'arrivée",
  "Pays",
  "RH local",
  "Levier (code)",
  "Date planifiée",
  "Date réalisée",
  "Statut",
  "Validé RH",
  "PSE",
  "Impact masse salariale (€/an)",
  "Économies (€)",
  "Coût one-off (€)",
  "Commentaire",
];

// Mouvements construits PAR LEVIER (à partir de LEVER_META, rempli pendant la génération des 30
// leviers plus haut) plutôt qu'indépendamment : pour chaque levier dont fteImpact != 0, on génère
// 1 à 3 mouvements "Départ forcé"/"Attrition" (la seule décroissance nette de fteImpact générée par
// le pool de leviers ci-dessus — cf. `fteImpact = i % 4 === 0 ? 0 : -(2 + (i % 5))`) dont la somme
// des ETP reconstitue EXACTEMENT le fteImpact du levier (signe hrEngine.fteEffect : Attrition/
// Départ forcé = -fte, Transfert = 0 — voir lib/hrEngine.ts). Un levier à fteImpact=0 reçoit un
// mouvement de transfert neutre (net 0), pour rester référencé sans fausser le total. Avant ce
// correctif, les mouvements étaient générés indépendamment des leviers (cycle `(i*3) % 30`) et
// pouvaient s'écarter du fteImpact du levier d'un facteur 4-9x, sans lien de cohérence.
//
// Types et statuts DOIVENT rester ceux de la typologie courante (MOVEMENT_TYPES /
// MOVEMENT_STATUSES dans lib/hrExcel.ts) : l'ancienne typologie 4-types
// (Suppression / Redéploiement / Reconversion) et le statut "En cours" restent acceptés à
// l'import par rétrocompatibilité, mais chaque ligne concernée déclenche un avertissement de
// conversion — un fichier de démo doit s'importer sans le moindre avertissement (verrouillé par
// lib/__tests__/demoSetupFlow.test.ts).
const MOVEMENT_STATUS_POOL = ["Planifié", "À faire", "Réalisé"];
const MOVEMENT_ROWS = [];
let movementSeq = 0;
let empCursor = 0;
const nextEmployee = () => {
  const empRow = EMPLOYEE_ROWS[empCursor % EMPLOYEE_COUNT];
  empCursor += 1;
  return empRow;
};
const pushMovement = ({ type, fte, leverCode, statusSeed, dateSeed, empRow, commentSuffix }) => {
  movementSeq += 1;
  const status = MOVEMENT_STATUS_POOL[statusSeed % MOVEMENT_STATUS_POOL.length];
  const plannedMonth = 1 + (dateSeed % 12);
  const plannedDate = `2026-${String(plannedMonth).padStart(2, "0")}-15`;
  const actualDate = status === "Réalisé" ? plannedDate : "";
  const baseSalary = empRow[13];
  const salaryImpact =
    type === "Transfert entrant" || type === "Transfert sortant" ? 0 : -baseSalary;
  const savings = type === "Transfert entrant" || type === "Transfert sortant" ? 0 : baseSalary;
  const cost = 2000 + (dateSeed % 6) * 1500;

  MOVEMENT_ROWS.push([
    `MV-${String(movementSeq).padStart(3, "0")}`,
    empRow[0],
    empRow[1],
    type,
    fte,
    empRow[2],
    type === "Transfert entrant" ? EMP_DEPTS[(dateSeed + 1) % EMP_DEPTS.length].dept : "",
    empRow[6],
    empRow[4],
    leverCode,
    plannedDate,
    actualDate,
    status,
    status === "Réalisé" ? "Oui" : "Non",
    dateSeed % 5 === 0 ? "Oui" : "Non",
    salaryImpact,
    savings,
    cost,
    `Mouvement de démo généré (${type.toLowerCase()}, lié à ${leverCode}${commentSuffix}).`,
  ]);
};

LEVER_META.forEach((lv, i) => {
  const target = lv.fteImpact;
  if (target === 0) {
    // Levier sans impact ETP planifié : un transfert neutre (effet 0) le garde référencé par au
    // moins un mouvement sans fausser aucun total.
    const type = i % 2 === 0 ? "Transfert entrant" : "Transfert sortant";
    pushMovement({
      type,
      fte: 1,
      leverCode: lv.code,
      statusSeed: i,
      dateSeed: i,
      empRow: nextEmployee(),
      commentSuffix: ", sans impact ETP net",
    });
    return;
  }

  // Répartit |fteImpact| en 1 à 3 mouvements entiers ≥ 1 (jamais plus de mouvements que d'ETP à
  // couvrir), dont la somme reconstitue exactement |fteImpact|.
  const magnitude = Math.abs(target);
  const movementCount = Math.max(1, Math.min(3, magnitude, 1 + (i % 3)));
  const base = Math.floor(magnitude / movementCount);
  const remainder = magnitude - base * movementCount;

  for (let k = 0; k < movementCount; k++) {
    const fte = base + (k < remainder ? 1 : 0);
    if (fte <= 0) continue;
    const type = k % 2 === 0 ? "Départ forcé" : "Attrition";
    pushMovement({
      type,
      fte,
      leverCode: lv.code,
      statusSeed: i + k,
      dateSeed: i + k * 2,
      empRow: nextEmployee(),
      commentSuffix: `, -${fte} ETP`,
    });
  }
});

const hrWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  hrWb,
  XLSX.utils.aoa_to_sheet([EMPLOYEE_HEADERS, ...EMPLOYEE_ROWS]),
  "Base ETP"
);
XLSX.utils.book_append_sheet(
  hrWb,
  XLSX.utils.aoa_to_sheet([MOVEMENT_HEADERS, ...MOVEMENT_ROWS]),
  "Mouvements"
);
XLSX.writeFile(hrWb, path.join(DEMO_DIR, "base_etp_demo.xlsx"));

console.log("Fichiers de démo générés dans demo/ :");
console.log(" - arborescence_financiere_demo.xlsx");
console.log(" - arborescence_geographique_demo.xlsx");
console.log(" - leviers_demo.xlsx");
console.log(" - base_etp_demo.xlsx");
