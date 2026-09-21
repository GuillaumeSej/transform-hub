/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Enrichit les leviers d'Acme Corp (companyId "c1") SANS impacts de niveau levier (`Lever.impacts`)
 * avec des lignes d'impact variées : gains récurrents annualisés (gainDate 2026-2028, natures et
 * savingType variés), OPEX récurrent, CAPEX (one-shot / lissé), coûts one-off, dis-synergies,
 * impacts ETP (départs / quelques recrutements), gain one-off ponctuel sur certains leviers, et
 * réactualisation (reforecast ≠ plan figé) sur une partie des leviers.
 *
 * Cohérence des totaux : la CIBLE NETTE (netSavings, lockedPlan.netSavings, reforecast.netSavings)
 * n'est jamais modifiée (sauf +8% de réactualisation sur L020). Règle métier : NET = BRUT − OPEX
 * RÉCURRENT (le CAPEX et l'OPEX one-off n'entrent jamais dans le net annualisé) ; le brut est donc
 * recalé à net + OPEX récurrent. Réalisé ≤ réactualisé garanti par le moteur
 * (réalisé = réactualisé net × fraction ≤ 1). Leviers annulés et leviers déjà dotés d'impacts :
 * jamais modifiés (idempotent : relancer ne fait rien).
 *
 * Usage :
 *   node scripts/enrich-acme-impacts.js                      # DRY RUN (défaut)
 *   CONFIRM_PROD_MIGRATION=yes node scripts/enrich-acme-impacts.js --apply
 *   node scripts/enrich-acme-impacts.js --recalibrate         # DRY RUN de la recalibration (leviers déjà enrichis)
 *   CONFIRM_PROD_MIGRATION=yes node scripts/enrich-acme-impacts.js --recalibrate --apply
 *   CONFIRM_PROD_MIGRATION=yes node scripts/enrich-acme-impacts.js --restore scripts/output/<backup>.json
 * --apply écrit d'abord une sauvegarde JSON (valeurs d'origine des champs modifiés) dans
 * scripts/output/ ; --restore remet ces champs à leur valeur d'origine (supprime `impacts`).
 */
const fs = require("fs");
const path = require("path");

for (const f of [".env.local", ".env.production"]) {
  const p = path.resolve(__dirname, "..", f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
  }
}

const COMPANY_ID = "c1";
const r2 = (v) => Math.round(v * 100) / 100;
const PATCH_FIELDS = [
  "impacts",
  "grossSavings",
  "netSavings",
  "capex",
  "opexOneOff",
  "opexRec",
  "fteImpact",
  "lockedPlan",
  "reforecast",
];

/** Cumuls d'un jeu d'impacts (mêmes règles que engine.leverImpactTotals). */
function impactTotals(impacts) {
  const t = { gross: 0, fteGross: 0, opexRec: 0, opexOneOff: 0, capex: 0 };
  for (const i of impacts) {
    if (i.type === "saving") {
      if (i.gainRecurrence !== "oneoff") t.gross += i.amount;
    } else if (i.type === "fte") {
      if (i.fteDirection === "hire") t.opexRec += i.amount;
      else {
        t.gross += i.amount;
        t.fteGross += i.amount;
      }
    } else if (i.nature === "capex") t.capex += i.amount;
    else if (i.nature === "oneoff") t.opexOneOff += i.amount;
    else t.opexRec += i.amount;
  }
  return t;
}

/** Met à l'échelle les lignes de gain récurrent (hors ETP départs) pour que Σ brut = targetGross. */
function rescaleGains(impacts, targetGross) {
  const t = impactTotals(impacts);
  const lines = impacts.filter((i) => i.type === "saving" && i.gainRecurrence !== "oneoff");
  if (lines.length === 0) return;
  const want = Math.max(0.05, r2(targetGross - t.fteGross));
  const cur = lines.reduce((s, i) => s + i.amount, 0) || 1;
  let allocated = 0;
  lines.forEach((i, k) => {
    i.amount = k === lines.length - 1 ? r2(want - allocated) : r2((i.amount * want) / cur);
    allocated = r2(allocated + i.amount);
  });
}

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const addMonths = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const clampIso = (iso, min, max) => (iso < min ? min : iso > max ? max : iso);

