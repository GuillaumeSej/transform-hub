/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Renseigne le SPONSOR D'AXE (`StrategicAxis.sponsorName`, un `username`) des axes du programme
 * stratégique d'Acme Corp (companyId "c1", « Excellence Opérationnelle 2026-2028 »).
 *
 * Choix des sponsors (utilisateurs EXISTANTS uniquement) : priorité aux comptes au profil
 * `axis_sponsor`, puis `comex_member`, puis autres comptes Acme actifs — toujours DISTINCTS du
 * responsable (`owner`) de l'axe et répartis en rotation (un même sponsor n'est réutilisé
 * qu'une fois les candidats épuisés). Un axe qui a déjà un sponsor n'est PAS touché (idempotent).
 *
 * Usage :
 *   node scripts/set-axis-sponsors.js                          # DRY RUN (défaut)
 *   CONFIRM_PROD_MIGRATION=yes node scripts/set-axis-sponsors.js --apply
 *   CONFIRM_PROD_MIGRATION=yes node scripts/set-axis-sponsors.js --restore scripts/output/<backup>.json
 * --apply écrit d'abord une sauvegarde JSON (sponsorName d'origine) dans scripts/output/ ;
 * --restore remet la valeur d'origine (supprime le champ s'il était absent).
 */
const fs = require("fs");
const path = require("path");

const COMPANY_ID = "c1";
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

const rank = (u) => {
  const roles = (u.profiles || []).map((p) => p.role);
  if (roles.includes("axis_sponsor")) return 0;
  if (roles.includes("comex_member")) return 1;
  return 2;
};

/** Choisit un sponsor par axe (pur) : distinct de l'owner, rotation sur les candidats classés. */
function pickSponsors(axes, users) {
  const candidates = users
    .filter(
      (u) =>
        !u.isGlobalAdmin &&
        !u.isCompanyAdmin &&
        u.disabled !== true &&
        !/^(test|admin)\./.test(u.username)
    )
    .sort((a, b) => rank(a) - rank(b) || a.username.localeCompare(b.username));
  const used = new Map();
  const out = [];
  for (const axis of axes) {
    if (axis.sponsorName) continue;
    const eligible = candidates.filter((u) => u.username !== axis.owner && u.name !== axis.owner);
    if (!eligible.length) continue;
    const best = eligible.sort(
      (a, b) =>
        (used.get(a.username) || 0) - (used.get(b.username) || 0) ||
        rank(a) - rank(b) ||
        a.username.localeCompare(b.username)
    )[0];
    used.set(best.username, (used.get(best.username) || 0) + 1);
    out.push({ axisId: axis.id, axisName: axis.name, owner: axis.owner, sponsor: best.username });
  }
  return out;
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
    for (const [axisId, orig] of Object.entries(backup.axes)) {
      await db
        .collection("strategicAxes")
        .doc(axisId)
        .update({ sponsorName: orig.sponsorName ?? FieldValue.delete() });
      console.log(`restauré strategicAxes/${axisId}`);
    }
    return;
  }

  const progSnap = await db.collection("programs").where("companyId", "==", COMPANY_ID).get();
  const program = progSnap.docs
    .map((d) => d.data())
    .find((p) => p.name === PROGRAM_NAME || p.type === "strategic");
  if (!program) {
    console.error(`Programme stratégique introuvable pour ${COMPANY_ID}.`);
    process.exit(1);
  }
  console.log(`Programme : ${program.name} (${program.id})`);

  const axesSnap = await db.collection("strategicAxes").where("companyId", "==", COMPANY_ID).get();
  const axes = axesSnap.docs.map((d) => d.data()).filter((a) => a.programId === program.id);
  const usersSnap = await db.collection("adminUsers").get();
  const users = usersSnap.docs
    .map((d) => ({ username: d.id, ...d.data() }))
    .filter((u) => u.companyId === COMPANY_ID);
  console.log(
    `${axes.length} axe(s), ${users.length} utilisateur(s) Acme — ${apply ? "APPLY" : "DRY RUN"}\n`
  );
  for (const a of axes)
    console.log(
      `  axe ${a.id} "${a.name}" owner=${a.owner ?? "-"} sponsor=${a.sponsorName ?? "-"}`
    );

  if (process.env.DUMP_USERS)
    for (const u of users)
      console.log(
        u.username,
        "|",
        u.name,
        "|",
        JSON.stringify(u.profiles),
        u.isCompanyAdmin ? "CA" : ""
      );
  const plan = pickSponsors(axes, users);
  console.log("");
  for (const p of plan)
    console.log(`  -> ${p.axisName} : sponsor ${p.sponsor} (responsable ${p.owner ?? "-"})`);
  if (!plan.length) return console.log("Rien à faire (idempotent).");
  if (!apply) return console.log("\nDRY RUN — relancer avec --apply pour écrire.");

  const backup = { createdAt: new Date().toISOString(), companyId: COMPANY_ID, axes: {} };
  for (const p of plan) {
    const orig = axes.find((a) => a.id === p.axisId);
    backup.axes[p.axisId] = "sponsorName" in orig ? { sponsorName: orig.sponsorName } : {};
  }
  const file = path.resolve(__dirname, "output", `axis-sponsors-backup-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  for (const p of plan) {
    await db.collection("strategicAxes").doc(p.axisId).update({ sponsorName: p.sponsor });
    console.log(`écrit strategicAxes/${p.axisId}`);
  }
  console.log(
    `Annuler : node scripts/set-axis-sponsors.js --restore ${path.relative(process.cwd(), file)}`
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
