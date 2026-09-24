/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Génère les 4 fichiers Excel de la démo agro-industrie ("AgroVerde International", voir
 * scripts/seed-agro-demo.js pour l'entreprise/programme/utilisateurs) :
 *   1. arborescence_financiere_agroverde.xlsx  — P&L -> Centre de coût
 *   2. arborescence_geographique_agroverde.xlsx — Continent -> Pays -> Usine
 *   3. leviers_agroverde.xlsx                   — 20 leviers, 1 à 5 actions chacun, 2-3 impacts
 *      (coût + gain) par levier répartis sur ses actions
 *   4. base_etp_agroverde.xlsx                  — Base ETP + Mouvements, cohérent avec les leviers
 *      (chaque mouvement référence un levier existant, ETP total cohérent avec Lever.fteImpact)
 *
 * En-têtes copiés littéralement depuis lib/hierarchyExcel.ts (HIERARCHY_EXCEL_HEADERS),
 * lib/leverExcelImport.ts (LEVER_IMPORT_HEADERS / ACTION_IMPORT_HEADERS / IMPACT_IMPORT_HEADERS) et
 * les EMP_HEADERS/MOV_HEADERS de components/shared/HrExcelButtons.tsx — voir le bug documenté en
 * mémoire projet (dérive silencieuse des en-têtes) : toujours ces 4 sources de vérité, jamais
 * retapés de tête. "Compte P&L impacté"/"Poste de coût" utilisent les codes PNL-* de l'arborescence
 * financière ci-dessous (PAS les comptes génériques COGS/SGA/GA) : dès qu'une entreprise a une
 * arborescence financière configurée, lib/hierarchyLogic.ts::derivePnlAccounts remplace la liste
 * générique par les comptes réels de l'arborescence — voir le bug corrigé le 2026-09-18.
 *
 * Statut des leviers (audit 2026-09-24, B3) : l'import refuse de créer un levier au-delà du stade
 * « Identifié » (les stades suivants passent par les portes de validation, voir
 * lib/leverExcelImport.ts::importStatusTransitionError). Le fichier leviers_agroverde.xlsx écrit donc
 * TOUS les leviers au stade « Identifié » (sauf les leviers abandonnés, « Levier abandonné »,
 * autorisé à la création), avec des actions cohérentes (« À faire »), pour s'importer sans erreur sur
 * une entreprise vide. La maturité cible de chaque levier (`status` dans LEVER_DEFS) reste utilisée
 * pour la base ETP et se déroule ensuite dans l'app via les demandes de validation.
 *
 * Usage : node scripts/generate-agro-demo-excel.js [dossier de sortie]
 */
const path = require("path");
const XLSX = require("xlsx");

const OUT_DIR = process.argv[2] || path.resolve(__dirname, "..", "scratch-demo");
require("fs").mkdirSync(OUT_DIR, { recursive: true });

function writeWorkbook(fileName, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  const filePath = path.join(OUT_DIR, fileName);
  XLSX.writeFile(wb, filePath);
  console.log(`  - ${filePath}`);
}

// ==================== 1. Arborescence financière ====================
const FINANCIAL_HEADERS = ["Niveau", "Code", "Libellé", "Code parent"];
const financialRows = [
  FINANCIAL_HEADERS,
  // P&L (niveau macro)
  ["P&L", "PNL-ACH", "Achats & Matières premières", ""],
  ["P&L", "PNL-PROD", "Production & Industriel", ""],
  ["P&L", "PNL-LOG", "Logistique & Distribution", ""],
  ["P&L", "PNL-COM", "Commercial & Marketing", ""],
  ["P&L", "PNL-GA", "Frais généraux (G&A)", ""],
  ["P&L", "PNL-RD", "R&D & Qualité", ""],
  // Centre de coût (maille fine)
  ["Centre de coût", "CC-ACH-001", "Achats céréales & oléagineux", "PNL-ACH"],
  ["Centre de coût", "CC-ACH-002", "Achats emballages", "PNL-ACH"],
  ["Centre de coût", "CC-PROD-001", "Lignes de conditionnement", "PNL-PROD"],
  ["Centre de coût", "CC-PROD-002", "Énergie & utilities usines", "PNL-PROD"],
  ["Centre de coût", "CC-LOG-001", "Transport & entreposage", "PNL-LOG"],
  ["Centre de coût", "CC-COM-001", "Force de vente", "PNL-COM"],
  ["Centre de coût", "CC-COM-002", "Marketing & Trade", "PNL-COM"],
  ["Centre de coût", "CC-GA-001", "Fonctions support", "PNL-GA"],
  ["Centre de coût", "CC-RD-001", "R&D produits", "PNL-RD"],
  ["Centre de coût", "CC-QUA-001", "Qualité & certification", "PNL-RD"],
];

// ==================== 2. Arborescence géographique ====================
const geoRows = [
  FINANCIAL_HEADERS, // mêmes 4 colonnes (Niveau/Code/Libellé/Code parent)
  ["Continent", "EU", "Europe", ""],
  ["Continent", "AF", "Afrique", ""],
  ["Pays", "FR", "France", "EU"],
  ["Pays", "ES", "Espagne", "EU"],
  ["Pays", "CI", "Côte d'Ivoire", "AF"],
  ["Pays", "MA", "Maroc", "AF"],
  ["Usine", "USN-NANTES", "Usine de Nantes", "FR"],
  ["Usine", "USN-ROUEN", "Usine de Rouen", "FR"],
  ["Usine", "USN-SEVILLE", "Usine de Séville", "ES"],
  ["Usine", "USN-ABIDJAN", "Usine d'Abidjan", "CI"],
  ["Usine", "USN-SANPEDRO", "Usine de San-Pédro", "CI"],
  ["Usine", "USN-CASA", "Usine de Casablanca", "MA"],
];

// ==================== 3. Leviers (20, 1-5 actions, 2-3 impacts chacun) ====================
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
const ACTION_HEADERS = [
  "Code Levier",
  "Nom de l'action",
  "Owner",
  "Date début",
  "Date fin",
  "Statut",
];
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
  "Poste de coût",
  "Centre de coût",
  "Entité P&L",
  "Commentaire",
];

