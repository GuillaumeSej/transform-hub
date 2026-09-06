/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration round 5 : fait passer chaque compte D'ENTREPRISE existant de l'ANCIEN schéma d'id
 * (`adminUsers/{username}`, e-mail synthétique `${username}@betrack.local`) au NOUVEAU schéma
 * tenant-scopé (`adminUsers/{username}.{companyId}`, e-mail synthétique
 * `${username}.${companyId}@betrack.local` — voir lib/auth.ts:usernameToSyntheticEmail/accountSlug),
 * qui permet à un même `username` humain d'avoir un compte Firebase Auth DISTINCT (mot de passe
 * séparé) par entreprise.
 *
 * Pour CHAQUE document `adminUsers/{id}` dont `companyId` n'est PAS null/absent (= compte
 * d'entreprise, jamais un admin global — ceux-là restent sous l'ancien schéma, qui EST le nouveau
 * schéma pour eux puisque `companyId` null ne suffixe jamais l'e-mail/l'id) :
 *   1. Retrouve le compte Firebase Auth existant via l'ANCIEN e-mail synthétique
 *      (`${username}@betrack.local`).
 *   2. Renomme cet e-mail (`auth.updateUser(uid, { email: nouvelEmail })`) vers
 *      `${username}.${companyId}@betrack.local` — même UID, même mot de passe, l'utilisateur se
 *      reconnecte avec le même mot de passe en sélectionnant désormais son entreprise à l'écran
 *      de connexion.
 *   3. Crée (ou met à jour, idempotent) le nouveau document Firestore
 *      `adminUsers/{username}.{companyId}` avec exactement les mêmes données que l'ancien
 *      document (le champ `username` À L'INTÉRIEUR du document reste le nom humain SANS suffixe).
 *   4. NE SUPPRIME PAS l'ancien document `adminUsers/{username}` — filet de sécurité, log en
 *      warning qu'il devient orphelin/obsolète. La suppression est un choix manuel séparé, une
 *      fois le résultat vérifié.
 *
 * Idempotent : si le compte Firebase Auth a déjà le nouvel e-mail (déjà migré), l'étape 1 échoue
 * avec 'auth/user-not-found' sur l'ANCIEN e-mail — dans ce cas on essaie directement le NOUVEL
 * e-mail ; s'il existe déjà, on saute l'étape Auth et on (re)synchronise juste le document
 * Firestore. Relançable sans casser un état déjà partiellement migré.
 *
 * Usage (contre l'ÉMULATEUR local — aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node scripts/migrate-adminusers-tenant-keys.js
 *
 * Usage contre le VRAI projet Firebase — nécessite des identifiants de service, voir
 * scripts/create-admin.js pour le détail (GOOGLE_APPLICATION_CREDENTIALS ou
 * `gcloud auth application-default login`) :
 *   node scripts/migrate-adminusers-tenant-keys.js
 *
 * SÉCURITÉ : ce script ÉCRIT des données (Firebase Auth + Firestore). Ne JAMAIS le lancer contre
 * le vrai projet sans avoir vérifié au préalable sur un export/backup — il n'y a pas de mode
 * dry-run pour l'instant (ajouter --dry-run est trivial si besoin un jour, non fait ici pour
 * rester au plus près de create-admin.js).
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

// .env.local d'abord (dev local), .env.production en repli — même convention que create-admin.js.
loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
loadEnvFile(path.resolve(__dirname, "..", ".env.production"));

// Même construction que lib/auth.ts:usernameToSyntheticEmail/accountSlug, dupliquée en JS pur car
// ce script est un module CJS Node hors Next.js (ne peut pas importer lib/auth.ts, qui est en
// ESM/TS et suppose l'environnement navigateur/Next pour ses imports dynamiques firebase/*).
function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}
function syntheticEmailOf(username, companyId) {
  const normalized = normalizeUsername(username);
  return companyId ? `${normalized}.${companyId}@betrack.local` : `${normalized}@betrack.local`;
}
function accountSlugOf(username, companyId) {
  const normalized = normalizeUsername(username);
  return companyId ? `${normalized}.${companyId}` : normalized;
}

