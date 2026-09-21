/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Prépare la chaîne de validation du Plan Stratégique d'Acme Corp (companyId "c1", programme
 * « Excellence Opérationnelle 2026-2028 », id p-strat-demo-2026) :
 *  1. profils : `axis_sponsor` pour chaque sponsor d'axe (= `StrategicAxis.owner`, rôle unique
 *     depuis la suppression de `sponsorName` — décision explicite : plus de duplication sponsor
 *     COMEX / responsable au niveau axe), `chantier_owner` pour les responsables de chantier — sur
 *     des comptes Acme EXISTANTS (doc adminUsers `${username}.c1`), en AJOUTANT le profil
 *     stratégique (limité au programme) sans toucher aux profils existants ni aux mots de passe ;
 *     aucun compte n'est créé ;
 *  2. chantiers : `pilote` (username) + `sponsorName` (sponsor de l'axe du chantier — ce champ
 *     RESTE au niveau chantier, `Chantier.sponsorName` n'est pas concerné par la suppression du
 *     doublon au niveau axe). Un pilote/sponsor déjà présent n'est conservé que s'il désigne un
 *     compte Acme existant.
 * Idempotent. Usage :
 *   node scripts/set-strategic-owners.js                          # DRY RUN (défaut)
 *   CONFIRM_PROD_MIGRATION=yes node scripts/set-strategic-owners.js --apply
 *   CONFIRM_PROD_MIGRATION=yes node scripts/set-strategic-owners.js --restore scripts/output/<backup>.json
 */
const fs = require("fs");
const path = require("path");

const COMPANY_ID = "c1";
const PROGRAM_ID = "p-strat-demo-2026";
const PROGRAM_NAME = "Excellence Opérationnelle 2026-2028";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}
loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
loadEnvFile(path.resolve(__dirname, "..", ".env.production"));

const isCandidate = (u) =>
  !u.isGlobalAdmin &&
  !u.isCompanyAdmin &&
  u.disabled !== true &&
  !/^(test|admin)\./.test(u.username);
const stratProfile = (u) =>
  (u.profiles || []).find(
    (p) =>
      [
        "axis_sponsor",
        "chantier_owner",
        "strategic_lead",
        "internal_comm",
        "budget_control",
        "comex_member",
        "chantier_contributor",
      ].includes(p.role) &&
      (!p.programId || p.programId === PROGRAM_ID)
  );

/** Plan pur : { profiles: [{username, add}], chantiers: [{id, pilote, sponsorName}] }.
 *  `sponsorOf`/`sponsors` lisent `axis.owner` (sponsor de l'axe, rôle unique) — PAS
 *  `axis.sponsorName`, qui n'existe plus sur `StrategicAxis` (seul `Chantier.sponsorName`,
 *  distinct, survit à la suppression du doublon axe). */