const PROGRAMME = "Programme Performance 2026";
const SPONSOR = "Youssef Benali";
const SPONSOR_INIT = "YB";

// Chaque centre de coût est déclaré sous un seul compte P&L dans l'arborescence ci-dessus — on
// dérive "Compte P&L impacté" à partir du "Centre de coût" du levier plutôt que de le retaper à
// la main sur chacune des 20 lignes (source unique de vérité, jamais de divergence possible).
const COST_CENTER_TO_PNL = {
  "CC-ACH-001": "PNL-ACH",
  "CC-ACH-002": "PNL-ACH",
  "CC-PROD-001": "PNL-PROD",
  "CC-PROD-002": "PNL-PROD",
  "CC-LOG-001": "PNL-LOG",
  "CC-COM-001": "PNL-COM",
  "CC-COM-002": "PNL-COM",
  "CC-GA-001": "PNL-GA",
};

const OWNERS = {
  ML: { name: "Marc Lefèvre", init: "ML", country: "France", entity: "AgroVerde France SAS" },
  YE: { name: "Yasmine El Amrani", init: "YE", country: "Maroc", entity: "AgroVerde Maroc SARL" },
  FD: {
    name: "Fatou Diarra",
    init: "FD",
    country: "Côte d'Ivoire",
    entity: "AgroVerde Côte d'Ivoire SA",
  },
  JM: { name: "Julien Meyer", init: "JM", country: "Espagne", entity: "AgroVerde España SL" },
  NC: { name: "Nadia Cherif", init: "NC", country: "France", entity: "AgroVerde France SAS" },
  KB: {
    name: "Karim Belhadj",
    init: "KB",
    country: "Côte d'Ivoire",
    entity: "AgroVerde Côte d'Ivoire SA",
  },
  SR: { name: "Sophie Rousseau", init: "SR", country: "France", entity: "AgroVerde France SAS" },
  AT: { name: "Amadou Traoré", init: "AT", country: "Maroc", entity: "AgroVerde Maroc SARL" },
};

const PHASE_LABELS = [
  "Cadrage & diagnostic",
  "Négociation / conception",
  "Déploiement pilote",
  "Généralisation",
  "Clôture & bilan",
];

const WS_NAME = {
  "WS-ACH": "Achats & Approvisionnement",
  "WS-PROD": "Production & Industriel",
  "WS-LOG": "Supply Chain & Logistique",
  "WS-COM": "Commercial & Marketing",
  "WS-DIGIT": "Digital & IT",
  "WS-RH": "RH & Support",
};

