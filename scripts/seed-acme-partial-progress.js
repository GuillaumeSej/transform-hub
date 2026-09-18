/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Ajoute, sur quelques leviers d'Acme Corp (companyId "c1") actuellement à 0% ou 100% de
 * progression affichée, une action supplémentaire pour obtenir des % strictement entre 0 et 100 —
 * utile pour avoir des exemples visuels de progression partielle en démo/recette.
 *
 * Rappel : la progression AFFICHÉE (engine.displayedProgressPct, PR #76) = réalisé net à date /
 * réactualisé net × 100, où le réalisé ne compte QUE les actions au statut "done" (voir
 * engine.realizedSavings). Recette appliquée ici :
 *   - Levier à 100% (toutes actions "done") : ajoute UNE action "todo" avec un gain modeste
 *     (~40% du réalisé actuel) — le réactualisé augmente, le réalisé reste inchangé, la
 *     progression retombe entre 60 et 80% environ.
 *   - Levier à 0% (aucune action "done") : ajoute UNE action "done" avec un gain modeste
 *     (~30% de la somme des gains déjà planifiés sur les actions existantes) SANS toucher aux
 *     actions existantes — le réalisé devient positif, le réactualisé reste dominé par les
 *     actions encore en cours, la progression se retrouve entre 15 et 35% environ.
 * Un levier déjà strictement entre 0 et 100% n'est jamais modifié (idempotent : relancer une
 * fois les leviers ajustés ne les modifie plus, seuls les nouveaux 0%/100% restants le sont).
 *
 * Usage — DRY RUN par défaut (aucune écriture, juste un rapport) :
 *   node scripts/seed-acme-partial-progress.js
 *
 * Usage — écriture réelle, contre l'ÉMULATEUR local (aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-acme-partial-progress.js --apply
 *
 * Usage — écriture réelle, contre le VRAI projet Firebase — nécessite des identifiants de
 * service, voir scripts/create-admin.js pour le détail :
 *   CONFIRM_PROD_MIGRATION=yes node scripts/seed-acme-partial-progress.js --apply
 *
 * SÉCURITÉ : ce script ÉCRIT dans Firestore (collection `levers` uniquement), seulement avec
 * `--apply`. À lancer APRÈS scripts/fix-realized-exceeds-reforecast.js (sinon on part d'une base
 * où le réactualisé peut être incohérent).
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

const ACME_COMPANY_ID = "c1";
const round2 = (v) => Math.round(v * 100) / 100;

function hasActionImpacts(lever) {
  return (lever.actions ?? []).some((a) => (a.impacts ?? []).length > 0);
}

function realizedSavings(lever) {
  if (lever.status === "cancelled") return 0;
  let total = 0;
  for (const action of lever.actions ?? []) {
    if (action.status !== "done") continue;
    for (const imp of action.impacts ?? []) {
      if (imp.type === "saving") total += imp.amount || 0;
      else if (imp.nature === "capex") total -= imp.amount || 0;
    }
  }
  return round2(total);
}

function consolidatedNetSavings(lever) {
  let savings = 0;
  let capex = 0;
  for (const a of lever.actions ?? []) {
    for (const imp of a.impacts ?? []) {
      if (imp.type === "saving") savings += imp.amount || 0;
      else if (imp.type === "cost" && imp.nature === "capex") capex += imp.amount || 0;
    }
  }
  return round2(savings - capex);
}

function displayedReforecastNetValue(lever) {
  if (lever.reforecast) return lever.reforecast.netSavings;
  return lever.lockedPlan ? lever.lockedPlan.netSavings : lever.netSavings;
}

function displayedProgressPct(lever) {
  const reforecast = displayedReforecastNetValue(lever);
  if (!reforecast) return 0;
  const pct = (realizedSavings(lever) / reforecast) * 100;
  return pct > 0 ? Math.round(pct) : 0;
}

function sumPlannedSavings(lever) {
  let total = 0;
  for (const a of lever.actions ?? []) {
    for (const imp of a.impacts ?? []) {
      if (imp.type === "saving") total += imp.amount || 0;
    }
  }
  return round2(total);
}

/** Fenêtre [start,end] raisonnable pour la nouvelle action : après la dernière action existante,
 *  bornée par la fin du levier pour rester dans son exercice. */