// Libellés par workstream : [label, natureId, savingType]
const SAVING_POOL = {
  "WS-PROC": [
    ["Baisse des prix d'achat négociée", "nat-raw-materials", "cost_reduction"],
    ["Consolidation du panel fournisseurs", "nat-subcontracting", "cost_reduction"],
    ["Optimisation des conditions de paiement (BFR)", "nat-working-capital", "working_capital"],
  ],
  "WS-OPS": [
    ["Gain de productivité sur site", "nat-labor", "cost_reduction"],
    ["Réduction de la consommation énergétique", "nat-energy", "cost_reduction"],
    ["Baisse du taux de rebut", "nat-raw-materials", "cost_reduction"],
  ],
  "WS-COM": [
    ["Hausse du panier moyen (pricing)", "nat-revenue", "revenue_increase"],
    ["Réduction des remises accordées", "nat-revenue", "revenue_increase"],
    ["Optimisation des frais commerciaux", "nat-overheads", "cost_reduction"],
  ],
  "WS-ORG": [
    ["Simplification de l'organisation", "nat-labor", "cost_reduction"],
    ["Mutualisation des fonctions support", "nat-overheads", "cost_reduction"],
    ["Réduction du recours à l'intérim", "nat-labor", "cost_reduction"],
  ],
  "WS-DIG": [
    ["Automatisation des traitements manuels", "nat-labor", "cost_reduction"],
    ["Rationalisation des licences", "nat-it-licences", "cost_reduction"],
    ["Nouveaux revenus digitaux", "nat-revenue", "revenue_increase"],
  ],
  "WS-SC": [
    ["Optimisation des coûts de transport", "nat-subcontracting", "cost_reduction"],
    ["Réduction des stocks (BFR)", "nat-working-capital", "working_capital"],
    ["Consolidation des entrepôts", "nat-overheads", "cost_reduction"],
  ],
};
const DIS_POOL = [
  ["Dis-synergie : surcoût de transition fournisseur", "nat-subcontracting"],
  ["Dis-synergie : perte de remises de volume", "nat-raw-materials"],
  ["Dis-synergie : double exploitation pendant la bascule", "nat-it-licences"],
  ["Dis-synergie : renfort temporaire de support", "nat-labor"],
];
const CAPEX_POOL = [
  ["Investissement outillage / équipements", "nat-equipment"],
  ["Développement et intégration SI", "nat-it-licences"],
  ["Refonte de sites / agencements", "nat-equipment"],
];
const ONEOFF_POOL = [
  ["Accompagnement conseil & conduite du changement", "nat-consulting"],
  ["Frais de formation et de transition", "nat-labor"],
  ["Coûts de migration et de recette", "nat-it-licences"],
];
const OPEX_POOL = [
  ["Licences et maintenance récurrentes", "nat-it-licences"],
  ["Pilotage et run de la nouvelle organisation", "nat-overheads"],
  ["Coûts d'exploitation supplémentaires", "nat-subcontracting"],
];