// Définition des 20 leviers — la seule chose tapée à la main. Actions/impacts sont dérivés
// automatiquement de `actionCount` et des montants financiers ci-dessous.
const LEVER_DEFS = [
  {
    code: "PROC-001",
    name: "Optimisation achats céréales & oléagineux",
    type: "Sourcing & Achats",
    ws: "WS-ACH",
    owner: "ML",
    costCenter: "CC-ACH-001",
    function: "Achats",
    start: "2026-01-15",
    end: "2026-10-31",
    status: "in_progress",
    progress: 55,
    gross: 4.5,
    net: 3.8,
    capex: 0.2,
    opexOneOff: 0.3,
    opexRec: 0.1,
    fte: -2,
    actionCount: 3,
    description:
      "Renégociation des contrats fournisseurs de matières premières agricoles (céréales, oléagineux) et diversification du panel fournisseurs Europe/Afrique.",
  },
  {
    code: "PROC-002",
    name: "Optimisation achats emballages recyclables",
    type: "Sourcing & Achats",
    ws: "WS-ACH",
    owner: "YE",
    costCenter: "CC-ACH-002",
    function: "Achats",
    start: "2026-02-01",
    end: "2026-08-31",
    status: "validated",
    progress: 30,
    gross: 2.0,
    net: 1.7,
    capex: 0.05,
    opexOneOff: 0.1,
    opexRec: 0,
    fte: -1,
    actionCount: 1,
    description:
      "Passage à des emballages recyclables mono-matériau et massification des volumes d'achat sur 2 fournisseurs stratégiques.",
  },
  {
    code: "PROC-003",
    name: "Diversification panel fournisseurs additifs & arômes",
    type: "Sourcing & Achats",
    ws: "WS-ACH",
    owner: "ML",
    costCenter: "CC-ACH-001",
    function: "Achats",
    start: "2026-03-01",
    end: "2026-09-30",
    status: "idea",
    progress: 5,
    gross: 1.1,
    net: 0.9,
    capex: 0,
    opexOneOff: 0.05,
    opexRec: 0,
    fte: 0,
    actionCount: 2,
    description:
      "Réduction du risque fournisseur unique sur les additifs et arômes via un panel élargi à 3 fournisseurs qualifiés.",
  },
  {
    code: "PROC-004",
    name: "Renégociation contrats transport amont",
    type: "Sourcing & Achats",
    ws: "WS-ACH",
    owner: "YE",
    costCenter: "CC-ACH-002",
    function: "Achats",
    start: "2026-02-15",
    end: "2026-06-30",
    status: "qualified",
    progress: 20,
    gross: 1.4,
    net: 1.2,
    capex: 0,
    opexOneOff: 0,
    opexRec: 0,
    fte: 0,
    actionCount: 1,
    description:
      "Renégociation des contrats de transport amont (matières premières vers usines) avec les 3 transporteurs principaux.",
  },
  {
    code: "PROC-005",
    name: "Centralisation achats indirects groupe",
    type: "Sourcing & Achats",
    ws: "WS-ACH",
    owner: "ML",
    costCenter: "CC-ACH-001",
    function: "Achats",
    start: "2026-01-01",
    end: "2026-06-30",
    status: "delivered",
    progress: 100,
    gross: 2.6,
    net: 2.2,
    capex: 0.15,
    opexOneOff: 0.1,
    opexRec: 0.05,
    fte: -1,
    actionCount: 4,
    description:
      "Centralisation des achats indirects (fournitures, prestations support) au niveau groupe plutôt que par filiale.",
  },

  {
    code: "PROD-001",
    name: "Réduction des pertes & rebuts en production",
    type: "Excellence Opérationnelle",
    ws: "WS-PROD",
    owner: "FD",
    costCenter: "CC-PROD-001",
    function: "Production",
    start: "2026-01-01",
    end: "2026-11-30",
    status: "in_progress",
    progress: 60,
    gross: 3.2,
    net: 2.6,
    capex: 0.6,
    opexOneOff: 0.2,
    opexRec: 0.1,
    fte: -3,
    actionCount: 3,
    description:
      "Plan de réduction des rebuts sur les lignes de conditionnement d'Abidjan et San-Pédro (contrôle qualité renforcé, maintenance préventive).",
  },
  {
    code: "ENER-001",
    name: "Renégociation contrats énergie & utilities usines",
    type: "Sourcing & Achats",
    ws: "WS-PROD",
    owner: "JM",
    costCenter: "CC-PROD-002",
    function: "Production",
    start: "2026-03-01",
    end: "2026-12-31",
    status: "validated",
    progress: 25,
    gross: 2.8,
    net: 2.4,
    capex: 0.4,
    opexOneOff: 0.1,
    opexRec: 0,
    fte: 0,
    actionCount: 2,
    description:
      "Renégociation des contrats d'électricité et de gaz de l'usine de Séville, étude de faisabilité solaire toiture.",
  },
  {
    code: "PROD-002",
    name: "Amélioration OEE lignes de conditionnement",
    type: "Excellence Opérationnelle",
    ws: "WS-PROD",
    owner: "FD",
    costCenter: "CC-PROD-001",
    function: "Production",
    start: "2026-02-01",
    end: "2026-10-31",
    status: "in_progress",
    progress: 40,
    gross: 2.3,
    net: 1.9,
    capex: 0.3,
    opexOneOff: 0.1,
    opexRec: 0.05,
    fte: -1,
    actionCount: 2,
    description:
      "Programme d'amélioration du taux de rendement synthétique (OEE) sur les lignes de conditionnement.",
  },
  {
    code: "PROD-003",
    name: "Maintenance préventive équipements usines",
    type: "Excellence Opérationnelle",
    ws: "WS-PROD",
    owner: "JM",
    costCenter: "CC-PROD-002",
    function: "Production",
    start: "2026-04-01",
    end: "2026-12-31",
    status: "idea",
    progress: 5,
    gross: 1.0,
    net: 0.8,
    capex: 0.1,
    opexOneOff: 0,
    opexRec: 0.05,
    fte: 0,
    actionCount: 1,
    description:
      "Passage d'une maintenance corrective à une maintenance préventive planifiée sur les équipements critiques.",
  },
  {
    code: "PROD-004",
    name: "Automatisation ligne de conditionnement Abidjan",
    type: "Digitalisation & Automatisation",
    ws: "WS-PROD",
    owner: "FD",
    costCenter: "CC-PROD-001",
    function: "Production",
    start: "2026-03-15",
    end: "2027-01-31",
    status: "qualified",
    progress: 15,
    gross: 3.5,
    net: 2.9,
    capex: 1.2,
    opexOneOff: 0.2,
    opexRec: 0.1,
    fte: -4,
    actionCount: 3,
    description:
      "Automatisation de la ligne de conditionnement de l'usine d'Abidjan (robotisation palettisation).",
  },
  {
    code: "ENER-002",
    name: "Solaire toiture & autoconsommation usines",
    type: "Sourcing & Achats",
    ws: "WS-PROD",
    owner: "JM",
    costCenter: "CC-PROD-002",
    function: "Production",
    start: "2026-05-01",
    end: "2027-04-30",
    status: "idea",
    progress: 5,
    gross: 1.6,
    net: 1.3,
    capex: 0.8,
    opexOneOff: 0.1,
    opexRec: 0,
    fte: 0,
    actionCount: 1,
    description:
      "Installation de panneaux solaires en toiture pour l'autoconsommation électrique des usines européennes.",
  },

  {
    code: "LOG-001",
    name: "Optimisation transport réfrigéré & entreposage",
    type: "Supply Chain & Logistique",
    ws: "WS-LOG",
    owner: "NC",
    costCenter: "CC-LOG-001",
    function: "Supply Chain",
    start: "2026-02-15",
    end: "2026-09-30",
    status: "in_progress",
    progress: 50,
    gross: 2.5,
    net: 2.0,
    capex: 0.3,
    opexOneOff: 0.15,
    opexRec: 0.05,
    fte: -2,
    actionCount: 3,
    description:
      "Mutualisation des flux de transport réfrigéré entre Nantes et Rouen, renégociation des contrats 3PL.",
  },
  {
    code: "LOG-002",
    name: "Mutualisation des flux logistiques Europe",
    type: "Supply Chain & Logistique",
    ws: "WS-LOG",
    owner: "NC",
    costCenter: "CC-LOG-001",
    function: "Supply Chain",
    start: "2026-01-01",
    end: "2026-07-31",
    status: "delivered",
    progress: 100,
    gross: 1.8,
    net: 1.5,
    capex: 0.1,
    opexOneOff: 0.1,
    opexRec: 0,
    fte: -1,
    actionCount: 2,
    description:
      "Mutualisation des entrepôts et tournées de distribution France/Espagne sur un opérateur logistique unique.",
  },

  {
    code: "COM-001",
    name: "Optimisation force de vente & couverture terrain",
    type: "Pricing & Revenue Management",
    ws: "WS-COM",
    owner: "KB",
    costCenter: "CC-COM-001",
    function: "Commercial",
    start: "2026-04-01",
    end: "2026-12-15",
    status: "idea",
    progress: 10,
    gross: 1.6,
    net: 1.3,
    capex: 0.1,
    opexOneOff: 0.05,
    opexRec: 0.2,
    fte: 1,
    actionCount: 1,
    description:
      "Réorganisation des tournées commerciales et renforcement de la couverture des points de vente régionaux.",
  },
  {
    code: "COM-002",
    name: "Optimisation dépenses trade marketing",
    type: "Pricing & Revenue Management",
    ws: "WS-COM",
    owner: "KB",
    costCenter: "CC-COM-002",
    function: "Commercial",
    start: "2026-03-01",
    end: "2026-10-31",
    status: "in_progress",
    progress: 45,
    gross: 1.2,
    net: 1.0,
    capex: 0,
    opexOneOff: 0.05,
    opexRec: 0,
    fte: 0,
    actionCount: 2,
    description:
      "Revue de l'efficacité des dépenses de trade marketing (ILV, promotions) par enseigne.",
  },
  {
    code: "COM-003",
    name: "Revue politique tarifaire circuits modernes",
    type: "Pricing & Revenue Management",
    ws: "WS-COM",
    owner: "KB",
    costCenter: "CC-COM-001",
    function: "Commercial",
    start: "2026-02-01",
    end: "2026-05-31",
    status: "cancelled",
    progress: 10,
    gross: 0.8,
    net: 0.6,
    capex: 0,
    opexOneOff: 0,
    opexRec: 0,
    fte: 0,
    actionCount: 1,
    country: "Maroc",
    entity: "AgroVerde Maroc SARL",
    geography: "Afrique",
    description:
      "Revue de la politique tarifaire sur les circuits modernes — abandonnée après retour négatif du COMEX local.",
  },

  {
    code: "DIGIT-001",
    name: "Digitalisation supply chain & prévision de la demande",
    type: "Digitalisation & Automatisation",
    ws: "WS-DIGIT",
    owner: "SR",
    costCenter: "CC-GA-001",
    function: "IT",
    start: "2026-01-01",
    end: "2026-07-31",
    status: "delivered",
    progress: 100,
    gross: 1.8,
    net: 1.5,
    capex: 0.5,
    opexOneOff: 0.1,
    opexRec: 0.15,
    fte: -1,
    actionCount: 5,
    description:
      "Déploiement d'un outil de prévision de la demande (S&OP) connecté aux 6 usines du groupe.",
  },
  {
    code: "DIGIT-002",
    name: "Déploiement ERP unifié groupe",
    type: "Digitalisation & Automatisation",
    ws: "WS-DIGIT",
    owner: "SR",
    costCenter: "CC-GA-001",
    function: "IT",
    start: "2026-02-01",
    end: "2026-12-31",
    status: "validated",
    progress: 20,
    gross: 2.4,
    net: 2.0,
    capex: 1.0,
    opexOneOff: 0.3,
    opexRec: 0.2,
    fte: -1,
    actionCount: 3,
    description:
      "Remplacement des ERP locaux par un ERP unifié groupe (finance, achats, production).",
  },

  {
    code: "RH-001",
    name: "Mutualisation des fonctions support (finance/RH)",
    type: "Réorganisation & Effectifs",
    ws: "WS-RH",
    owner: "AT",
    costCenter: "CC-GA-001",
    function: "RH",
    start: "2026-05-01",
    end: "2026-12-31",
    status: "idea",
    progress: 15,
    gross: 1.2,
    net: 1.0,
    capex: 0,
    opexOneOff: 0.2,
    opexRec: 0,
    fte: -4,
    actionCount: 2,
    description:
      "Centralisation des fonctions finance et RH des filiales Maroc et Côte d'Ivoire sur un centre de services partagés.",
  },
  {
    code: "RH-002",
    name: "Centre de services partagés paie & RH",
    type: "Réorganisation & Effectifs",
    ws: "WS-RH",
    owner: "AT",
    costCenter: "CC-GA-001",
    function: "RH",
    start: "2026-04-01",
    end: "2027-02-28",
    status: "qualified",
    progress: 10,
    gross: 1.5,
    net: 1.2,
    capex: 0.2,
    opexOneOff: 0.1,
    opexRec: 0,
    fte: -2,
    actionCount: 1,
    description:
      "Extension du centre de services partagés à la gestion de la paie pour l'ensemble des filiales africaines.",
  },
];