function plan(axes, chantiers, users) {
  const byName = new Map(users.map((u) => [u.username, u]));
  const sponsorOf = (axisId) => axes.find((a) => a.id === axisId)?.owner;
  const sponsors = new Set(axes.map((a) => a.owner).filter(Boolean));
  const owners = users
    .filter(isCandidate)
    .filter((u) => !sponsors.has(u.username) && !stratProfile(u))
    .map((u) => u.username)
    .sort();
  const pool = owners.length ? owners : [...sponsors];
  const used = new Map();
  const perAxis = new Map();
  const out = [];
  const list = [...chantiers].sort((a, b) => a.id.localeCompare(b.id));
  const orderedByAxis = list.sort(
    (a, b) =>
      (a.axisIds?.[0] ?? a.axisId ?? "").localeCompare(b.axisIds?.[0] ?? b.axisId ?? "") ||
      a.id.localeCompare(b.id)
  );
  for (const c of orderedByAxis) {
    const axisId = c.axisIds?.[0] ?? c.axisId;
    const sp = sponsorOf(axisId);
    const keepPilote = c.pilote && byName.has(c.pilote) ? c.pilote : undefined;
    const keepSponsor = c.sponsorName && byName.has(c.sponsorName) ? c.sponsorName : undefined;
    let pilote = keepPilote;
    if (!pilote) {
      const inAxis = perAxis.get(axisId) || new Set();
      pilote = [...pool]
        .filter((n) => n !== sp)
        .sort(
          (a, b) =>
            inAxis.has(a) - inAxis.has(b) ||
            (used.get(a) || 0) - (used.get(b) || 0) ||
            a.localeCompare(b)
        )[0];
    }
    used.set(pilote, (used.get(pilote) || 0) + 1);
    if (!perAxis.has(axisId)) perAxis.set(axisId, new Set());
    perAxis.get(axisId).add(pilote);
    out.push({ id: c.id, name: c.name, axisId, pilote, sponsorName: keepSponsor ?? sp });
  }
  const profiles = [];
  const want = new Map();
  for (const s of sponsors) want.set(s, "axis_sponsor");
  for (const c of out) if (!want.has(c.pilote)) want.set(c.pilote, "chantier_owner");
  for (const [username, role] of want) {
    const u = byName.get(username);
    if (!u || (u.profiles || []).some((p) => p.role === role && p.programId === PROGRAM_ID))
      continue;
    if (stratProfile(u)) continue; // un seul profil stratégique par programme
    profiles.push({ username, docId: u.docId, role, before: u.profiles || [] });
  }
  return { profiles, chantiers: out };
}
module.exports = { plan };

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
    if (backup.companyId !== COMPANY_ID) throw new Error("Sauvegarde d'une autre entreprise.");
    for (const [docId, orig] of Object.entries(backup.users)) {
      await db.collection("adminUsers").doc(docId).update({ profiles: orig.profiles });
      console.log(`restauré adminUsers/${docId}`);
    }
    for (const [id, orig] of Object.entries(backup.chantiers)) {
      await db
        .collection("chantiers")
        .doc(id)
        .update({
          pilote: "pilote" in orig ? orig.pilote : FieldValue.delete(),
          sponsorName: "sponsorName" in orig ? orig.sponsorName : FieldValue.delete(),
        });
      console.log(`restauré chantiers/${id}`);
    }
    return;
  }

  const axes = (
    await db.collection("strategicAxes").where("companyId", "==", COMPANY_ID).get()
  ).docs
    .map((d) => d.data())
    .filter((a) => a.programId === PROGRAM_ID);
  const chantiers = (
    await db.collection("chantiers").where("companyId", "==", COMPANY_ID).get()
  ).docs
    .map((d) => d.data())
    .filter((c) => c.programId === PROGRAM_ID);
  const users = (await db.collection("adminUsers").get()).docs
    .map((d) => ({ docId: d.id, ...d.data() }))
    // Ignore les comptes hérités non migrés (id = username brut) : l'app ne les charge pas.
    .filter((u) => u.companyId === COMPANY_ID && u.docId === `${u.username}.${COMPANY_ID}`);
  console.log(
    `${axes.length} axe(s), ${chantiers.length} chantier(s), ${users.length} compte(s) Acme — ${apply ? "APPLY" : "DRY RUN"}\n`
  );
  const p = plan(axes, chantiers, users);
  const todoC = p.chantiers.filter((c) => {
    const o = chantiers.find((x) => x.id === c.id);
    return o.pilote !== c.pilote || o.sponsorName !== c.sponsorName;
  });
  for (const u of p.profiles) console.log(`  profil + ${u.role} -> ${u.username}`);
  for (const c of p.chantiers)
    console.log(`  ${c.id} (${c.axisId}) pilote=${c.pilote} sponsor=${c.sponsorName}`);
  if (!p.profiles.length && !todoC.length) return console.log("Rien à faire (idempotent).");
  if (!apply) return console.log("\nDRY RUN — relancer avec --apply pour écrire.");

  const backup = {
    createdAt: new Date().toISOString(),
    companyId: COMPANY_ID,
    users: {},
    chantiers: {},
  };
  for (const u of p.profiles) backup.users[u.docId] = { profiles: u.before };
  for (const c of todoC) {
    const o = chantiers.find((x) => x.id === c.id);
    backup.chantiers[c.id] = {
      ...("pilote" in o ? { pilote: o.pilote } : {}),
      ...("sponsorName" in o ? { sponsorName: o.sponsorName } : {}),
    };
  }
  const file = path.resolve(__dirname, "output", `strategic-owners-backup-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  for (const u of p.profiles) {
    await db
      .collection("adminUsers")
      .doc(u.docId)
      .update({ profiles: [...u.before, { role: u.role, programId: PROGRAM_ID }] });
    console.log(`écrit adminUsers/${u.docId}`);
  }
  for (const c of todoC) {
    await db
      .collection("chantiers")
      .doc(c.id)
      .update({ pilote: c.pilote, sponsorName: c.sponsorName });
    console.log(`écrit chantiers/${c.id}`);
  }
  console.log(
    `Annuler : CONFIRM_PROD_MIGRATION=yes node scripts/set-strategic-owners.js --restore ${path.relative(process.cwd(), file)}`
  );
}

if (require.main === module)
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