function buildEnrichment(lever) {
  const rnd = rng(lever.id);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const snapNet = (s) => (s ? s.netSavings : undefined);
  const net = lever.netSavings; // cible nette courante — conservée
  const ws = lever.ws;
  const start = lever.start;
  const end = lever.end;
  const delivered = lever.status === "delivered";

  // --- Coûts (repartent des valeurs existantes si renseignées) ---
  const wantCapex = lever.capex > 0 ? lever.capex : rnd() < 0.6 ? net * (0.06 + rnd() * 0.12) : 0;
  const capex = r2(wantCapex);
  const oneoff = r2(lever.opexOneOff > 0 ? lever.opexOneOff : net * (0.03 + rnd() * 0.05));
  const opexRecBase = r2(lever.opexRec > 0 ? lever.opexRec : net * (0.02 + rnd() * 0.03));
  const dis = r2(Math.max(0.03, net * (0.015 + rnd() * 0.02)));
  const disIsOneoff = rnd() < 0.5;

  // --- ETP ---
  const fteDepartures = lever.fteImpact < 0 ? Math.abs(lever.fteImpact) : 0;
  const hires = !fteDepartures && rnd() < 0.3 ? 1 + Math.floor(rnd() * 2) : 0;
  const fteSalary = r2(fteDepartures * 0.075);
  const hireSalary = r2(hires * 0.085);

  // --- Gains : brut = net + OPEX récurrent (net = brut − OPEX rec), dont ETP départs. Le brut
  // définitif est recalé plus bas une fois toutes les lignes d'OPEX récurrent connues. ---
  const gross = r2(net + opexRecBase + dis + hireSalary);
  const savingsTotal = r2(Math.max(0.05, gross - fteSalary));
  const pool = SAVING_POOL[ws] ?? SAVING_POOL["WS-OPS"];
  const nLines = 2 + (rnd() < 0.5 ? 1 : 0);
  const shares = nLines === 3 ? [0.5, 0.3, 0.2] : [0.65, 0.35];
  const offsets = delivered
    ? [0, 3, 9]
    : [0, 4 + Math.floor(rnd() * 5), 12 + Math.floor(rnd() * 9)];
  const poolOrder = [...pool].sort(() => rnd() - 0.5);

  const leaf = lever.hierarchyLeafId;
  const base = {
    ...(leaf ? { hierarchyLeafId: leaf } : {}),
    pnlMap: lever.pnlMap,
    costCenter: lever.costCenter,
    entity: lever.entity,
  };
  const impacts = [];
  let n = 0;
  const id = () => `IMP-${lever.id}-ENR-${String(++n).padStart(2, "0")}`;

  let allocated = 0;
  for (let i = 0; i < nLines; i++) {
    const amt = i === nLines - 1 ? r2(savingsTotal - allocated) : r2(savingsTotal * shares[i]);
    allocated = r2(allocated + amt);
    const [label, natureId, savingType] = poolOrder[i % poolOrder.length];
    impacts.push({
      id: id(),
      label,
      type: "saving",
      nature: "opex_rec",
      amount: amt,
      natureId,
      savingType,
      gainRecurrence: "annual",
      gainDate: addMonths(clampIso(end, start, "2027-06-30"), offsets[i]),
      ...base,
    });
  }
  if (fteDepartures) {
    impacts.push({
      id: id(),
      label: `Départs non remplacés (${fteDepartures} ETP)`,
      type: "fte",
      nature: "opex_rec",
      amount: fteSalary,
      fteCount: fteDepartures,
      fteDirection: "departure",
      natureId: "nat-labor",
      gainDate: addMonths(end, 2),
      ...base,
    });
  }
  // Gain one-off ponctuel (hors annualisé) sur ~1/3 des leviers
  if (rnd() < 0.35) {
    impacts.push({
      id: id(),
      label: "Cession d'actifs / remboursement ponctuel",
      type: "saving",
      nature: "opex_rec",
      amount: r2(net * 0.08 + 0.05),
      natureId: "nat-overheads",
      savingType: "cost_reduction",
      gainRecurrence: "oneoff",
      gainDate: addMonths(end, 1),
      ...base,
    });
  }
  // Coûts
  if (capex > 0) {
    const [label, natureId] = pick(CAPEX_POOL);
    const smoothed = rnd() < 0.5;
    impacts.push({
      id: id(),
      label,
      type: "cost",
      nature: "capex",
      amount: capex,
      natureId,
      capexAllocationMode: smoothed ? "smoothed" : "one_shot",
      ...(smoothed ? { capexStartDate: start } : {}),
      capexDeploymentDate: addMonths(start, smoothed ? 6 : 3),
      ...base,
    });
  }
  {
    const [label, natureId] = pick(ONEOFF_POOL);
    impacts.push({
      id: id(),
      label,
      type: "cost",
      nature: "oneoff",
      amount: oneoff,
      natureId,
      capexDeploymentDate: addMonths(start, 2),
      ...base,
    });
  }
  {
    const [label, natureId] = pick(OPEX_POOL);
    impacts.push({
      id: id(),
      label,
      type: "cost",
      nature: "opex_rec",
      amount: opexRecBase,
      natureId,
      capexDeploymentDate: addMonths(end, 1),
      ...base,
    });
  }
  {
    const [label, natureId] = pick(DIS_POOL);
    impacts.push({
      id: id(),
      label,
      type: "cost",
      nature: disIsOneoff ? "oneoff" : "opex_rec",
      amount: dis,
      natureId,
      capexDeploymentDate: addMonths(start, 4),
      ...base,
    });
  }
  if (hires) {
    impacts.push({
      id: id(),
      label: `Recrutement (${hires} ETP) — pilotage & run`,
      type: "fte",
      nature: "opex_rec",
      amount: hireSalary,
      fteCount: hires,
      fteDirection: "hire",
      natureId: "nat-labor",
      ...base,
    });
  }

  rescaleGains(impacts, r2(net + impactTotals(impacts).opexRec));

  // --- Totaux dérivés (mêmes règles que engine.leverImpactTotals) ---
  const totals = { gross: 0, opexOneOff: 0, opexRec: 0, capex: 0, fte: 0 };
  for (const i of impacts) {
    if (i.type === "saving") {
      if (i.gainRecurrence !== "oneoff") totals.gross += i.amount;
    } else if (i.type === "fte") {
      if (i.fteDirection === "hire") {
        totals.opexRec += i.amount;
        totals.fte += i.fteCount;
      } else {
        totals.gross += i.amount;
        totals.fte -= i.fteCount;
      }
    } else if (i.nature === "capex") totals.capex += i.amount;
    else if (i.nature === "oneoff") totals.opexOneOff += i.amount;
    else totals.opexRec += i.amount;
  }
  const T = {
    grossSavings: r2(totals.gross),
    capex: r2(totals.capex),
    opexOneOff: r2(totals.opexOneOff),
    opexRec: r2(totals.opexRec),
    fteImpact: Math.round(totals.fte * 10) / 10,
  };

  // --- Snapshots : nets inchangés ; brut/coûts recalés. Plan ≠ réactualisé sur les coûts. ---
  const planCostFactor = [1, 0.85, 1.12, 0.92][Math.floor(rnd() * 4)];
  const snap = (s, factor) => {
    const cap = r2(T.capex * factor);
    const opexRec = r2(T.opexRec * (factor === 1 ? 1 : 0.9 + (factor - 0.85) * 0.3));
    return {
      ...s,
      grossSavings: r2(s.netSavings + opexRec),
      capex: cap,
      opexOneOff: r2(T.opexOneOff * factor),
      opexRec,
    };
  };
  const patch = { impacts, ...T, netSavings: r2(T.grossSavings - T.opexRec) };
  if (lever.lockedPlan) patch.lockedPlan = snap(lever.lockedPlan, planCostFactor);
  if (lever.reforecast) patch.reforecast = snap(lever.reforecast, 1);
  else if (["in_progress", "delivered"].includes(lever.status) && lever.lockedPlan) {
    patch.reforecast = snap({ ...lever.lockedPlan, netSavings: patch.netSavings }, 1);
  }
  void snapNet;
  return patch;
}

