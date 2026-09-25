/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration (TOUTES entreprises, collection `adminUsers`) — rôles du Plan Stratégique supprimés
 * (décision PO) : `internal_comm` (Communication interne) et `budget_control` (Contrôle de
 * gestion) sont convertis en `comex_member` (Membre du COMEX, lecture seule) sur le MÊME
 * programme (`programId` conservé). Doublon exact (même rôle + même programme) retiré.
 *
 * Pas obligatoire pour que l'app fonctionne : lib/auth.ts et la liste admin (lib/firestore/admin.ts)
 * appliquent déjà la même conversion à la LECTURE (lib/roleProfiles.ts::normalizeLegacyProfiles).
 * Ce script nettoie les documents une fois pour toutes. Couvre aussi l'ancien format à champ
 * unique `role` (documents antérieurs au round multi-profils).
 *
 * Usage :
 *   node scripts/migrate-strategic-roles.js                                     # DRY RUN
 *   CONFIRM_PROD_MIGRATION=yes node scripts/migrate-strategic-roles.js --apply
 *   CONFIRM_PROD_MIGRATION=yes node scripts/migrate-strategic-roles.js --restore scripts/output/<backup>.json
 * --apply sauvegarde d'abord les champs modifiés (`profiles`/`role`) de chaque document touché.
 * Idempotent. Aucun compte Firebase Auth n'est touché.
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

const REMOVED = ["internal_comm", "budget_control"];
const REPLACEMENT = "comex_member";

/** Miroir de lib/roleProfiles.ts::normalizeLegacyProfiles. */
function normalizeProfiles(profiles) {
  const out = [];
  const seen = new Set();
  for (const p of profiles) {
    if (!p || typeof p.role !== "string") continue;
    const role = REMOVED.includes(p.role) ? REPLACEMENT : p.role;
    const key = `${role}|${p.programId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.programId ? { role, programId: p.programId } : { role });
  }
  return out;
}

/** { patch } ; patch vide = rien à faire. */
function analyse(data) {
  const patch = {};
  if (Array.isArray(data.profiles)) {
    if (data.profiles.some((p) => p && REMOVED.includes(p.role))) {
      patch.profiles = normalizeProfiles(data.profiles);
    }
  } else if (REMOVED.includes(data.role)) {
    // Ancien format (champ unique `role`) : réécrit directement au nouveau format.
    patch.role = null;
    patch.profiles = [{ role: REPLACEMENT }];
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
    for (const [id, e] of Object.entries(bk.users)) {
      const upd = {};
      for (const k of e.patchedKeys) upd[k] = k in e.original ? e.original[k] : FieldValue.delete();
      await db.collection("adminUsers").doc(id).update(upd);
      console.log(`restauré adminUsers/${id} (${e.patchedKeys.join(",")})`);
    }
    process.exit(0);
  }

  const snap = await db.collection("adminUsers").get();
  const bk = { createdAt: new Date().toISOString(), users: {} };
  const writes = [];
  for (const d of snap.docs) {
    const data = d.data();
    const patch = analyse(data);
    const keys = Object.keys(patch);
    if (keys.length === 0) continue;
    const original = {};
    for (const k of keys) if (k in data) original[k] = data[k];
    bk.users[d.id] = { patchedKeys: keys, original };
    const before = Array.isArray(data.profiles)
      ? data.profiles.map((p) => `${p.role}${p.programId ? `@${p.programId}` : ""}`).join(", ")
      : `role=${data.role}`;
    const after = patch.profiles
      .map((p) => `${p.role}${p.programId ? `@${p.programId}` : ""}`)
      .join(", ");
    console.log(`${d.id} (${data.companyId ?? "global"}) : [${before}] -> [${after}]`);
    const upd = { ...patch };
    if (upd.role === null) upd.role = FieldValue.delete();
    writes.push({ ref: d.ref, upd });
  }
  console.log(`\n${snap.size} comptes — mode ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Total à modifier : ${writes.length}`);
  if (!apply || writes.length === 0) {
    if (!apply) console.log("DRY RUN — relancer avec --apply pour écrire.");
    process.exit(0);
  }
  fs.mkdirSync(path.resolve(__dirname, "output"), { recursive: true });
  const file = path.resolve(__dirname, "output", `strategic-roles-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(bk, null, 2));
  console.log(`Sauvegarde : ${file}`);
  for (const w of writes) await w.ref.update(w.upd);
  console.log(
    `Écrit : ${writes.length} comptes. Annuler : CONFIRM_PROD_MIGRATION=yes node scripts/migrate-strategic-roles.js --restore ${path.relative(process.cwd(), file)}`
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
