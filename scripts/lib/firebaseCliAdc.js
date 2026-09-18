/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Réutilise la session `firebase login` existante de l'opérateur (CLI firebase-tools) comme
 * Application Default Credentials pour firebase-admin, sans clé de compte de service dédiée.
 *
 *   1. Lit `~/.config/configstore/firebase-tools.json` — où firebase-tools stocke le
 *      `refresh_token` OAuth obtenu au dernier `firebase login`.
 *   2. Reconstruit un credential `authorized_user` avec le client_id/client_secret PUBLICS de
 *      l'app CLI officielle Firebase (mêmes valeurs que firebase-tools lui-même, pas un secret
 *      applicatif) + ce refresh_token, écrit dans un fichier JSON temporaire.
 *   3. Positionne `GOOGLE_APPLICATION_CREDENTIALS` sur ce fichier — `applicationDefault()` du
 *      SDK Admin ira le chercher automatiquement.
 *
 * Résultat : `initializeApp({ credential: applicationDefault(), projectId })` ouvre une session
 * Firestore avec les droits Google de l'opérateur (ceux avec lesquels il est loggé sur
 * `firebase-tools`), pas via une clé de service séparée. Ne rien faire (retourne false) si
 * `firebase login` n'a jamais été fait sur cette machine — l'appelant retombe alors sur les ADC
 * standard (gcloud/service account), voir chaque script.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

// client_id/client_secret publics de l'app OAuth "Firebase CLI" — identiques à ceux embarqués
// dans firebase-tools (github.com/firebase/firebase-tools), pas un secret propre à ce projet.
const FIREBASE_CLI_OAUTH_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_OAUTH_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

function setupFirebaseCliAdc() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIRESTORE_EMULATOR_HOST) {
    return false; // des identifiants explicites (ou l'émulateur) sont déjà en place, ne rien écraser
  }

  const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  if (!fs.existsSync(configPath)) return false;

  let refreshToken;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    refreshToken = config?.tokens?.refresh_token;
  } catch {
    return false;
  }
  if (!refreshToken) return false;

  const credential = {
    type: "authorized_user",
    client_id: FIREBASE_CLI_OAUTH_CLIENT_ID,
    client_secret: FIREBASE_CLI_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
  };

  const tmpFile = path.join(os.tmpdir(), `betrack-firebase-cli-adc-${process.pid}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(credential), { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpFile;
  process.on("exit", () => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // déjà supprimé / non bloquant
    }
  });
  return true;
}

module.exports = { setupFirebaseCliAdc };