// Réactualisation supplémentaire (planifié ≠ réactualisé) quand plan figé == réactualisé.
function applyReforecastVariance(lever, patch) {
  const lp = patch.lockedPlan ?? lever.lockedPlan;
  const rf = patch.reforecast ?? lever.reforecast;
  if (
    !lp ||
    !rf ||
    lever.status !== "in_progress" ||
    Math.abs(lp.netSavings - rf.netSavings) > 0.001
  )
    return;
  const newNet = r2(rf.netSavings * 1.08);
  patch.reforecast = { ...rf, netSavings: newNet, grossSavings: r2(newNet + rf.opexRec) };
  patch.netSavings = newNet;
  patch.grossSavings = r2(newNet + patch.opexRec);
  // Répercute le +8% sur la première ligne de gain pour garder impacts == snapshot.
  const first = patch.impacts.find((i) => i.type === "saving" && i.gainRecurrence === "annual");
  first.amount = r2(
    first.amount +
      (patch.grossSavings -
        patch.impacts.reduce(
          (s, i) =>
            s +
            (i.type === "saving" && i.gainRecurrence !== "oneoff"
              ? i.amount
              : i.type === "fte" && i.fteDirection !== "hire"
                ? i.amount
                : 0),
          0
        ))
  );
}

/** Recalibre un levier déjà stocké : net inchangé, brut = net + OPEX récurrent (lever, plan figé,
 *  réactualisé) ; lignes de gain rescalées pour que les impacts bouclent sur le brut du levier. */