const STATUS_LABEL = {
  idea: "Identifié",
  qualified: "Validé",
  validated: "Planifié",
  in_progress: "Exécuté",
  delivered: "Réalisé",
  cancelled: "Levier abandonné",
};

function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function toFr(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function spreadDates(start, end, n) {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  const step = (e - s) / n;
  const bounds = [];
  for (let i = 0; i <= n; i++) bounds.push(new Date(s + step * i).toISOString().slice(0, 10));
  return bounds; // n+1 bornes -> n intervalles [bounds[i], bounds[i+1]]
}

/** Statut d'une action selon le statut du levier et sa position (phase précoce vs tardive) — voir
 *  ACTION_STATUS_LABEL dans lib/leverExcelImport.ts pour le vocabulaire accepté. */
/** Stade écrit dans la colonne "Statut" du fichier d'import : seuls « Identifié » et « abandonné »
 *  sont acceptés pour un NOUVEAU levier (voir en-tête du fichier). */
function importStatusFor(leverStatus) {
  return leverStatus === "cancelled" ? "cancelled" : "idea";
}

function actionStatusFor(leverStatus, index, count) {
  if (leverStatus === "delivered") return "Terminé";
  if (leverStatus === "in_progress") return index < Math.ceil(count / 2) ? "Terminé" : "En cours";
  if (leverStatus === "validated") return index === 0 && count > 1 ? "En cours" : "À faire";
  if (leverStatus === "cancelled") return index === 0 ? "En retard" : "À faire";
  return "À faire"; // idea, qualified
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

const levers = [];
const leverRows = [LEVER_HEADERS];
const actionRows = [ACTION_HEADERS];
const impactRows = [IMPACT_HEADERS];

for (const def of LEVER_DEFS) {
  const owner = OWNERS[def.owner];
  const pnl = COST_CENTER_TO_PNL[def.costCenter];
  const country = def.country ?? owner.country;
  const entity = def.entity ?? owner.entity;
  const geography =
    def.geography ?? (country === "France" || country === "Espagne" ? "Europe" : "Afrique");

  levers.push({ ...def, pnl, country, entity, geography, owner });

  leverRows.push(
    LEVER_HEADERS.map((h) => {
      switch (h) {
        case "Code":
          return def.code;
        case "Type de levier":
          return def.type;
        case "Nom du levier":
          return def.name;
        case "Workstream":
          return WS_NAME[def.ws];
        case "Programme":
          return PROGRAMME;
        case "Owner":
          return owner.name;
        case "Owner (initiales)":
          return owner.init;
        case "Sponsor":
          return SPONSOR;
        case "Sponsor (initiales)":
          return SPONSOR_INIT;
        case "Géographie":
          return geography;
        case "Pays":
          return country;
        case "Entité":
          return entity;
        case "Fonction":
          return def.function;
        case "Centre de coût":
          return def.costCenter;
        case "Compte P&L impacté":
          return pnl;
        case "Date de départ":
          return def.start;
        case "Date de fin estimée":
          return def.end;
        case "Statut":
          return STATUS_LABEL[importStatusFor(def.status)];
        case "Progression (%)":
          return 0;
        case "Impact estimé brut (€M)":
          return def.gross;
        case "Impact estimé net (€M)":
          return Math.round((def.gross - def.opexRec) * 100) / 100; // net = brut − OPEX récurrent
        case "Impact estimé (ETP)":
          return def.fte;
        case "Population impactée":
          return def.fte !== 0 ? WS_NAME[def.ws] : "";
        case "CAPEX (€M)":
          return def.capex;
        case "OPEX one-off (€M)":
          return def.opexOneOff;
        case "OPEX récurrent (€M/an)":
          return def.opexRec;
        case "Dépendances (ID:type, séparées par ;)":
          return "";
        case "Description":
          return def.description;
        default:
          return "";
      }
    })
  );

  // ---- Actions : `actionCount` phases (1 à 5), dates réparties entre Date de départ/fin ----
  const n = def.actionCount;
  const bounds = spreadDates(def.start, def.end, n);
  const actionNames = [];
  for (let i = 0; i < n; i++) {
    const actionName = `${def.code} — Phase ${i + 1} : ${PHASE_LABELS[i]}`;
    actionNames.push(actionName);
    actionRows.push([
      def.code,
      actionName,
      owner.name,
      toFr(bounds[i]),
      toFr(bounds[i + 1]),
      actionStatusFor(importStatusFor(def.status), i, n),
    ]);
  }

  // ---- Impacts : 2 (1 seule action) ou 3 (2+ actions) par levier, coût + gain(s) ----
  const costAmount = def.capex > 0 ? def.capex : def.opexOneOff > 0 ? def.opexOneOff : 0.05;
  const costNature = def.capex > 0 ? "CAPEX" : def.opexOneOff > 0 ? "One-off" : "One-off";
  const costActionIndex = 0;
  const costDate = addDays(bounds[costActionIndex], 15);
  impactRows.push([
    def.code,
    actionNames[costActionIndex],
    "Coût",
    costNature,
    costAmount,
    0,
    "",
    toFr(costDate),
    "",
    pnl,
    def.costCenter,
    entity,
    "",
  ]);
  if (def.opexRec > 0) {
    impactRows.push([
      def.code,
      actionNames[costActionIndex],
      "Coût",
      "OPEX récurrent",
      def.opexRec,
      0,
      "",
      toFr(addDays(bounds[costActionIndex], 30)),
      "",
      pnl,
      def.costCenter,
      entity,
      "",
    ]);
  }

  if (n >= 2) {
    const gain1 = round1(def.gross * 0.6);
    const gain2 = round1(def.gross - gain1);
    const midActionIndex = Math.min(1, n - 1);
    const lastActionIndex = n - 1;
    impactRows.push([
      def.code,
      actionNames[midActionIndex],
      "Gain",
      "",
      gain1,
      0,
      "Réduction de coût",
      "",
      toFr(addDays(bounds[midActionIndex + 1], -10)),
      pnl,
      def.costCenter,
      entity,
      "",
    ]);
    impactRows.push([
      def.code,
      actionNames[lastActionIndex],
      "Gain",
      "",
      gain2,
      def.fte,
      def.fte >= 0 ? "Augmentation du CA" : "Réduction de coût",
      "",
      toFr(bounds[n]),
      pnl,
      def.costCenter,
      entity,
      "",
    ]);
  } else {
    impactRows.push([
      def.code,
      actionNames[0],
      "Gain",
      "",
      def.gross,
      def.fte,
      def.fte >= 0 ? "Augmentation du CA" : "Réduction de coût",
      "",
      toFr(bounds[1]),
      pnl,
      def.costCenter,
      entity,
      "",
    ]);
  }
}

console.log(
  `${levers.length} leviers, ${actionRows.length - 1} actions, ${impactRows.length - 1} impacts générés.`
);

// ==================== 4. Base ETP + Mouvements ====================
const EMP_HEADERS = [
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
const HR_LOCAL = "Aïcha Ndiaye";

const employees = [
  // Les 8 responsables de levier apparaissent aussi comme employés (comme sur l'org réelle).
  [
    "M-FR-005",
    "Marc Lefèvre",
    "Achats",
    "Direction Achats",
    HR_LOCAL,
    "Europe",
    "France",
    "Achats",
    "Achats matières premières",
    "Corporate",
    "AgroVerde France SAS",
    "Global",
    1,
    71000,
    "2016-04-01",
    "2042-04-01",
  ],
  [
    "M-MA-001",
    "Yasmine El Amrani",
    "Achats",
    "Direction Achats",
    HR_LOCAL,
    "Afrique",
    "Maroc",
    "Achats",
    "Achats emballages",
    "Usine Casablanca",
    "AgroVerde Maroc SARL",
    "Local",
    1,
    27000,
    "2019-09-01",
    "2045-09-01",
  ],
  [
    "M-CI-001",
    "Fatou Diarra",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Afrique",
    "Côte d'Ivoire",
    "Production",
    "Qualité",
    "Usine Abidjan",
    "AgroVerde Côte d'Ivoire SA",
    "Local",
    1,
    26000,
    "2018-05-01",
    "2044-05-01",
  ],
  [
    "M-ES-001",
    "Julien Meyer",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Europe",
    "Espagne",
    "Production",
    "Utilities",
    "Usine Séville",
    "AgroVerde España SL",
    "Local",
    1,
    55000,
    "2017-02-01",
    "2043-02-01",
  ],
  [
    "M-FR-002",
    "Nadia Cherif",
    "Supply Chain",
    "Direction Opérations",
    HR_LOCAL,
    "Europe",
    "France",
    "Supply Chain",
    "Logistique",
    "Supply Chain",
    "AgroVerde France SAS",
    "Régional",
    1,
    58000,
    "2019-06-15",
    "2045-06-15",
  ],
  [
    "M-CI-002",
    "Karim Belhadj",
    "Commercial",
    "Direction Commerciale",
    HR_LOCAL,
    "Afrique",
    "Côte d'Ivoire",
    "Commercial",
    "Force de vente",
    "Usine Abidjan",
    "AgroVerde Côte d'Ivoire SA",
    "Régional",
    1,
    33000,
    "2020-03-01",
    "2046-03-01",
  ],
  [
    "M-FR-003",
    "Sophie Rousseau",
    "IT",
    "Direction Digitale",
    HR_LOCAL,
    "Europe",
    "France",
    "IT",
    "Data & Digital",
    "IT",
    "AgroVerde France SAS",
    "Global",
    1,
    62000,
    "2020-01-10",
    "2046-01-10",
  ],
  [
    "M-MA-002",
    "Amadou Traoré",
    "RH",
    "Direction RH",
    HR_LOCAL,
    "Afrique",
    "Maroc",
    "RH",
    "RH Support",
    "Corporate",
    "AgroVerde Maroc SARL",
    "Régional",
    1,
    30000,
    "2017-07-01",
    "2043-07-01",
  ],

  // Effectifs additionnels, répartis sur les 6 usines + corporate, pour peupler les mouvements.
  [
    "M-FR-001",
    "Élodie Marchand",
    "Finance Groupe",
    "Direction Financière",
    HR_LOCAL,
    "Europe",
    "France",
    "Finance",
    "Contrôle de gestion",
    "Corporate",
    "AgroVerde France SAS",
    "Global",
    1,
    68000,
    "2018-03-01",
    "2044-03-01",
  ],
  [
    "M-FR-004",
    "Paul Girard",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Europe",
    "France",
    "Production",
    "Conditionnement",
    "Usine Nantes",
    "AgroVerde France SAS",
    "Local",
    1,
    34000,
    "2015-09-01",
    "2041-09-01",
  ],
  [
    "M-FR-006",
    "Camille Bertrand",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Europe",
    "France",
    "Production",
    "Conditionnement",
    "Usine Rouen",
    "AgroVerde France SAS",
    "Local",
    1,
    33000,
    "2016-11-01",
    "2042-11-01",
  ],
  [
    "M-FR-007",
    "Hugo Lambert",
    "Supply Chain",
    "Direction Opérations",
    HR_LOCAL,
    "Europe",
    "France",
    "Supply Chain",
    "Transport",
    "Usine Rouen",
    "AgroVerde France SAS",
    "Local",
    1,
    32000,
    "2019-01-15",
    "2045-01-15",
  ],
  [
    "M-FR-008",
    "Léa Fontaine",
    "IT",
    "Direction Digitale",
    HR_LOCAL,
    "Europe",
    "France",
    "IT",
    "Data & Digital",
    "IT",
    "AgroVerde France SAS",
    "Local",
    1,
    41000,
    "2021-06-01",
    "2047-06-01",
  ],
  [
    "M-ES-002",
    "Lucía Fernández",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Europe",
    "Espagne",
    "Production",
    "Conditionnement",
    "Usine Séville",
    "AgroVerde España SL",
    "Local",
    1,
    31000,
    "2019-11-01",
    "2045-11-01",
  ],
  [
    "M-ES-003",
    "Diego Torres",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Europe",
    "Espagne",
    "Production",
    "Maintenance",
    "Usine Séville",
    "AgroVerde España SL",
    "Local",
    1,
    30000,
    "2020-04-01",
    "2046-04-01",
  ],
  [
    "M-CI-003",
    "Aminata Koné",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Afrique",
    "Côte d'Ivoire",
    "Production",
    "Conditionnement",
    "Usine San-Pédro",
    "AgroVerde Côte d'Ivoire SA",
    "Local",
    1,
    22000,
    "2021-01-15",
    "2047-01-15",
  ],
  [
    "M-CI-004",
    "Ibrahim Ouattara",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Afrique",
    "Côte d'Ivoire",
    "Production",
    "Conditionnement",
    "Usine Abidjan",
    "AgroVerde Côte d'Ivoire SA",
    "Local",
    1,
    21000,
    "2020-08-01",
    "2046-08-01",
  ],
  [
    "M-CI-005",
    "Mariam Coulibaly",
    "Commercial",
    "Direction Commerciale",
    HR_LOCAL,
    "Afrique",
    "Côte d'Ivoire",
    "Commercial",
    "Force de vente",
    "Usine San-Pédro",
    "AgroVerde Côte d'Ivoire SA",
    "Local",
    1,
    24000,
    "2021-09-01",
    "2047-09-01",
  ],
  [
    "M-MA-003",
    "Rania Idrissi",
    "Production",
    "Direction Industrielle",
    HR_LOCAL,
    "Afrique",
    "Maroc",
    "Production",
    "Conditionnement",
    "Usine Casablanca",
    "AgroVerde Maroc SARL",
    "Local",
    1,
    21000,
    "2022-02-01",
    "2048-02-01",
  ],
  [
    "M-MA-004",
    "Nabil Amrani",
    "RH",
    "Direction RH",
    HR_LOCAL,
    "Afrique",
    "Maroc",
    "RH",
    "Paie",
    "Corporate",
    "AgroVerde Maroc SARL",
    "Local",
    1,
    23000,
    "2019-05-01",
    "2045-05-01",
  ],
  [
    "M-MA-005",
    "Salma Bennis",
    "Finance Groupe",
    "Direction Financière",
    HR_LOCAL,
    "Afrique",
    "Maroc",
    "Finance",
    "Comptabilité",
    "Usine Casablanca",
    "AgroVerde Maroc SARL",
    "Local",
    1,
    22000,
    "2020-10-01",
    "2046-10-01",
  ],
];
const empRows = [EMP_HEADERS, ...employees];

const MOV_HEADERS = [
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
  "Programme",
  "Owner Initiative",
  "Date planifiée",
  "Date réalisée",
  "Statut",
  "Validé RH",
  "Dispositif social",
  "PSE",
  "Impact masse salariale (€/an)",
  "Économies (€)",
  "Coût one-off (€)",
  "Commentaire",
];

/** Statut de mouvement + date réalisée cohérents avec le statut du levier qui le porte. */
function movementStatusFor(leverStatus) {
  if (leverStatus === "delivered") return { status: "Réalisé", actualDate: true };
  if (leverStatus === "in_progress") return { status: "Planifié", actualDate: false };
  if (leverStatus === "cancelled") return { status: "Abandonné", actualDate: false };
  return { status: "À faire", actualDate: false };
}

const movements = [];
function addMovement(leverCode, label, type, fte, department, country, plannedDate, opts = {}) {
  const lever = levers.find((l) => l.code === leverCode);
  const { status, actualDate } = movementStatusFor(lever.status);
  movements.push([
    "",
    opts.matricule ?? "",
    label,
    type,
    fte,
    department,
    opts.toDepartment ?? "",
    country,
    HR_LOCAL,
    leverCode,
    PROGRAMME,
    lever.owner.name,
    plannedDate,
    actualDate ? plannedDate : "",
    status,
    actualDate ? "Oui" : "Non",
    opts.socialScheme ?? "",
    opts.socialScheme ? "Oui" : "Non",
    opts.salaryImpact ?? -Math.round(Math.abs(fte) * 32000),
    opts.savings ?? Math.round(Math.abs(fte) * 32000 * 10),
    opts.cost ?? Math.round(Math.abs(fte) * 3000),
    opts.comment ?? "",
  ]);
}

// Un mouvement par levier ayant un fteImpact != 0 (2 mouvements pour les 2 leviers à -4 ETP, pour
// refléter un étalement en plusieurs vagues) — cohérent avec Lever.fteImpact du fichier leviers.
addMovement(
  "PROC-001",
  "2 postes achats — mutualisation panel fournisseurs",
  "Départ forcé",
  2,
  "Achats",
  "France",
  "2026-06-01"
);
addMovement(
  "PROC-002",
  "1 poste achats emballages — non remplacé",
  "Attrition",
  1,
  "Achats",
  "Maroc",
  "2026-05-01"
);
addMovement(
  "PROC-005",
  "1 poste achats indirects filiale — centralisé au groupe",
  "Départ forcé",
  1,
  "Achats",
  "France",
  "2026-04-01"
);
addMovement(
  "PROD-001",
  "3 opérateurs conditionnement — contrôle qualité renforcé",
  "Départ forcé",
  3,
  "Production",
  "Côte d'Ivoire",
  "2026-08-15",
  { socialScheme: "PSE", comment: "Accompagnement social en cours de cadrage" }
);
addMovement(
  "PROD-002",
  "1 opérateur ligne — amélioration OEE",
  "Attrition",
  1,
  "Production",
  "Espagne",
  "2026-07-01"
);
addMovement(
  "PROD-004",
  "2 opérateurs conditionnement — vague 1 automatisation",
  "Départ forcé",
  2,
  "Production",
  "Côte d'Ivoire",
  "2026-09-01",
  { socialScheme: "RCC" }
);
addMovement(
  "PROD-004",
  "2 opérateurs conditionnement — vague 2 automatisation",
  "Transfert sortant",
  2,
  "Production",
  "Côte d'Ivoire",
  "2026-12-01",
  { toDepartment: "Qualité", socialScheme: "RCC" }
);
addMovement(
  "LOG-001",
  "2 postes transport — mutualisation tournées Nantes-Rouen",
  "Attrition",
  2,
  "Supply Chain",
  "France",
  "2026-05-01"
);
addMovement(
  "LOG-002",
  "1 poste entreposage — mutualisation France/Espagne",
  "Attrition",
  1,
  "Supply Chain",
  "France",
  "2026-06-01",
  { matricule: "M-FR-007" }
);
addMovement(
  "COM-001",
  "1 commercial terrain — renfort couverture",
  "Recrutement",
  1,
  "Commercial",
  "Côte d'Ivoire",
  "2026-05-01"
);
addMovement(
  "DIGIT-001",
  "1 data analyst — pilotage S&OP",
  "Recrutement",
  1,
  "IT",
  "France",
  "2026-02-01",
  { matricule: "" }
);
addMovement(
  "DIGIT-001",
  "2 postes support ops remplacés par l'outil S&OP",
  "Départ forcé",
  2,
  "IT",
  "France",
  "2026-06-01"
);
addMovement(
  "DIGIT-002",
  "1 poste IT local — bascule vers ERP unifié",
  "Attrition",
  1,
  "IT",
  "France",
  "2026-09-01",
  { matricule: "M-FR-008" }
);
addMovement(
  "RH-001",
  "2 postes support finance/RH Maroc — CSP",
  "Départ forcé",
  2,
  "RH",
  "Maroc",
  "2026-11-01",
  { socialScheme: "RCC", comment: "RCC en cours de négociation avec les IRP" }
);
addMovement(
  "RH-001",
  "2 postes support finance/RH Côte d'Ivoire — CSP",
  "Départ forcé",
  2,
  "RH",
  "Côte d'Ivoire",
  "2026-11-15",
  { socialScheme: "RCC" }
);
addMovement(
  "RH-002",
  "2 postes paie filiales africaines — CSP paie",
  "Départ forcé",
  2,
  "RH",
  "Maroc",
  "2026-08-01",
  { matricule: "M-MA-004", socialScheme: "RC" }
);

console.log(`${employees.length} employés, ${movements.length} mouvements générés.`);
const movRows = [MOV_HEADERS, ...movements];

console.log(`Génération des fichiers Excel démo dans : ${OUT_DIR}`);
writeWorkbook("arborescence_financiere_agroverde.xlsx", [["Arborescence", financialRows]]);
writeWorkbook("arborescence_geographique_agroverde.xlsx", [["Arborescence", geoRows]]);
writeWorkbook("leviers_agroverde.xlsx", [
  ["Leviers", leverRows],
  ["Actions", actionRows],
  ["Impacts", impactRows],
]);
writeWorkbook("base_etp_agroverde.xlsx", [
  ["Base ETP", empRows],
  ["Mouvements", movRows],
]);
console.log("Terminé.");
