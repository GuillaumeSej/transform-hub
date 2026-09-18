/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Corrige le cas "Réalisé à date > Réactualisé net" — impossible en pratique (on ne peut pas avoir
 * déjà réalisé plus que ce qui est aujourd'hui projeté) mais qui peut apparaître en base quand un
 * `lockedPlan`/`reforecast` figé n'a pas été resynchronisé après l'ajout/la complétion d'actions
 * (le recalcul automatique vit dans `leversLogic.ts::recomputeLeverProgress`, déclenché à chaque
 * mutation d'action — un document resté figé depuis un import/seed antérieur à cette logique, ou
 * modifié hors de ce chemin, peut donc diverger).
 *
 * Pour CHAQUE levier ayant des actions chiffrées (au moins un impact) :
 *   1. Recalcule grossSavings/netSavings/capex/opexOneOff/opexRec/fteImpact/progress depuis le
 *      plan d'actions courant — même logique que `consolidateLeverFromActions`/`actionProgress`
 *      (lib/leverConsolidate.ts, lib/engine.ts), reproduite ici en JS pur (scripts/ n'importe pas
 *      les modules TS de l'app, voir les autres scripts de migration du dossier).
 *      - Si `lockedPlan` existe : le recalcul alimente `reforecast` (comme le ferait normalement
 *        toute mutation d'action), jamais les champs bruts figés.
 *      - Sinon : le recalcul alimente directement les champs bruts du levier.
 *   2. Garde-fou final : même après resynchronisation, un plan d'actions où les actions NON
 *      "done" ont un impact net négatif peut mathématiquement laisser le réalisé (actions "done"
 *      seulement) dépasser le total recalculé (toutes actions) — dans ce cas (rare), on relève le
 *      réactualisé/net au niveau du réalisé plutôt que de laisser l'incohérence affichée : "ça ne
 *      doit jamais pouvoir arriver dans les faits" prime sur la fidélité au plan d'actions brut.
 *
 * "Réalisé" et "net" reproduisent EXACTEMENT les formules actuelles de l'app (voir
 * lib/engine.ts::realizedSavings/doneActionImpactsTotal et
 * lib/leverConsolidate.ts::consolidateLeverFromActions, alignées PR #76/#77) :
 *   - Réalisé net à date = Σ (gains − CAPEX) des actions au statut "done" UNIQUEMENT.
 *   - Plan/Réactualisé net = Σ (gains − CAPEX) de TOUTES les actions.
 *   Ni l'OPEX one-off ni l'OPEX récurrent ne réduisent ni l'un ni l'autre.
 *
 * Usage — DRY RUN par défaut (aucune écriture, juste un rapport) :
 *   node scripts/fix-realized-exceeds-reforecast.js
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/fix-realized-exceeds-reforecast.js
 *
 * Usage — écriture réelle, contre l'ÉMULATEUR local (aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/fix-realized-exceeds-reforecast.js --apply
 *
 * Usage — écriture réelle, contre le VRAI projet Firebase — nécessite des identifiants de
 * service, voir scripts/create-admin.js pour le détail (GOOGLE_APPLICATION_CREDENTIALS ou
 * `gcloud auth application-default login`) :
 *   CONFIRM_PROD_MIGRATION=yes node scripts/fix-realized-exceeds-reforecast.js --apply
 *
 * SÉCURITÉ : ce script ÉCRIT dans Firestore (collection `levers` uniquement), seulement avec
 * `--apply`. Idempotent — relançable sans effet de bord (un levier déjà cohérent n'est jamais
 * modifié).
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

const round2 = (v) => Math.round(v * 100) / 100;

const ACTION_STATUS_WEIGHT = { done: 100, in_progress: 50, todo: 0, delayed: 0 };

/** Reproduit engine.actionProgress. */
function actionProgress(actions) {
  if (actions.length === 0) return 0;
  const weights = actions.map((action) => {
    const financialWeight = (action.impacts ?? []).reduce(
      (sum, impact) => sum + Math.abs(impact.amount || 0),
      0
    );
    return financialWeight > 0 ? financialWeight : 1;
  });
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const total = actions.reduce(
    (sum, action, index) => sum + (ACTION_STATUS_WEIGHT[action.status] ?? 0) * weights[index],
    0
  );
  return Math.round(total / totalWeight);
}

/** Reproduit leverConsolidate.hasActionImpacts. */
function hasActionImpacts(lever) {
  return (lever.actions ?? []).some((a) => (a.impacts ?? []).length > 0);
}

/** Reproduit leverConsolidate.consolidateLeverFromActions (netSavings = savings − capex,
 *  alignement PR #77). Retourne undefined si aucune action n'a d'impact (saisie manuelle). */
function consolidateLeverFromActions(lever) {
  const actions = lever.actions ?? [];
  if (!hasActionImpacts(lever)) return undefined;

  const sum = (filter) => {
    let total = 0;
    for (const a of actions) {
      for (const imp of a.impacts ?? []) {
        if (filter(imp)) total += imp.amount || 0;
      }
    }
    return round2(total);
  };
  const savings = sum((i) => i.type === "saving");
  const capex = sum((i) => i.type === "cost" && i.nature === "capex");
  const opexOneOff = sum((i) => i.type === "cost" && i.nature === "oneoff");
  const opexRec = sum((i) => i.type === "cost" && i.nature === "opex_rec");
  let fteImpact = 0;
  for (const a of actions) {
    for (const imp of a.impacts ?? []) {
      if (imp.fteCount) fteImpact += imp.fteCount;
    }
  }

  return {
    grossSavings: round2(savings),
    netSavings: round2(savings - capex),
    capex: round2(capex),
    opexOneOff: round2(opexOneOff),
    opexRec: round2(opexRec),
    fteImpact,
  };
}

/** Reproduit engine.realizedSavings (Σ (gains − CAPEX) des actions "done" uniquement). */
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

/** Reproduit engine.displayedReforecastNet. */
function displayedReforecastNetValue(lever) {
  if (lever.reforecast) return lever.reforecast.netSavings;
  return lever.lockedPlan ? lever.lockedPlan.netSavings : lever.netSavings;
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
        "   Interruption volontaire. Pour tester d'abord (recommandé), positionner\n" +
        "   FIRESTORE_EMULATOR_HOST. Pour l'exécuter VOLONTAIREMENT contre le vrai projet,\n" +
        "   ajouter CONFIRM_PROD_MIGRATION=yes.\n"
    );
    process.exit(1);
  }

  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");

  const app = initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
  const db = getFirestore(app);

  const leversSnap = await db.collection("levers").get();
  console.log(
    `Trouvé ${leversSnap.size} levier(s) — mode ${apply ? "APPLICATION (écriture réelle)" : "DRY RUN (aucune écriture)"}.\n`
  );

  let noImpacts = 0;
  let alreadyConsistent = 0;
  let fixed = 0;
  let neededFloor = 0;

  for (const docSnap of leversSnap.docs) {
    const lever = { id: docSnap.id, ...docSnap.data() };
    if (!hasActionImpacts(lever)) {
      noImpacts++;
      continue;
    }

    const realized = realizedSavings(lever);
    const reforecastBefore = displayedReforecastNetValue(lever);
    const consolidated = consolidateLeverFromActions(lever);
    const newProgress = actionProgress(lever.actions ?? []);

    let floored = false;
    if (realized > consolidated.netSavings) {
      // Garde-fou : une action non "done" à impact net négatif peut laisser le total consolidé
      // sous le réalisé — on relève au niveau du réalisé, l'incohérence ne doit jamais s'afficher.
      consolidated.netSavings = realized;
      floored = true;
    }

    const patch = {
      grossSavings: consolidated.grossSavings,
      capex: consolidated.capex,
      opexOneOff: consolidated.opexOneOff,
      opexRec: consolidated.opexRec,
      fteImpact: consolidated.fteImpact,
      progress: newProgress,
    };
    if (lever.lockedPlan) {
      patch.reforecast = {
        grossSavings: consolidated.grossSavings,
        netSavings: consolidated.netSavings,
        capex: consolidated.capex,
        opexOneOff: consolidated.opexOneOff,
        opexRec: consolidated.opexRec,
      };
    } else {
      patch.netSavings = consolidated.netSavings;
    }

    const reforecastAfter = patch.reforecast ? patch.reforecast.netSavings : patch.netSavings;
    const wasInconsistent = realized > reforecastBefore + 1e-9;
    const stillDiffers =
      Object.keys(patch).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(lever[k])) ||
      reforecastAfter !== reforecastBefore;

    if (!wasInconsistent && !stillDiffers) {
      alreadyConsistent++;
      continue;
    }

    if (floored) neededFloor++;
    fixed++;
    console.log(
      `[${apply ? "FIX" : "DRY"}] levers/${lever.id} (code="${lever.code}", "${lever.name}") : ` +
        `réalisé=${realized} réactualisé ${reforecastBefore} -> ${reforecastAfter}` +
        `${floored ? " [plancher appliqué]" : ""}, progress ${lever.progress} -> ${newProgress}`
    );
    if (apply) {
      await docSnap.ref.update(patch);
    }
  }

  console.log("\n──────────── Résumé ────────────");
  console.log(`Leviers sans action chiffrée (ignorés)     : ${noImpacts}`);
  console.log(`Leviers déjà cohérents                      : ${alreadyConsistent}`);
  console.log(`Leviers corrigés${apply ? "" : " (dry run)"}                    : ${fixed}`);
  console.log(`  dont plancher réalisé->réactualisé requis : ${neededFloor}`);
  console.log("─────────────────────────────────\n");
  if (!apply && fixed > 0) {
    console.log("Relancer avec --apply pour écrire ces corrections dans Firestore.\n");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
