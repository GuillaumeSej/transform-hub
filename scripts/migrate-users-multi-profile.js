/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration round multi-profils : convertit chaque document `adminUsers/{id}` de l'ANCIEN schéma
 * (un unique champ `role: Role`, avec les valeurs historiques "admin"/"admin_entreprise" incluses)
 * vers le NOUVEAU schéma :
 *   { profiles: [{ role, programId? }], isGlobalAdmin?: boolean, isCompanyAdmin?: boolean, ... }
 *
 * Cette migration N'EST PAS OBLIGATOIRE pour que l'app continue de fonctionner : lib/auth.ts
 * (resolveAuthUserProfile) et firestore.rules/admin-api lisent DÉJÀ les deux formats de façon
 * transparente (voir leur code — pattern `.get('isGlobalAdmin', false)` côté rules, mapping
 * legacy->new côté lib/auth.ts). Ce script sert à NETTOYER les documents existants une fois pour
 * toutes, pour que :
 *   - l'UI admin (UsersPanel) affiche des profils "propres" dès l'ouverture (pas de mapping à la
 *     volée à observer/déboguer) ;
 *   - toute future évolution du modèle n'ait plus à porter indéfiniment le code de compatibilité
 *     legacy (qui restera present tant qu'un seul document ancien format existe).
 *
 * Correspondance :
 *   role: "admin"            -> { profiles: [], isGlobalAdmin: true }
 *   role: "admin_entreprise" -> { profiles: [], isCompanyAdmin: true }
 *   role: <rôle opérationnel> (ex. "cto", "chantier_owner"...) -> { profiles: [{ role }] }
 *   déjà au nouveau format (présence d'un champ `profiles`, même vide) -> ignoré (idempotent).
 *
 * Usage (contre l'ÉMULATEUR local — aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-users-multi-profile.js
 *
 * Usage contre le VRAI projet Firebase — nécessite des identifiants de service, voir
 * scripts/create-admin.js pour le détail (GOOGLE_APPLICATION_CREDENTIALS ou
 * `gcloud auth application-default login`) :
 *   node scripts/migrate-users-multi-profile.js
 *
 * SÉCURITÉ : ce script ÉCRIT dans Firestore (pas dans Firebase Auth — aucun e-mail/uid touché ici,
 * uniquement la forme du document `adminUsers`). Pas de mode dry-run pour l'instant, au plus près
 * des scripts de migration précédents (scripts/migrate-adminusers-tenant-keys.js).
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

function legacyRoleToProfileFields(role) {
  if (role === "admin") return { profiles: [], isGlobalAdmin: true, isCompanyAdmin: false };
  if (role === "admin_entreprise")
    return { profiles: [], isGlobalAdmin: false, isCompanyAdmin: true };
  if (role) return { profiles: [{ role }], isGlobalAdmin: false, isCompanyAdmin: false };
  return { profiles: [], isGlobalAdmin: false, isCompanyAdmin: false };
}

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

  const snap = await db.collection("adminUsers").get();
  console.log(`Trouvé ${snap.size} document(s) 'adminUsers'.\n`);

  let migrated = 0;
  let alreadyMigrated = 0;
  const failures = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const docId = docSnap.id;

    if (Array.isArray(data.profiles)) {
      alreadyMigrated++;
      continue;
    }

    try {
      const { profiles, isGlobalAdmin, isCompanyAdmin } = legacyRoleToProfileFields(data.role);
      await db.doc(`adminUsers/${docId}`).update({
        profiles,
        isGlobalAdmin,
        isCompanyAdmin,
        role: require("firebase-admin/firestore").FieldValue.delete(),
      });
      console.log(
        `[OK] adminUsers/${docId} : role="${data.role}" -> profiles=${JSON.stringify(profiles)}` +
          `${isGlobalAdmin ? ", isGlobalAdmin=true" : ""}${isCompanyAdmin ? ", isCompanyAdmin=true" : ""}`
      );
      migrated++;
    } catch (err) {
      failures.push({ docId, error: err instanceof Error ? err.message : String(err) });
      console.error(`[ÉCHEC] adminUsers/${docId} :`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n──────────── Résumé ────────────");
  console.log(`Documents migrés avec succès : ${migrated}`);
  console.log(`Déjà au nouveau format (ignorés) : ${alreadyMigrated}`);
  console.log(`Échecs : ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nDétail des échecs :");
    for (const f of failures) {
      console.log(`  - adminUsers/${f.docId} : ${f.error}`);
    }
  }
  console.log("─────────────────────────────────\n");

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
