/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Génère un Plan Stratégique fictif complet pour Acme Corp (c1), pour démonstration : 5 axes,
 * ~14 chantiers, actions avec livrables/sous-étapes, indicateurs macro + chantier avec plusieurs
 * mois d'historique de mesures, une dépendance inter-chantiers volontairement en retard (pour
 * illustrer l'alerte de cascade).
 *
 * Idempotent au niveau du programme : supprime d'abord tout Plan Stratégique existant pour c1
 * (et ses axes/chantiers/actions/indicateurs/mesures/étapes de maturité rattachés) avant de
 * recréer un jeu de données propre — évite d'accumuler les essais manuels précédents.
 *
 * Usage : npm run seed-strategic-demo
 * Lit la config Firebase depuis .env.local (même pattern que scripts/create-admin.js).
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
loadEnvFile(path.resolve(__dirname, "..", ".env.production"));

if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  console.error("Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_API_KEY manquant).");
  process.exit(1);
}

const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
} = require("firebase/firestore");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const COMPANY_ID = "c1";
const PROGRAM_ID = "p-strat-demo-2026";
const TODAY = new Date().toISOString().slice(0, 10);

// ── Nettoyage : supprime toute donnée stratégique existante pour Acme Corp ─────────────────────
async function deleteWhereCompany(collectionName) {
  const snap = await getDocs(
    query(collection(db, collectionName), where("companyId", "==", COMPANY_ID))
  );
  for (const d of snap.docs) await deleteDoc(d.ref);
  return snap.size;
}

// ── Étapes de maturité par défaut (mêmes 4 que ensureDefaultMaturityStages) ────────────────────
const STAGES = [
  { id: "defined", order: 1, label: "Défini" },
  { id: "validated", order: 2, label: "Validé" },
  { id: "planned", order: 3, label: "Planifié" },
  { id: "achieved", order: 4, label: "Réalisé", isTerminal: true },
];

// ── Utilisateurs de démo (adminUsers) ───────────────────────────────────────────────────────
// Corrige le vrai problème du PO ("impossible d'assigner quelqu'un dans les pickers RACI/
// responsable/sponsor") : ces pickers lisent `adminUsers` filtré par `companyId`, et ce script ne
// créait auparavant AUCUN document `adminUsers` — les anciens champs `owner` (ex. "Sophie Nguyen")
// ne sont que des chaînes d'affichage, pas des comptes. Ces utilisateurs sont donc SÉLECTIONNABLES
// dans les pickers mais ne peuvent PAS se connecter (aucun compte Firebase Auth associé) — c'est
// voulu, seul le côté "options des pickers" est demandé ici.
const DEMO_USERS = [
  {
    username: "camille.rousseau",
    password: "demo-user-2026",
    role: "chantier_owner",
    firstName: "Camille",
    lastName: "Rousseau",
    name: "Camille Rousseau",
  },
  {
    username: "antoine.mercier",
    password: "demo-user-2026",
    role: "chantier_contributor",
    firstName: "Antoine",
    lastName: "Mercier",
    name: "Antoine Mercier",
  },
  {
    username: "nicolas.petit",
    password: "demo-user-2026",
    role: "chantier_contributor",
    firstName: "Nicolas",
    lastName: "Petit",
    name: "Nicolas Petit",
  },
  {
    username: "isabelle.faure",
    password: "demo-user-2026",
    role: "axis_sponsor",
    firstName: "Isabelle",
    lastName: "Faure",
    name: "Isabelle Faure",
  },
  {
    username: "thomas.girard",
    password: "demo-user-2026",
    role: "strategic_lead",
    firstName: "Thomas",
    lastName: "Girard",
    name: "Thomas Girard",
  },
  {
    username: "lucie.bernard",
    password: "demo-user-2026",
    role: "budget_control",
    firstName: "Lucie",
    lastName: "Bernard",
    name: "Lucie Bernard",
  },
];

