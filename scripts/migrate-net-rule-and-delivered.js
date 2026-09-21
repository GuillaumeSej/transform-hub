/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration (TOUTES entreprises / programmes, collection `levers`) — 3 règles métier :
 *  1. NET = BRUT − OPEX RÉCURRENT (CAPEX et one-off hors net). Net inchangé ; grossSavings recalé
 *     (levier, lockedPlan, reforecast, lignes de gain des impacts si présentes). Leviers annulés ignorés.
 *  2. « Réalisé » (clé `delivered`) exige TOUTES les actions à 100 % (lib/leversLogic.ts
 *     allActionsDone/enforceDeliveredRule) sinon retour à « Exécuté » (clé `in_progress`) + entrée d'audit
 *     (leverMeta/{companyId}__auditLog). Levier sans action : non concerné.
 *  3. Impact sans date de début : date = début du levier (sinon 1re action, sinon createdAt) ; `status`
 *     posé (impactStatusOf : one-shot passé=done, récurrent passé=ongoing, futur=planned) SEULEMENT si le
 *     levier est au moins « Exécuté » (in_progress/delivered) ; sinon statut laissé dérivé.
 *
 * Usage :
 *   node scripts/migrate-net-rule-and-delivered.js                                  # DRY RUN
 *   CONFIRM_PROD_MIGRATION=yes node scripts/migrate-net-rule-and-delivered.js --apply
 *   CONFIRM_PROD_MIGRATION=yes node scripts/migrate-net-rule-and-delivered.js --restore scripts/output/<backup>.json
 * --apply sauvegarde d'abord les documents levier complets touchés + les entrées d'audit ajoutées.
 * Idempotent. Aucune autre donnée n'est modifiée (pas même lastUpdate).
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

const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 0.005;
const ACTION_STATUS_WEIGHT = { done: 100, todo: 0, in_progress: 50, delayed: 0 };
const actionPct = (a) =>
  typeof a.declaredProgressPct === "number"
    ? Math.min(100, Math.max(0, a.declaredProgressPct))
    : (ACTION_STATUS_WEIGHT[a.status] ?? 0);
const allActionsDone = (l) => (l.actions ?? []).every((a) => actionPct(a) >= 100);

// --- impacts (miroir de lib/engine.ts::leverImpactTotals et lib/impactStatus.ts) ---
const isRecurring = (i) =>
  i.type === "fte"
    ? true
    : i.type === "saving"
      ? i.gainRecurrence !== "oneoff"
      : i.nature === "opex_rec";
const isGainLike = (i) =>
  i.type === "saving" || (i.type === "fte" && i.fteDirection === "departure");
const startOf = (i) => (isGainLike(i) ? i.gainDate : (i.capexStartDate ?? i.capexDeploymentDate));
function totals(impacts) {
  const t = { gross: 0, fteGross: 0, opexRec: 0 };
  for (const i of impacts) {
    if (i.type === "saving") {
      if (i.gainRecurrence !== "oneoff") t.gross += i.amount;
    } else if (i.type === "fte") {
      if (i.fteDirection === "hire") t.opexRec += i.amount;
      else {
        t.gross += i.amount;
        t.fteGross += i.amount;
      }
    } else if (i.nature === "capex" || i.nature === "oneoff") {
      /* hors net */
    } else t.opexRec += i.amount;
  }
  return t;
}
function rescaleGains(impacts, targetGross) {
  const t = totals(impacts);
  const lines = impacts.filter((i) => i.type === "saving" && i.gainRecurrence !== "oneoff");
  if (lines.length === 0) return false;
  const want = Math.max(0.05, r2(targetGross - t.fteGross));
  const cur = lines.reduce((s, i) => s + i.amount, 0) || 1;
  let allocated = 0;
  lines.forEach((i, k) => {
    i.amount = k === lines.length - 1 ? r2(want - allocated) : r2((i.amount * want) / cur);
    allocated = r2(allocated + i.amount);
  });
  return true;
}
function statusOf(imp, today) {
  const start = startOf(imp);
  const rec = isRecurring(imp);
  if (!start) return "planned";
  const d = new Date(start);
  if (Number.isNaN(d.getTime()) || d > today) return "planned";
  return rec ? "ongoing" : "done";
}

