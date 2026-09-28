/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Tests des règles Firestore (firestore.rules) sur l'émulateur local — à lancer AVANT tout
 * déploiement de règles en production :
 *
 *   npm run test:rules
 *
 * (Java requis par l'émulateur : `brew install openjdk`, puis
 *  `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.)
 *
 * Chaque test pose un jeu de données minimal (règles désactivées), puis vérifie qu'un profil donné
 * est autorisé ou refusé. Couvre l'isolation entre entreprises, DB-11 (documents leverMeta/meta
 * non préfixés fermés), les comptes désactivés, l'échelle de confidentialité, le verrou
 * d'élévation admin, le journal admin-api et la double validation de suppression d'un levier.
 * Pour une nouvelle règle : ajouter les données dans `seed` et les cas dans `run`.
 * Déploiement ensuite : `npx firebase-tools deploy --only firestore:rules --project betrack-4a630`.
 */
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} = require("firebase/firestore");

const USERS = {
  root: { isGlobalAdmin: true, username: "root" },
  "cadmin.c1": { companyId: "c1", isCompanyAdmin: true, username: "cadmin" },
  "cadmin2.c1": { companyId: "c1", isCompanyAdmin: true, username: "cadmin2" },
  "cto.c1": { companyId: "c1", profiles: [{ role: "cto" }], username: "cto" },
  "sponsor.c1": { companyId: "c1", profiles: [{ role: "sponsor" }], username: "sponsor" },
  "off.c1": { companyId: "c1", profiles: [{ role: "cto" }], username: "off", disabled: true },
  "bob.c2": { companyId: "c2", profiles: [{ role: "cto" }], username: "bob" },
};

async function seed(db) {
  for (const [id, u] of Object.entries(USERS)) await setDoc(doc(db, "adminUsers/" + id), u);
  await setDoc(doc(db, "companies/c1"), {
    name: "Acme",
    confidentialityLevels: ["A"],
    roleClearance: {},
  });
  await setDoc(doc(db, "levers/L1"), { companyId: "c1", programId: "p1", name: "x" });
  for (const id of ["L2", "L3"])
    await setDoc(doc(db, "levers/" + id), {
      companyId: "c1",
      programId: "p1",
      deletionRequest: { requestedBy: "cto" },
    });
  await setDoc(doc(db, "levers/L4"), { companyId: "c1", programId: "p1", name: "w" });
  await setDoc(doc(db, "maturityStageConfigs/s1"), { companyId: "c1", programId: "sp1" });
  await setDoc(doc(db, "adminApiAuditLog/a1"), { companyId: "c1" });
  await setDoc(doc(db, "adminApiAuditLog/a2"), { companyId: "c2" });
  for (const id of [
    "workforceEmployees",
    "c1__workforceEmployees",
    "c2__workforceEmployees",
    "c1__displaySettings",
  ])
    await setDoc(doc(db, "leverMeta/" + id), { list: [] });
  for (const id of ["program__c1", "program__c2", "program__global", "alertsSeed"])
    await setDoc(doc(db, "meta/" + id), { x: 1 });
}

async function run(as, t) {
  const cto = as("cto.c1"),
    sp = as("sponsor.c1"),
    off = as("off.c1"),
    ca = as("cadmin.c1");
  const root = as("root"),
    bob = as("bob.c2"),
    anon = as(null);

  // Usage normal et isolation entre entreprises
  await t("cto lit un levier de son entreprise", assertSucceeds(getDoc(doc(cto, "levers/L1"))));
  await t(
    "cto modifie un levier de son entreprise",
    assertSucceeds(updateDoc(doc(cto, "levers/L1"), { name: "x2" }))
  );
  await t(
    "cto crée un levier dans son entreprise",
    assertSucceeds(setDoc(doc(cto, "levers/L9"), { companyId: "c1", programId: "p1" }))
  );
  await t("un utilisateur c2 NE lit PAS un levier c1", assertFails(getDoc(doc(bob, "levers/L1"))));
  await t("cto lit son propre profil", assertSucceeds(getDoc(doc(cto, "adminUsers/cto.c1"))));
  await t("admin d'entreprise lit sa société", assertSucceeds(getDoc(doc(ca, "companies/c1"))));

  // DB-11 : leverMeta / meta
  await t(
    "cto lit c1__workforceEmployees",
    assertSucceeds(getDoc(doc(cto, "leverMeta/c1__workforceEmployees")))
  );
  await t(
    "cto écrit c1__displaySettings",
    assertSucceeds(setDoc(doc(cto, "leverMeta/c1__displaySettings"), { a: 1 }))
  );
  await t(
    "cto NE lit PAS un document leverMeta non préfixé",
    assertFails(getDoc(doc(cto, "leverMeta/workforceEmployees")))
  );
  await t(
    "cto N'écrit PAS un document leverMeta non préfixé",
    assertFails(setDoc(doc(cto, "leverMeta/workforceEmployees"), { list: [] }))
  );
  await t(
    "cto NE lit PAS c2__workforceEmployees",
    assertFails(getDoc(doc(cto, "leverMeta/c2__workforceEmployees")))
  );
  await t(
    "anonyme NE lit PAS c1__workforceEmployees",
    assertFails(getDoc(doc(anon, "leverMeta/c1__workforceEmployees")))
  );
  await t("cto lit meta/program__c1", assertSucceeds(getDoc(doc(cto, "meta/program__c1"))));
  await t(
    "cto écrit meta/program__c1",
    assertSucceeds(setDoc(doc(cto, "meta/program__c1"), { x: 2 }))
  );
  await t("cto NE lit PAS meta/program__c2", assertFails(getDoc(doc(cto, "meta/program__c2"))));
  await t(
    "cto NE lit PAS un autre document meta",
    assertFails(getDoc(doc(cto, "meta/alertsSeed")))
  );
  await t(
    "cto NE lit PAS meta/program__global",
    assertFails(getDoc(doc(cto, "meta/program__global")))
  );
  await t(
    "admin global lit meta/program__global",
    assertSucceeds(getDoc(doc(root, "meta/program__global")))
  );
  await t(
    "admin global lit c2__workforceEmployees",
    assertSucceeds(getDoc(doc(root, "leverMeta/c2__workforceEmployees")))
  );
  await t(
    "admin global NE lit PAS un document leverMeta non préfixé",
    assertFails(getDoc(doc(root, "leverMeta/workforceEmployees")))
  );

  // Comptes désactivés
  await t("compte désactivé : lit encore", assertSucceeds(getDoc(doc(off, "levers/L1"))));
  await t(
    "compte désactivé : NE modifie PAS",
    assertFails(updateDoc(doc(off, "levers/L1"), { name: "hack" }))
  );

  // Échelle de confidentialité
  await t(
    "admin d'entreprise modifie roleClearance",
    assertSucceeds(updateDoc(doc(ca, "companies/c1"), { roleClearance: { cto: "A" } }))
  );
  await t(
    "admin d'entreprise NE modifie PAS confidentialityLevels",
    assertFails(updateDoc(doc(ca, "companies/c1"), { confidentialityLevels: ["A", "B"] }))
  );
  await t(
    "admin global modifie confidentialityLevels",
    assertSucceeds(updateDoc(doc(root, "companies/c1"), { confidentialityLevels: ["A", "B"] }))
  );

  // Verrou d'élévation (adminUsers)
  await t(
    "admin d'entreprise crée un utilisateur normal",
    assertSucceeds(setDoc(doc(ca, "adminUsers/new.c1"), { companyId: "c1", username: "new" }))
  );
  await t(
    "admin d'entreprise NE crée PAS d'admin global",
    assertFails(setDoc(doc(ca, "adminUsers/evil.c1"), { companyId: "c1", isGlobalAdmin: true }))
  );
  await t(
    "admin d'entreprise NE se promeut PAS admin global",
    assertFails(updateDoc(doc(ca, "adminUsers/cadmin.c1"), { isGlobalAdmin: true }))
  );
  await t(
    "admin d'entreprise NE modifie PAS un admin global",
    assertFails(updateDoc(doc(ca, "adminUsers/root"), { companyId: "c1", name: "x" }))
  );
  await t(
    "admin d'entreprise NE déplace PAS un utilisateur vers une autre entreprise",
    assertFails(updateDoc(doc(ca, "adminUsers/cto.c1"), { companyId: "c2" }))
  );
  await t(
    "admin d'entreprise modifie un utilisateur normal",
    assertSucceeds(updateDoc(doc(ca, "adminUsers/cto.c1"), { firstName: "Z" }))
  );
  await t(
    "admin d'entreprise NE retire PAS l'admin d'un pair",
    assertFails(updateDoc(doc(ca, "adminUsers/cadmin2.c1"), { isCompanyAdmin: false }))
  );
  await t(
    "admin d'entreprise NE désactive PAS un pair",
    assertFails(updateDoc(doc(ca, "adminUsers/cadmin2.c1"), { disabled: true }))
  );
  await t(
    "admin d'entreprise NE supprime PAS un pair",
    assertFails(deleteDoc(doc(ca, "adminUsers/cadmin2.c1")))
  );
  await t(
    "admin d'entreprise supprime un utilisateur normal",
    assertSucceeds(deleteDoc(doc(ca, "adminUsers/new.c1")))
  );
  await t(
    "admin global retire l'admin d'un admin d'entreprise",
    assertSucceeds(updateDoc(doc(root, "adminUsers/cadmin2.c1"), { isCompanyAdmin: false }))
  );

  // Journal admin-api
  await t(
    "admin d'entreprise lit le journal de son entreprise",
    assertSucceeds(getDoc(doc(ca, "adminApiAuditLog/a1")))
  );
  await t(
    "admin d'entreprise NE lit PAS le journal d'une autre",
    assertFails(getDoc(doc(ca, "adminApiAuditLog/a2")))
  );
  await t("cto NE lit PAS le journal", assertFails(getDoc(doc(cto, "adminApiAuditLog/a1"))));
  await t(
    "personne n'écrit le journal depuis le client",
    assertFails(setDoc(doc(root, "adminApiAuditLog/a3"), { companyId: "c1" }))
  );

  // DB-12 : étapes de maturité d'un programme (création d'un programme stratégique)
  const stagesOf = (db, withCompany) =>
    getDocs(
      query(
        collection(db, "maturityStageConfigs"),
        where("programId", "==", "sp1"),
        ...(withCompany ? [where("companyId", "==", "c1")] : [])
      )
    );
  await t(
    "admin d'entreprise lit les étapes filtrées par entreprise",
    assertSucceeds(stagesOf(ca, true))
  );
  await t("requête d'étapes sans filtre entreprise refusée", assertFails(stagesOf(ca, false)));

  // Double validation de suppression d'un levier
  await t("suppression sans demande refusée", assertFails(deleteDoc(doc(cto, "levers/L1"))));
  await t(
    "le demandeur NE confirme PAS sa propre demande",
    assertFails(deleteDoc(doc(cto, "levers/L2")))
  );
  await t(
    "une autre personne confirme la suppression",
    assertSucceeds(deleteDoc(doc(sp, "levers/L2")))
  );
  await t("une autre entreprise NE supprime PAS", assertFails(deleteDoc(doc(bob, "levers/L3"))));
  await t("admin global supprime sans demande", assertSucceeds(deleteDoc(doc(root, "levers/L4"))));
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-betrack-rules",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
  await env.withSecurityRulesDisabled((ctx) => seed(ctx.firestore()));
  const as = (u) =>
    u
      ? env.authenticatedContext(u, { email: `${u}@betrack.app` }).firestore()
      : env.unauthenticatedContext().firestore();
  const results = [];
  const t = async (name, p) => {
    try {
      await p;
      results.push(`  ✓ ${name}`);
    } catch (e) {
      results.push(`  ✗ ${name} — ${e.message}`);
    }
  };
  await run(as, t);
  await env.cleanup();
  const failed = results.filter((r) => r.startsWith("  ✗")).length;
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed}/${results.length} tests de règles OK`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