// ── Contenu du plan ─────────────────────────────────────────────────────────────────────────
const AXES = [
  {
    id: "AX-excop",
    name: "Excellence Opérationnelle",
    description: "Fiabiliser et optimiser la performance industrielle et logistique du groupe.",
    owner: "Marc Delattre",
    color: "#7B1E1E",
    stage: "planned",
  },
  {
    id: "AX-digital",
    name: "Digitalisation & Data",
    description: "Unifier la donnée et automatiser les processus critiques.",
    owner: "Sophie Nguyen",
    color: "#3B6EA5",
    stage: "planned",
  },
  {
    id: "AX-expclient",
    name: "Expérience Client",
    description: "Refondre le parcours client omnicanal et la relation client.",
    owner: "Julien Castel",
    color: "#C8102E",
    stage: "defined",
  },
  {
    id: "AX-durable",
    name: "Développement Durable",
    description: "Réduire l'empreinte environnementale des sites et des emballages.",
    owner: "Claire Fontaine",
    color: "#4F6F52",
    stage: "defined",
  },
  {
    id: "AX-talents",
    name: "Talents & Organisation",
    description: "Préparer les compétences et l'organisation de demain.",
    owner: "Nathalie Perrin",
    color: "#8A6D5C",
    stage: "planned",
  },
];

const CHANTIERS = [
  { id: "CH-lean", axisId: "AX-excop", name: "Lean Manufacturing Sites EU", stage: "planned" },
  {
    id: "CH-supply",
    axisId: "AX-excop",
    name: "Optimisation Supply Chain",
    stage: "validated",
    raci: [
      { userId: "thomas.girard", letter: "A" },
      { userId: "lucie.bernard", letter: "C" },
    ],
  },
  { id: "CH-qualite", axisId: "AX-excop", name: "Amélioration Qualité Produits", stage: "defined" },

  {
    id: "CH-data",
    axisId: "AX-digital",
    name: "Plateforme Data Unifiée",
    stage: "planned",
    sponsorName: "isabelle.faure",
    pilote: "camille.rousseau",
    effort: { financialImpact: 3, humanImpact: 2, duration: 3, changeManagement: 2 },
  },
  { id: "CH-rpa", axisId: "AX-digital", name: "Automatisation RPA Finance", stage: "achieved" },
  {
    id: "CH-cyber",
    axisId: "AX-digital",
    name: "Cybersécurité & Cloud",
    stage: "validated",
    sponsorName: "isabelle.faure",
    pilote: "camille.rousseau",
    effort: { financialImpact: 3, humanImpact: 3, duration: 3, changeManagement: 4 },
    raci: [
      { userId: "isabelle.faure", letter: "A" },
      { userId: "camille.rousseau", letter: "R" },
      { userId: "antoine.mercier", letter: "R" },
      { userId: "nicolas.petit", letter: "C" },
      { userId: "lucie.bernard", letter: "C" },
      { userId: "thomas.girard", letter: "I" },
    ],
    successCriteria:
      "On sera satisfait fin 2027 si l'ensemble des applications critiques tourne sur l'infrastructure cloud sécurisée, sans incident de sécurité majeur, et si les équipes opérationnelles sont autonomes sur les nouveaux outils de sécurité.",
    successKpis: [
      { id: "KPI-cyber-1", label: "0 incident de sécurité majeur en 2026", achieved: false },
      {
        id: "KPI-cyber-2",
        label: "100% des applications critiques migrées vers le cloud sécurisé d'ici Q4 2026",
        achieved: false,
      },
      { id: "KPI-cyber-3", label: "Certification ISO 27001 obtenue", achieved: false },
      {
        id: "KPI-cyber-4",
        label: "90% des collaborateurs formés aux nouvelles politiques de sécurité",
        achieved: true,
      },
    ],
    milestones: {
      currentMilestone: "E2",
      passedMilestones: ["E0", "E1"],
      checklists: {
        E0: [
          { itemId: "E0-A2", flag: "green" },
          { itemId: "E0-B1", flag: "green" },
          {
            itemId: "E0-B2",
            flag: "orange",
            resolved: true,
            actionPlan: {
              description:
                "Périmètre initial limité au SI de gestion ; élargi aux environnements industriels (OT) après cadrage complémentaire avec la DSI.",
              owner: "camille.rousseau",
              dueDate: "2026-03-10",
            },
          },
          { itemId: "E0-C1", flag: "green" },
        ],
        E1: [
          { itemId: "E1-B1", flag: "green" },
          { itemId: "E1-B2", flag: "green" },
          {
            itemId: "E1-B3",
            flag: "orange",
            resolved: true,
            actionPlan: {
              description:
                "Revue multi-angles initialement incomplète sur le volet conformité RGPD du futur hébergement cloud ; complétée avec le DPO avant validation du jalon.",
              owner: "lucie.bernard",
              dueDate: "2026-05-15",
            },
          },
          { itemId: "E1-C2", flag: "green" },
        ],
        E2: [
          { itemId: "E2-B1", flag: "green" },
          {
            itemId: "E2-B2",
            flag: "orange",
            resolved: false,
            actionPlan: {
              description:
                "Ressources internes confirmées ; poste d'architecte sécurité cloud encore en recrutement, recours à un prestataire externe en cours d'arbitrage.",
              owner: "camille.rousseau",
              dueDate: "2026-11-30",
            },
          },
        ],
      },
    },
  },

  {
    id: "CH-omnicanal",
    axisId: "AX-expclient",
    name: "Refonte Parcours Client Omnicanal",
    stage: "planned",
  },
  {
    id: "CH-fidelite",
    axisId: "AX-expclient",
    name: "Programme Fidélité Nouvelle Génération",
    stage: "defined",
  },
  {
    id: "CH-scia",
    axisId: "AX-expclient",
    name: "Service Client IA",
    stage: "defined",
    dependencies: [{ targetId: "CH-data", type: "FS" }],
  },

  {
    id: "CH-carbone",
    axisId: "AX-durable",
    name: "Réduction Empreinte Carbone Sites",
    stage: "planned",
  },
  {
    id: "CH-emballages",
    axisId: "AX-durable",
    name: "Économie Circulaire Emballages",
    stage: "defined",
  },

  {
    id: "CH-succession",
    axisId: "AX-talents",
    name: "Programme Leadership & Succession",
    stage: "validated",
  },
  { id: "CH-upskilling", axisId: "AX-talents", name: "Digital Upskilling", stage: "planned" },
  {
    id: "CH-orga",
    axisId: "AX-talents",
    name: "Nouvelle Organisation Matricielle",
    stage: "defined",
  },
];