async function main() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant) — vérifier .env.local."
    );
    process.exit(1);
  }

  const usingEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
  );
  if (!usingEmulator && process.env.CONFIRM_PROD_MIGRATION !== "yes") {
    console.warn(
      "\n⚠️  AUCUNE variable d'émulateur détectée (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST).\n" +
        "   Ce script s'apprête à ÉCRIRE dans le VRAI projet Firebase " +
        `"${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}" ET à renommer l'e-mail Firebase Auth\n` +
        "   (donc l'identifiant de connexion effectif) de comptes utilisateurs réels.\n" +
        "   Interruption volontaire. Pour tester d'abord (recommandé), positionner\n" +
        "   FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST. Pour l'exécuter VOLONTAIREMENT\n" +
        "   contre le vrai projet, ajouter CONFIRM_PROD_MIGRATION=yes.\n"
    );
    process.exit(1);
  }

  const { initializeApp } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const { getFirestore } = require("firebase-admin/firestore");

  const app = initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
  const auth = getAuth(app);
  const db = getFirestore(app);

  const snap = await db.collection("adminUsers").get();
  const candidates = snap.docs.filter((d) => {
    const data = d.data();
    return data.companyId !== null && data.companyId !== undefined && data.companyId !== "";
  });

  console.log(
    `Trouvé ${snap.size} document(s) 'adminUsers' au total, dont ${candidates.length} compte(s) d'entreprise à examiner.\n`
  );

  let migrated = 0;
  let alreadyMigrated = 0;
  const failures = [];

  for (const docSnap of candidates) {
    const data = docSnap.data();
    const oldDocId = docSnap.id;
    const username = data.username || oldDocId;
    const companyId = data.companyId;
    const newDocId = accountSlugOf(username, companyId);

    if (oldDocId === newDocId) {
      // Déjà sous le nouveau schéma (id de document déjà suffixé) — rien à faire, mais ne compte
      // pas comme "candidat legacy" au sens strict : simplement pas d'action requise.
      alreadyMigrated++;
      continue;
    }

    const oldEmail = syntheticEmailOf(username);
    const newEmail = syntheticEmailOf(username, companyId);

    try {
      // 1. Localiser puis renommer le compte Firebase Auth (même UID, même mot de passe).
      let firebaseUser;
      try {
        firebaseUser = await auth.getUserByEmail(oldEmail);
      } catch (err) {
        if (err && err.code === "auth/user-not-found") {
          // Peut-être déjà migré côté Auth (relance idempotente) : tenter le nouvel e-mail.
          firebaseUser = await auth.getUserByEmail(newEmail).catch(() => null);
          if (!firebaseUser) {
            throw new Error(
              `aucun compte Firebase Auth trouvé ni sous l'ancien e-mail (${oldEmail}) ni sous le nouveau (${newEmail})`
            );
          }
        } else {
          throw err;
        }
      }

      if (firebaseUser.email !== newEmail) {
        await auth.updateUser(firebaseUser.uid, { email: newEmail });
        console.log(`[Auth]  ${oldEmail} -> ${newEmail} (uid ${firebaseUser.uid})`);
      } else {
        console.log(`[Auth]  ${newEmail} déjà en place (uid ${firebaseUser.uid}) — inchangé.`);
      }

      // 2. Créer/mettre à jour le nouveau document Firestore (idempotent : setDoc/merge écrase
      //    avec les mêmes données à chaque relance, sans effet de bord).
      await db.doc(`adminUsers/${newDocId}`).set(data);
      console.log(
        `[Store] adminUsers/${newDocId} créé/mis à jour (copie de adminUsers/${oldDocId}).`
      );

      // 3. Ancien document conservé tel quel — filet de sécurité, suppression = choix manuel.
      console.warn(
        `[Store] adminUsers/${oldDocId} CONSERVÉ (devient orphelin/obsolète) — à supprimer manuellement une fois vérifié.\n`
      );

      migrated++;
    } catch (err) {
      failures.push({
        oldDocId,
        username,
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`[ÉCHEC] adminUsers/${oldDocId} :`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n──────────── Résumé ────────────");
  console.log(`Comptes d'entreprise migrés avec succès : ${migrated}`);
  console.log(`Déjà sous le nouveau schéma (ignorés)    : ${alreadyMigrated}`);
  console.log(`Échecs                                    : ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nDétail des échecs :");
    for (const f of failures) {
      console.log(
        `  - adminUsers/${f.oldDocId} (username="${f.username}", companyId="${f.companyId}") : ${f.error}`
      );
    }
  }
  console.log("─────────────────────────────────\n");

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