function pickWindow(lever) {
  const actions = lever.actions ?? [];
  const leverEnd = new Date(lever.end);
  const lastEnd = actions.reduce((max, a) => {
    const d = new Date(a.end);
    return d > max ? d : max;
  }, new Date(lever.start));
  const start = new Date(Math.min(lastEnd.getTime(), leverEnd.getTime()));
  const end = leverEnd > start ? leverEnd : new Date(start.getTime() + 30 * 24 * 3600 * 1000);
  const toIso = (d) => d.toISOString().slice(0, 10);
  return { start: toIso(start), end: toIso(end) };
}

async function main() {
  const apply = process.argv.includes("--apply");

  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant) — vérifier .env.local."
    );
    process.exit(1);
  }

  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (apply && !usingEmulator && process.env.CONFIRM_PROD_MIGRATION !== "yes") {
    console.warn(
      "\n⚠️  AUCUNE variable d'émulateur détectée (FIRESTORE_EMULATOR_HOST).\n" +
        "   Ce script s'apprête à ÉCRIRE dans le VRAI projet Firebase " +
        `"${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}".\n` +
        "   Interruption volontaire. Ajouter CONFIRM_PROD_MIGRATION=yes pour confirmer.\n"
    );
    process.exit(1);
  }

  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");

  const app = initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
  const db = getFirestore(app);

  const snap = await db.collection("levers").where("companyId", "==", ACME_COMPANY_ID).get();
  console.log(
    `Trouvé ${snap.size} levier(s) Acme (companyId="${ACME_COMPANY_ID}") — mode ${apply ? "APPLICATION" : "DRY RUN"}.\n`
  );

  let adjusted = 0;

  for (const docSnap of snap.docs) {
    const lever = { id: docSnap.id, ...docSnap.data() };
    if (!hasActionImpacts(lever) || lever.status === "cancelled") continue;

    const pctBefore = displayedProgressPct(lever);
    if (pctBefore > 0 && pctBefore < 100) continue; // déjà un exemple de progression partielle

    const actions = [...(lever.actions ?? [])];
    const { start, end } = pickWindow(lever);
    let newAction;

    if (pctBefore >= 100) {
      const realized = realizedSavings(lever);
      const gain = round2(Math.max(0.1, realized * 0.4));
      newAction = {
        id: `AC-${lever.id}-SEED-PARTIAL`,
        name: "Extension du périmètre (phase complémentaire)",
        start,
        end,
        status: "todo",
        impacts: [
          {
            id: `IMP-${lever.id}-SEED-PARTIAL`,
            label: "Gain complémentaire à réaliser",
            type: "saving",
            nature: "opex_rec",
            amount: gain,
            pnlMap: lever.pnlMap,
            costCenter: lever.costCenter,
            entity: lever.entity,
          },
        ],
      };
    } else {
      const planned = sumPlannedSavings(lever);
      const gain = round2(Math.max(0.1, planned * 0.3 || 0.1));
      newAction = {
        id: `AC-${lever.id}-SEED-PARTIAL`,
        name: "Premier jalon livré",
        start: lever.start,
        end: start,
        status: "done",
        deliveredDate: start,
        impacts: [
          {
            id: `IMP-${lever.id}-SEED-PARTIAL`,
            label: "Gain déjà réalisé",
            type: "saving",
            nature: "opex_rec",
            amount: gain,
            pnlMap: lever.pnlMap,
            costCenter: lever.costCenter,
            entity: lever.entity,
          },
        ],
      };
    }

    const nextLever = { ...lever, actions: [...actions, newAction] };
    const pctAfter = displayedProgressPct(nextLever);
    const consolidatedAfter = consolidatedNetSavings(nextLever);

    const patch = { actions: nextLever.actions };
    if (lever.lockedPlan) {
      patch.reforecast = {
        ...(lever.reforecast ?? lever.lockedPlan),
        netSavings: consolidatedAfter,
      };
    } else {
      patch.netSavings = consolidatedAfter;
    }

    console.log(
      `[${apply ? "SEED" : "DRY"}] levers/${lever.id} (code="${lever.code}", "${lever.name}") : ` +
        `progression ${pctBefore}% -> ${pctAfter}% (action "${newAction.name}" ajoutée, statut ${newAction.status})`
    );
    adjusted++;
    if (apply) {
      await docSnap.ref.update(patch);
    }
  }

  console.log("\n──────────── Résumé ────────────");
  console.log(`Leviers Acme ajustés${apply ? "" : " (dry run)"} : ${adjusted}`);
  console.log("─────────────────────────────────\n");
  if (!apply && adjusted > 0) {
    console.log("Relancer avec --apply pour écrire ces ajouts dans Firestore.\n");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