/** Renvoie { patch, rules:{net,delivered,dates}, notes } ; patch vide = rien à faire. */
function analyse(lever, today) {
  const patch = {};
  const rules = { net: false, delivered: false, dates: 0 };
  const notes = [];
  if (lever.status === "cancelled") return { patch, rules, notes };
  const net = lever.netSavings;

  // Règle 2 d'abord (le statut conditionne la règle 3)
  let status = lever.status;
  if (status === "delivered" && (lever.actions ?? []).length > 0 && !allActionsDone(lever)) {
    status = "in_progress";
    patch.status = status;
    rules.delivered = true;
  }

  // Source des lignes d'impact : lever.impacts, sinon repli legacy actions[].impacts (comme leverImpactsOf)
  const hasLeverImpacts = (lever.impacts ?? []).length > 0;
  const legacy = !hasLeverImpacts && (lever.actions ?? []).some((a) => (a.impacts ?? []).length);
  const acts = legacy
    ? lever.actions.map((a) => ({ ...a, impacts: (a.impacts ?? []).map((i) => ({ ...i })) }))
    : null;
  const impacts = hasLeverImpacts
    ? lever.impacts.map((i) => ({ ...i }))
    : legacy
      ? acts.flatMap((a) => a.impacts)
      : [];
  const hasImpacts = impacts.length > 0;
  let impactsChanged = false;

  // Règle 1
  let opexRec = lever.opexRec ?? 0;
  if (hasImpacts) {
    const t = totals(impacts);
    opexRec = r2(t.opexRec);
    if (Math.abs(t.gross - t.opexRec - net) > EPS) {
      if (rescaleGains(impacts, r2(net + t.opexRec))) {
        impactsChanged = true;
        rules.net = true;
      } else notes.push("aucune ligne de gain à recaler");
    }
    if (Math.abs((lever.opexRec ?? 0) - opexRec) > EPS)
      notes.push(`opexRec levier ${lever.opexRec} != impacts ${opexRec} (non touché)`);
  }
  const wantGross = r2(net + opexRec);
  if (Math.abs((lever.grossSavings ?? 0) - wantGross) > EPS) {
    patch.grossSavings = wantGross;
    rules.net = true;
  }
  for (const k of ["lockedPlan", "reforecast"]) {
    const s = lever[k];
    if (!s) continue;
    const g = r2(s.netSavings + (s.opexRec ?? 0));
    if (Math.abs((s.grossSavings ?? 0) - g) > EPS) {
      patch[k] = { ...s, grossSavings: g };
      rules.net = true;
    }
  }

  // Règle 3
  const firstActionStart = (lever.actions ?? [])
    .map((a) => a.start)
    .filter(Boolean)
    .sort()[0];
  const fallback = lever.start || firstActionStart || (lever.createdAt ?? "").slice(0, 10);
  const exec = status === "in_progress" || status === "delivered";
  for (const imp of impacts) {
    if (startOf(imp) || !fallback) continue;
    if (isGainLike(imp)) imp.gainDate = fallback;
    else imp.capexDeploymentDate = fallback;
    if (exec && !imp.status) imp.status = statusOf(imp, today);
    rules.dates++;
    impactsChanged = true;
  }
  if (impactsChanged) {
    if (hasLeverImpacts) patch.impacts = impacts;
    else patch.actions = acts;
  }
  return { patch, rules, notes };
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
  const usedCli = require("./lib/firebaseCliAdc").setupFirebaseCliAdc();
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const db = getFirestore(
    initializeApp({
      ...(usedCli ? { credential: applicationDefault() } : {}),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    })
  );

  if (restoreIdx >= 0) {
    const bk = JSON.parse(fs.readFileSync(path.resolve(args[restoreIdx + 1]), "utf8"));
    for (const [id, e] of Object.entries(bk.levers)) {
      const upd = {};
      for (const k of e.patchedKeys) upd[k] = k in e.original ? e.original[k] : FieldValue.delete();
      await db.collection("levers").doc(id).update(upd);
      console.log(`restauré levers/${id} (${e.patchedKeys.join(",")})`);
    }
    for (const [cid, entries] of Object.entries(bk.auditAdded)) {
      await db
        .doc(`leverMeta/${cid}__auditLog`)
        .set({ entries: FieldValue.arrayRemove(...entries) }, { merge: true });
      console.log(`audit ${cid} : ${entries.length} entrée(s) retirée(s)`);
    }
    process.exit(0);
  }

  const today = new Date();
  const now = today.toISOString();
  const snap = await db.collection("levers").get();
  const perCo = {};
  const bk = { createdAt: now, levers: {}, auditAdded: {}, fullDocs: {} };
  const writes = [];
  for (const d of snap.docs) {
    const lever = { id: d.id, ...d.data() };
    const co = lever.companyId ?? "(none)";
    const c = (perCo[co] ??= {
      total: snap.docs.length && 0,
      net: 0,
      delivered: 0,
      dates: 0,
      touched: 0,
      notes: [],
    });
    c.total++;
    const { patch, rules, notes } = analyse(lever, today);
    for (const n of notes) c.notes.push(`${lever.code ?? lever.id}: ${n}`);
    const keys = Object.keys(patch);
    if (keys.length === 0) continue;
    c.touched++;
    if (rules.net) c.net++;
    if (rules.delivered) {
      c.delivered++;
      console.log(`[delivered->in_progress] ${co} ${lever.code ?? lever.id} ${lever.name ?? ""}`);
    }
    if (rules.dates) c.dates++;
    const original = {};
    for (const k of keys) if (k in lever) original[k] = lever[k];
    bk.levers[lever.id] = { patchedKeys: keys, original };
    bk.fullDocs[lever.id] = d.data();
    writes.push({ ref: d.ref, patch, lever, rules, co });
    if (rules.delivered && lever.companyId) {
      (bk.auditAdded[lever.companyId] ??= []).push({
        ts: now,
        user: "migration",
        action: "updated",
        entity: lever.id,
        field: "status",
        old: "delivered",
        new: "in_progress",
      });
    }
  }
  console.log(`\n${snap.size} leviers — mode ${apply ? "APPLY" : "DRY RUN"}`);
  for (const [co, c] of Object.entries(perCo))
    console.log(
      `${co}: ${c.total} leviers, touchés ${c.touched} | net ${c.net} | réalisé→exécuté ${c.delivered} | impacts sans date (leviers) ${c.dates}` +
        (c.notes.length ? `\n   notes: ${c.notes.join(" ; ")}` : "")
    );
  console.log(`Total à modifier : ${writes.length}`);
  if (!apply || writes.length === 0) {
    if (!apply) console.log("DRY RUN — relancer avec --apply pour écrire.");
    process.exit(0);
  }
  fs.mkdirSync(path.resolve(__dirname, "output"), { recursive: true });
  const file = path.resolve(__dirname, "output", `net-rule-delivered-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(bk, null, 2));
  console.log(`Sauvegarde : ${file}`);
  for (const w of writes) await w.ref.update(w.patch);
  for (const [cid, entries] of Object.entries(bk.auditAdded))
    await db
      .doc(`leverMeta/${cid}__auditLog`)
      .set({ entries: FieldValue.arrayUnion(...entries) }, { merge: true });
  console.log(
    `Écrit : ${writes.length} leviers. Annuler : CONFIRM_PROD_MIGRATION=yes node scripts/migrate-net-rule-and-delivered.js --restore ${path.relative(process.cwd(), file)}`
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