// Actions par chantier — bornes utilisées pour le Gantt (chantierBounds), quelques-unes avec
// livrables à sous-étapes datées pour illustrer la fonctionnalité.
const ACTIONS = [
  {
    id: "ACT-lean-1",
    chantierId: "CH-lean",
    name: "Diagnostic 5S sites pilotes",
    owner: "Marc Delattre",
    start: "2026-02-01",
    end: "2026-05-31",
    status: "achieved",
  },
  {
    id: "ACT-lean-2",
    chantierId: "CH-lean",
    name: "Déploiement Lean sites EU",
    owner: "Marc Delattre",
    start: "2026-06-01",
    end: "2027-06-30",
    status: "planned",
    deliverables: [
      {
        id: "DLV-lean-1",
        label: "Cellules pilotes converties (3 sites)",
        phases: [
          {
            id: "PH-lean-1a",
            start: "2026-06-01",
            end: "2026-12-31",
            note: "Vague 1 — sites France",
          },
          {
            id: "PH-lean-1b",
            start: "2027-01-01",
            end: "2027-06-30",
            note: "Vague 2 — sites Allemagne/Pologne",
          },
        ],
      },
    ],
  },
  {
    id: "ACT-supply-1",
    chantierId: "CH-supply",
    name: "Refonte réseau logistique EU",
    owner: "Marc Delattre",
    start: "2026-01-15",
    end: "2026-09-30",
    status: "validated",
  },
  {
    id: "ACT-supply-2",
    chantierId: "CH-supply",
    name: "Mise en place S&OP",
    owner: "Marc Delattre",
    start: "2026-10-01",
    end: "2027-03-31",
    status: "planned",
  },
  {
    id: "ACT-qualite-1",
    chantierId: "CH-qualite",
    name: "Cadrage plan qualité",
    owner: "Marc Delattre",
    start: "2026-03-01",
    end: "2026-06-30",
    status: "defined",
  },

  {
    id: "ACT-data-1",
    chantierId: "CH-data",
    name: "Cartographie sources & gouvernance",
    owner: "Sophie Nguyen",
    start: "2026-06-01",
    end: "2026-12-31",
    status: "validated",
    deliverables: [
      {
        id: "DLV-data-1",
        label: "Cartographie des sources de données",
        phases: [
          { id: "PH-data-1a", start: "2026-06-01", end: "2026-09-30", note: "Sources ERP/CRM" },
          { id: "PH-data-1b", start: "2026-10-01", end: "2026-12-31", note: "Sources IoT usines" },
        ],
      },
      {
        id: "DLV-data-2",
        label: "Migration vers le data lake",
        phases: [{ id: "PH-data-2a", start: "2027-01-01", end: "2027-06-30" }],
      },
    ],
  },
  {
    id: "ACT-data-2",
    chantierId: "CH-data",
    name: "Mise en production plateforme data",
    owner: "Sophie Nguyen",
    start: "2027-01-01",
    end: "2027-06-30",
    status: "planned",
  },
  {
    id: "ACT-rpa-1",
    chantierId: "CH-rpa",
    name: "Robots facturation fournisseurs",
    owner: "Sophie Nguyen",
    start: "2026-01-01",
    end: "2026-06-30",
    status: "achieved",
    deliverables: [
      {
        id: "DLV-rpa-1",
        label: "Robots RPA facturation fournisseurs",
        phases: [
          { id: "PH-rpa-1a", start: "2026-01-01", end: "2026-03-31", note: "Pilote 2 sites" },
          {
            id: "PH-rpa-1b",
            start: "2026-04-01",
            end: "2026-06-30",
            note: "Déploiement généralisé",
          },
        ],
      },
    ],
  },
  {
    id: "ACT-cyber-1",
    chantierId: "CH-cyber",
    name: "Migration cloud sécurisée",
    owner: "Sophie Nguyen",
    start: "2026-04-01",
    end: "2027-01-31",
    status: "validated",
  },

  {
    id: "ACT-omni-1",
    chantierId: "CH-omnicanal",
    name: "Refonte site e-commerce",
    owner: "Julien Castel",
    start: "2026-02-01",
    end: "2026-11-30",
    status: "planned",
  },
  {
    id: "ACT-omni-2",
    chantierId: "CH-omnicanal",
    name: "Intégration app mobile / magasin",
    owner: "Julien Castel",
    start: "2026-12-01",
    end: "2027-05-31",
    status: "defined",
  },
  {
    id: "ACT-fidelite-1",
    chantierId: "CH-fidelite",
    name: "Cadrage programme fidélité",
    owner: "Julien Castel",
    start: "2026-05-01",
    end: "2026-08-31",
    status: "defined",
  },
  {
    id: "ACT-scia-1",
    chantierId: "CH-scia",
    name: "Déploiement assistant IA support",
    owner: "Julien Castel",
    start: "2027-01-01",
    end: "2027-09-30",
    status: "defined",
  },

  {
    id: "ACT-carbone-1",
    chantierId: "CH-carbone",
    name: "Audit énergétique sites",
    owner: "Claire Fontaine",
    start: "2026-01-01",
    end: "2026-06-30",
    status: "achieved",
  },
  {
    id: "ACT-carbone-2",
    chantierId: "CH-carbone",
    name: "Déploiement énergies renouvelables",
    owner: "Claire Fontaine",
    start: "2026-07-01",
    end: "2027-12-31",
    status: "planned",
  },
  {
    id: "ACT-emballages-1",
    chantierId: "CH-emballages",
    name: "Cadrage économie circulaire",
    owner: "Claire Fontaine",
    start: "2026-04-01",
    end: "2026-07-31",
    status: "defined",
  },

  {
    id: "ACT-succession-1",
    chantierId: "CH-succession",
    name: "Cartographie postes clés & successeurs",
    owner: "Nathalie Perrin",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "validated",
    deliverables: [
      {
        id: "DLV-succession-1",
        label: "Plan de succession Comité de Direction",
        phases: [{ id: "PH-succession-1a", start: "2026-01-01", end: "2026-12-31" }],
      },
    ],
  },
  {
    id: "ACT-upskilling-1",
    chantierId: "CH-upskilling",
    name: "Cadrage académie digitale",
    owner: "Nathalie Perrin",
    start: "2026-03-01",
    end: "2026-06-30",
    status: "planned",
  },
  {
    id: "ACT-orga-1",
    chantierId: "CH-orga",
    name: "Diagnostic organisation cible",
    owner: "Nathalie Perrin",
    start: "2026-02-01",
    end: "2026-05-31",
    status: "defined",
  },
];

