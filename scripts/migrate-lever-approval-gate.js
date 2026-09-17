/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration round "portes de validation" (owner→sponsor OU cto, 3 portes M1→M2/M2→M3/M3→M4) :
 * `Lever.approval` change de forme — l'ancien modèle (`pendingStep: "sponsor"|"cto"`,
 * `ownerApprovedAt`/`sponsorApprovedAt`/`ctoApprovedAt`) est remplacé par un modèle de porte
 * (`targetStatus`, `approvedBy`/`approvedByRole`/`approvedAt`) — voir `LeverApproval` dans
 * types/index.ts et `lib/leversLogic.ts`. Ce script convertit les documents `levers/{id}`
 * ayant encore une `approval` à l'ancien format.
 *
 * L'ancien modèle ne couvrait QUE le passage M1→M2 : `targetStatus` devient donc toujours
 * "qualified". Si l'ancienne demande était déjà à l'étape "cto" (sponsor déjà passé), on
 * traduit ça en `approvedByRole: "sponsor"` informatif SANS fermer la porte — cohérent avec le
 * nouveau modèle où une seule approbation (peu importe laquelle) suffit dès qu'elle arrive ;
 * la demande reste donc en attente jusqu'à ce que sponsor OU cto agisse dans le nouveau système.
 *
 * Usage (contre l'ÉMULATEUR local — aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-lever-approval-gate.js
 *
 * Usage contre le VRAI projet Firebase — nécessite des identifiants de service, voir
 * scripts/create-admin.js pour le détail :
 *   CONFIRM_PROD_MIGRATION=yes node scripts/migrate-lever-approval-gate.js
 *
 * SÉCURITÉ : ce script ÉCRIT dans Firestore (collection `levers` uniquement). Idempotent —
 * relançable sans effet de bord (un levier déjà au nouveau format, ou sans `approval` du tout,
 * n'est jamais modifié).
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

async function main() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant) — vérifier .env.local."
    );
    process.exit(1);
  }

  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!usingEmulator && process.env.CONFIRM_PROD_MIGRATION !== "yes") {
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
  console.log(`Trouvé ${leversSnap.size} levier(s).\n`);

  let migrated = 0;
  let alreadyOk = 0;
  let noApproval = 0;

  for (const docSnap of leversSnap.docs) {
    const data = docSnap.data();
    const approval = data.approval;
    if (!approval) {
      noApproval++;
      continue;
    }
    if (!("pendingStep" in approval)) {
      // Déjà au nouveau format (a `targetStatus`), ou forme inconnue — ne rien toucher.
      alreadyOk++;
      continue;
    }

    const nextApproval = {
      targetStatus: "qualified",
      requestedBy: approval.requestedBy,
      requestedAt: approval.requestedAt,
      ...(approval.pendingStep === "cto" ? { approvedByRole: "sponsor" } : {}),
    };

    await docSnap.ref.update({ approval: nextApproval });
    console.log(
      `[OK] levers/${docSnap.id} (code="${data.code}") : approval "${approval.pendingStep}" -> ` +
        `targetStatus="qualified"${approval.pendingStep === "cto" ? " (sponsor déjà approuvé)" : ""}`
    );
    migrated++;
  }

  console.log("\n──────────── Résumé ────────────");
  console.log(`Leviers sans demande en cours       : ${noApproval}`);
  console.log(`Leviers déjà au nouveau format       : ${alreadyOk}`);
  console.log(`Leviers migrés par ce script          : ${migrated}`);
  console.log("─────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