function buildRecalibration(lever) {
  const patch = {};
  const impacts = (lever.impacts ?? []).map((i) => ({ ...i }));
  if (impacts.length > 0) {
    const t = impactTotals(impacts);
    rescaleGains(impacts, r2(lever.netSavings + t.opexRec));
    const t2 = impactTotals(impacts);
    patch.impacts = impacts;
    patch.grossSavings = r2(t2.gross);
    patch.opexRec = r2(t2.opexRec);
    patch.netSavings = r2(t2.gross - t2.opexRec);
  } else {
    patch.grossSavings = r2(lever.netSavings + (lever.opexRec ?? 0));
  }
  for (const k of ["lockedPlan", "reforecast"]) {
    const s = lever[k];
    if (s) patch[k] = { ...s, grossSavings: r2(s.netSavings + (s.opexRec ?? 0)) };
  }
  return patch;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const restoreIdx = args.indexOf("--restore");
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error("NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant (.env.local).");
    process.exit(1);
  }
  const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if ((apply || restoreIdx >= 0) && !emu && process.env.CONFIRM_PROD_MIGRATION !== "yes") {
    console.warn("Écriture sur le VRAI projet Firebase : ajouter CONFIRM_PROD_MIGRATION=yes.");
    process.exit(1);
  }
  const { setupFirebaseCliAdc } = require("./lib/firebaseCliAdc");
  const usedCli = setupFirebaseCliAdc();
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const db = getFirestore(
    initializeApp({
      ...(usedCli ? { credential: applicationDefault() } : {}),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    })
  );

  if (restoreIdx >= 0) {
    const backup = JSON.parse(fs.readFileSync(path.resolve(args[restoreIdx + 1]), "utf8"));
    for (const [leverId, original] of Object.entries(backup.levers)) {
      const upd = {};
      for (const f of PATCH_FIELDS) upd[f] = f in original ? original[f] : FieldValue.delete();
      await db.collection("levers").doc(leverId).update(upd);
      console.log(`restauré levers/${leverId}`);
    }
    process.exit(0);
  }

  const recalibrate = args.includes("--recalibrate");
  const snap = await db.collection("levers").where("companyId", "==", COMPANY_ID).get();
  if (recalibrate) {
    const bk = { createdAt: new Date().toISOString(), companyId: COMPANY_ID, levers: {} };
    const ws = [];
    for (const d of snap.docs) {
      const lever = { id: d.id, ...d.data() };
      const patch = buildRecalibration(lever);
      const orig = {};
      for (const f of PATCH_FIELDS) if (f in lever) orig[f] = lever[f];
      bk.levers[lever.id] = orig;
      ws.push([d.ref, patch]);
      console.log(
        `${lever.id} ${lever.code} [${lever.status}] gross ${lever.grossSavings}->${patch.grossSavings} ` +
          `net ${lever.netSavings}->${patch.netSavings ?? lever.netSavings} opexRec ${lever.opexRec}->${patch.opexRec ?? lever.opexRec} ` +
          `capex ${lever.capex} (hors net)`
      );
    }
    if (!apply) {
      console.log(`\nDRY RUN recalibration : ${ws.length} leviers — relancer avec --apply.`);
      process.exit(0);
    }
    fs.mkdirSync(path.resolve(__dirname, "output"), { recursive: true });
    const file = path.resolve(__dirname, "output", `acme-recalibrate-backup-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(bk, null, 2));
    for (const [ref, patch] of ws) await ref.update(patch);
    console.log(`Écrit : ${ws.length} leviers. Sauvegarde : ${file}`);
    process.exit(0);
  }
  console.log(`${snap.size} leviers Acme — mode ${apply ? "APPLY" : "DRY RUN"}\n`);
  const backup = { createdAt: new Date().toISOString(), companyId: COMPANY_ID, levers: {} };
  const writes = [];
  const sum = { before: 0, after: 0, imp: 0, netBefore: 0 };

  for (const d of snap.docs) {
    const lever = { id: d.id, ...d.data() };
    if (lever.status === "cancelled" || (lever.impacts ?? []).length > 0) continue;
    const patch = buildEnrichment(lever);
    applyReforecastVariance(lever, patch);
    const orig = {};
    for (const f of PATCH_FIELDS) if (f in lever) orig[f] = lever[f];
    backup.levers[lever.id] = orig;
    writes.push([d.ref, patch]);
    const kinds = {};
    for (const i of patch.impacts) {
      const k =
        i.type === "cost"
          ? i.nature
          : i.type === "fte"
            ? `fte-${i.fteDirection}`
            : i.gainRecurrence === "oneoff"
              ? "gain-oneoff"
              : "gain";
      kinds[k] = (kinds[k] || 0) + 1;
    }
    const rf = (patch.reforecast ?? patch.lockedPlan ?? {}).netSavings ?? patch.netSavings;
    const lp = (patch.lockedPlan ?? {}).netSavings;
    sum.imp += patch.impacts.length;
    sum.netBefore += lever.netSavings;
    sum.after += patch.netSavings;
    console.log(
      `${lever.id} ${lever.code} [${lever.status}] impacts=${patch.impacts.length} ${JSON.stringify(kinds)} ` +
        `gross ${lever.grossSavings}->${patch.grossSavings} net ${lever.netSavings}->${patch.netSavings} ` +
        `capex ${lever.capex}->${patch.capex} oneoff ${patch.opexOneOff} opexRec ${patch.opexRec} fte ${lever.fteImpact}->${patch.fteImpact} ` +
        `plan ${lp ?? "-"} / réactualisé ${rf}`
    );
  }
  console.log(`\nLeviers à enrichir : ${writes.length}, impacts ajoutés : ${sum.imp}`);
  console.log(`Net cumulé des leviers touchés : ${r2(sum.netBefore)} -> ${r2(sum.after)} €M`);
  if (!apply) {
    console.log("DRY RUN — relancer avec --apply pour écrire.");
    process.exit(0);
  }

  fs.mkdirSync(path.resolve(__dirname, "output"), { recursive: true });
  const file = path.resolve(__dirname, "output", `acme-impacts-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`Sauvegarde : ${file}`);
  for (const [ref, patch] of writes)
    await ref.update({ ...patch, lastUpdate: new Date().toISOString().slice(0, 10) });
  console.log(
    `Écrit : ${writes.length} leviers. Annuler : node scripts/enrich-acme-impacts.js --restore ${path.relative(process.cwd(), file)}`
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