// Indicateurs macro (rattachés à l'axe, pas de chantierId) + indicateurs de chantier.
const INDICATORS = [
  {
    id: "IND-service-client",
    axisId: "AX-excop",
    name: "Taux de service client",
    kind: "quantitative",
    frequency: "monthly",
    objective: "Atteindre 98% de taux de service d'ici fin 2026",
    objectiveValue: 98,
    direction: "up",
    unit: "%",
    responsibleRoles: ["axis_sponsor"],
    measurements: period("monthly", "2026-01", [92, 93, 94, 95, 96, 97]),
  },
  {
    id: "IND-digitalisation",
    axisId: "AX-digital",
    name: "Taux de digitalisation des processus",
    kind: "quantitative",
    frequency: "quarterly",
    objective: "75% des processus clés digitalisés d'ici fin 2026",
    objectiveValue: 75,
    direction: "up",
    unit: "%",
    responsibleRoles: ["axis_sponsor"],
    measurements: period("quarterly", "2026-Q1", [55, 63, 76]),
  },
  {
    id: "IND-nps",
    axisId: "AX-expclient",
    name: "Net Promoter Score (NPS)",
    kind: "quantitative",
    frequency: "monthly",
    objective: "NPS à 60 pts d'ici fin 2026",
    objectiveValue: 60,
    direction: "up",
    unit: "pts",
    responsibleRoles: ["axis_sponsor"],
    additionalAuthorizedUserIds: ["test.cto"],
    measurements: period("monthly", "2026-01", [38, 41, 45, 48, 52, 55]),
  },
  {
    id: "IND-co2",
    axisId: "AX-durable",
    name: "Émissions CO2 (scope 1+2)",
    kind: "quantitative",
    frequency: "annual",
    objective: "Réduire à 120 kT/an d'ici 2028",
    objectiveValue: 120,
    direction: "down",
    unit: "kT",
    responsibleRoles: ["axis_sponsor"],
    measurements: period("annual", "2025", [165, 148]),
  },
  {
    id: "IND-engagement",
    axisId: "AX-talents",
    name: "Taux d'engagement collaborateurs",
    kind: "quantitative",
    frequency: "semiannual",
    objective: "80% d'engagement d'ici fin 2026",
    objectiveValue: 80,
    direction: "up",
    unit: "%",
    responsibleRoles: ["axis_sponsor"],
    measurements: period("semiannual", "2026-S1", [82]),
  },

  {
    id: "IND-rebut",
    axisId: "AX-excop",
    chantierId: "CH-lean",
    name: "Taux de rebut production",
    kind: "quantitative",
    frequency: "monthly",
    objective: "Réduire le rebut à 2% d'ici fin 2026",
    objectiveValue: 2,
    direction: "down",
    unit: "%",
    responsibleRoles: ["chantier_owner"],
    measurements: period("monthly", "2026-01", [4.5, 4.0, 3.6, 3.1, 2.8]),
  },
  {
    id: "IND-delai",
    axisId: "AX-excop",
    chantierId: "CH-supply",
    name: "Délai de livraison moyen",
    kind: "quantitative",
    frequency: "monthly",
    objective: "3 jours de délai moyen d'ici fin 2026",
    objectiveValue: 3,
    direction: "down",
    unit: "jours",
    responsibleRoles: ["chantier_owner"],
    measurements: period("monthly", "2026-01", [6, 5.5, 5, 4.2]),
  },
  {
    id: "IND-sources",
    axisId: "AX-digital",
    chantierId: "CH-data",
    name: "Sources de données intégrées",
    kind: "quantitative",
    frequency: "quarterly",
    objective: "25 sources intégrées d'ici fin 2026",
    objectiveValue: 25,
    direction: "up",
    unit: "sources",
    responsibleRoles: ["chantier_owner"],
    measurements: period("quarterly", "2026-Q1", [8, 14, 19]),
  },
  {
    id: "IND-heures",
    axisId: "AX-digital",
    chantierId: "CH-rpa",
    name: "Heures économisées / mois",
    kind: "quantitative",
    frequency: "monthly",
    objective: "400h économisées par mois d'ici mi-2026",
    objectiveValue: 400,
    direction: "up",
    unit: "h",
    responsibleRoles: ["chantier_owner"],
    measurements: period("monthly", "2026-01", [150, 240, 320, 410]),
  },
  {
    id: "IND-conversion",
    axisId: "AX-expclient",
    chantierId: "CH-omnicanal",
    name: "Taux de conversion online",
    kind: "quantitative",
    frequency: "monthly",
    objective: "4,5% de conversion d'ici fin 2026",
    objectiveValue: 4.5,
    direction: "up",
    unit: "%",
    responsibleRoles: ["chantier_owner"],
    additionalAuthorizedUserIds: ["test.cto"],
    measurements: period("monthly", "2026-01", [2.8, 3.1, 3.4, 3.7]),
  },
  {
    id: "IND-resolution",
    axisId: "AX-expclient",
    chantierId: "CH-scia",
    name: "Taux de résolution au premier contact",
    kind: "quantitative",
    frequency: "monthly",
    objective: "85% de résolution au 1er contact d'ici fin 2027",
    objectiveValue: 85,
    direction: "up",
    unit: "%",
    responsibleRoles: ["chantier_owner"],
    measurements: period("monthly", "2026-01", [68, 71, 74]),
  },
  {
    id: "IND-energie",
    axisId: "AX-durable",
    chantierId: "CH-carbone",
    name: "Part d'énergie renouvelable",
    kind: "quantitative",
    frequency: "annual",
    objective: "50% d'énergie renouvelable d'ici 2028",
    objectiveValue: 50,
    direction: "up",
    unit: "%",
    responsibleRoles: ["chantier_owner"],
    measurements: period("annual", "2025", [22, 34]),
  },
  {
    id: "IND-succession",
    axisId: "AX-talents",
    chantierId: "CH-succession",
    name: "Couverture plan de succession postes clés",
    kind: "qualitative",
    frequency: "semiannual",
    objective: "100% des postes clés couverts d'ici fin 2027",
    responsibleRoles: ["chantier_owner", "strategic_lead"],
    measurements: [
      {
        period: "2026-S1",
        note: "60% des postes clés identifiés, plans de développement en cours pour les successeurs pressentis.",
      },
    ],
  },
];

