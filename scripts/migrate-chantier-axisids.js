/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Rattrapage round "multi-axe chantier" (round 24) : `Chantier.axisId: string` est devenu
 * `Chantier.axisIds: string[]` (voir types/index.ts) — un chantier n'appartient plus à exactement
 * UN axe mais à un ou plusieurs. Ce script rattache rétroactivement les chantiers existants qui
 * n'ont encore que l'ancien champ scalaire, pour que la base de données respecte elle aussi le
 * nouveau modèle.
 *
 * Pour CHAQUE document `chantiers/{id}` qui a un `axisId` (string, ancien champ) MAIS PAS ENCORE
 * de `axisIds` (tableau) : écrit `axisIds: [axisId]`.
 *
 * NE SUPPRIME RIEN : l'ancien champ `axisId` est laissé tel quel sur le document (résidu inerte,
 * plus jamais lu par le code applicatif depuis ce round — voir `types/index.ts`) plutôt que
 * retiré, même politique que les migrations précédentes de ce dossier (ex.
 * `migrate-lever-meta-tenant-split.js`, qui laisse aussi les anciens documents mutualisés intacts).
 *
 * Idempotent — un chantier qui a DÉJÀ `axisIds` n'est jamais retouché, qu'il ait ou non encore
 * `axisId` en plus : relancer ce script après coup (ou après un import Excel qui écrit déjà
 * `axisIds` directement) ne fait rien de plus.
 *
 * Usage (contre l'ÉMULATEUR local — aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-chantier-axisids.js
 *
 * Usage contre le VRAI projet Firebase — nécessite des identifiants de service, voir
 * scripts/create-admin.js pour le détail (GOOGLE_APPLICATION_CREDENTIALS ou
 * `gcloud auth application-default login`) :
 *   CONFIRM_PROD_MIGRATION=yes node scripts/migrate-chantier-axisids.js
 *
 * SÉCURITÉ : ce script ÉCRIT dans Firestore (collection `chantiers` uniquement). Idempotent —
 * relançable sans effet de bord (un chantier qui a déjà `axisIds` n'est jamais modifié).
 *
 * NE PAS EXÉCUTER sans accord explicite préalable — voir la demande round 24 : ce script est
 * livré prêt à l'emploi mais volontairement PAS lancé automatiquement.
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

  const chantiersSnap = await db.collection("chantiers").get();

  console.log(`Trouvé ${chantiersSnap.size} chantier(s).\n`);

  let fixed = 0;
  let alreadyOk = 0;
  const skipped = [];

  for (const docSnap of chantiersSnap.docs) {
    const data = docSnap.data();

    if (Array.isArray(data.axisIds) && data.axisIds.length > 0) {
      alreadyOk++;
      continue;
    }

    const legacyAxisId = data.axisId;
    if (!legacyAxisId || typeof legacyAxisId !== "string") {
      // Ni `axisIds` ni `axisId` legacy exploitable — rien à dériver, résolution manuelle requise
      // (ne devrait normalement jamais arriver : `axisId` était un champ obligatoire avant ce
      // round).
      skipped.push({
        id: docSnap.id,
        name: data.name,
        companyId: data.companyId ?? null,
        reason: "ni `axisIds` ni `axisId` legacy exploitable sur ce document",
      });
      continue;
    }

    await docSnap.ref.update({ axisIds: [legacyAxisId] });
    console.log(
      `[OK] chantiers/${docSnap.id} (name="${data.name}") -> axisIds=["${legacyAxisId}"]`
    );
    fixed++;
  }

  console.log("\n──────────── Résumé ────────────");
  console.log(`Chantiers déjà migrés (axisIds présent)     : ${alreadyOk}`);
  console.log(`Chantiers migrés par ce script               : ${fixed}`);
  console.log(`Chantiers ignorés (résolution manuelle)      : ${skipped.length}`);
  if (skipped.length > 0) {
    console.log("\nDétail des chantiers ignorés :");
    for (const s of skipped) {
      console.log(
        `  - chantiers/${s.id} (name="${s.name}", companyId="${s.companyId}") : ${s.reason}`
      );
    }
  }
  console.log("─────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