function period(freq, startPeriod, values) {
  const periods = [];
  if (freq === "monthly") {
    let [y, m] = startPeriod.split("-").map(Number);
    for (let i = 0; i < values.length; i++) {
      periods.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  } else if (freq === "quarterly") {
    let [y, q] = [Number(startPeriod.slice(0, 4)), Number(startPeriod.slice(6))];
    for (let i = 0; i < values.length; i++) {
      periods.push(`${y}-Q${q}`);
      q++;
      if (q > 4) {
        q = 1;
        y++;
      }
    }
  } else if (freq === "semiannual") {
    let [y, s] = [Number(startPeriod.slice(0, 4)), Number(startPeriod.slice(6))];
    for (let i = 0; i < values.length; i++) {
      periods.push(`${y}-S${s}`);
      s++;
      if (s > 2) {
        s = 1;
        y++;
      }
    }
  } else {
    let y = Number(startPeriod);
    for (let i = 0; i < values.length; i++) periods.push(String(y++));
  }
  return periods.map((p, i) => ({ period: p, value: values[i] }));
}

function computeStatus(indicator, measurements) {
  if (indicator.kind === "qualitative") return "on_track";
  if (indicator.objectiveValue === undefined) return "on_track";
  const withValue = measurements.filter((m) => m.value !== undefined);
  if (withValue.length === 0) return "on_track";
  const latest = withValue.reduce((a, b) => (a.period > b.period ? a : b));
  return indicator.direction === "down"
    ? latest.value <= indicator.objectiveValue
      ? "on_track"
      : "at_risk"
    : latest.value >= indicator.objectiveValue
      ? "on_track"
      : "at_risk";
}

async function main() {
  console.log(`Nettoyage des données stratégiques existantes pour ${COMPANY_ID}...`);
  for (const col of [
    "strategicAxes",
    "chantiers",
    "chantierActions",
    "indicators",
    "indicatorMeasurements",
    "maturityStageConfigs",
  ]) {
    const n = await deleteWhereCompany(col);
    if (n > 0) console.log(`  ${col} : ${n} document(s) supprimé(s)`);
  }
  // Programmes stratégiques existants pour c1 (peu importe leur id) — supprimés aussi.
  const progSnap = await getDocs(
    query(collection(db, "programs"), where("companyId", "==", COMPANY_ID))
  );
  for (const d of progSnap.docs) {
    if (d.data().type === "strategic") await deleteDoc(d.ref);
  }

  console.log("Création du programme stratégique...");
  await setDoc(doc(db, "programs", PROGRAM_ID), {
    id: PROGRAM_ID,
    companyId: COMPANY_ID,
    name: "Excellence Opérationnelle 2026-2028",
    sponsor: "COMEX",
    target: 0,
    currency: "EUR",
    fyStart: "2026-01-01",
    fyEnd: "2028-12-31",
    baselineEBIT: 124.5,
    revenue: 892.0,
    createdAt: TODAY,
    type: "strategic",
  });

  console.log(`Utilisateurs de démo (${DEMO_USERS.length})...`);
  for (const user of DEMO_USERS) {
    // Idem au nettoyage des autres collections (delete-then-recreate), mais ciblé PAR USERNAME et
    // non par requête companyId : `adminUsers` contient aussi des comptes créés manuellement
    // (ex. "test.cto") qui ne doivent jamais être touchés par ce script.
    await deleteDoc(doc(db, "adminUsers", user.username));
  }
  for (const user of DEMO_USERS) {
    await setDoc(doc(db, "adminUsers", user.username), {
      username: user.username,
      password: user.password,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
      companyId: COMPANY_ID,
    });
  }

  console.log("Étapes de maturité par défaut...");
  for (const stage of STAGES) {
    await setDoc(doc(db, "maturityStageConfigs", `${PROGRAM_ID}__${stage.id}`), {
      ...stage,
      programId: PROGRAM_ID,
      companyId: COMPANY_ID,
    });
  }

  console.log(`Axes (${AXES.length})...`);
  for (const axis of AXES) {
    await setDoc(doc(db, "strategicAxes", axis.id), {
      ...axis,
      companyId: COMPANY_ID,
      programId: PROGRAM_ID,
      createdAt: TODAY,
      lastUpdate: TODAY,
    });
  }

  console.log(`Chantiers (${CHANTIERS.length})...`);
  for (const chantier of CHANTIERS) {
    const payload = {
      id: chantier.id,
      companyId: COMPANY_ID,
      programId: PROGRAM_ID,
      axisId: chantier.axisId,
      name: chantier.name,
      stage: chantier.stage,
      dependencies: chantier.dependencies ?? [],
      createdAt: TODAY,
      lastUpdate: TODAY,
    };
    if (chantier.sponsorName) payload.sponsorName = chantier.sponsorName;
    if (chantier.pilote) payload.pilote = chantier.pilote;
    if (chantier.successCriteria) payload.successCriteria = chantier.successCriteria;
    if (chantier.successKpis) payload.successKpis = chantier.successKpis;
    if (chantier.raci) payload.raci = chantier.raci;
    if (chantier.effort) payload.effort = chantier.effort;
    if (chantier.milestones) payload.milestones = chantier.milestones;
    await setDoc(doc(db, "chantiers", chantier.id), payload);
  }

  console.log(`Actions (${ACTIONS.length})...`);
  for (const action of ACTIONS) {
    const payload = {
      id: action.id,
      companyId: COMPANY_ID,
      chantierId: action.chantierId,
      name: action.name,
      owner: action.owner,
      start: action.start,
      end: action.end,
      status: action.status,
    };
    if (action.deliverables) payload.deliverables = action.deliverables;
    await setDoc(doc(db, "chantierActions", action.id), payload);
  }

  console.log(`Indicateurs (${INDICATORS.length}) + mesures...`);
  let measurementCount = 0;
  for (const ind of INDICATORS) {
    const status = computeStatus(ind, ind.measurements);
    const payload = {
      id: ind.id,
      companyId: COMPANY_ID,
      programId: PROGRAM_ID,
      axisId: ind.axisId,
      name: ind.name,
      kind: ind.kind,
      frequency: ind.frequency,
      objective: ind.objective,
      responsibleRoles: ind.responsibleRoles,
      status,
      createdAt: TODAY,
      lastUpdate: TODAY,
    };
    if (ind.chantierId) payload.chantierId = ind.chantierId;
    if (ind.objectiveValue !== undefined) payload.objectiveValue = ind.objectiveValue;
    if (ind.direction) payload.direction = ind.direction;
    if (ind.unit) payload.unit = ind.unit;
    if (ind.additionalAuthorizedUserIds)
      payload.additionalAuthorizedUserIds = ind.additionalAuthorizedUserIds;
    await setDoc(doc(db, "indicators", ind.id), payload);

    let seq = 0;
    for (const m of ind.measurements) {
      seq++;
      const measurementId = `MEA-${ind.id}-${seq}`;
      const mPayload = {
        id: measurementId,
        companyId: COMPANY_ID,
        indicatorId: ind.id,
        period: m.period,
        reportedBy: "seed-script",
        reportedAt: TODAY,
      };
      if (m.value !== undefined) mPayload.value = m.value;
      if (m.note) mPayload.note = m.note;
      await setDoc(doc(db, "indicatorMeasurements", measurementId), mPayload);
      measurementCount++;
    }
  }
  console.log(`  ${measurementCount} mesure(s) créée(s).`);

  console.log(
    '\nTerminé. Programme stratégique "Excellence Opérationnelle 2026-2028" créé pour Acme Corp.'
  );
  console.log(
    `  5 axes · ${CHANTIERS.length} chantiers · ${ACTIONS.length} actions · ${INDICATORS.length} indicateurs · ${measurementCount} mesures · ${DEMO_USERS.length} utilisateurs de démo`
  );
  console.log(
    "  1 dépendance en retard (Plateforme Data Unifiée → Service Client IA, FS) pour illustrer l'alerte de cascade."
  );
  console.log(
    "  CH-cyber : exemple complet (RACI, effort, jalons E0→E2 avec check-lists, critères/KPI de succès)."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
