import { doc, getDoc, setDoc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import type { ProgramConfig, Workstream } from "@/types";

/**
 * Couche Firestore pour la configuration programme (ProgramConfig + Workstreams) — dernier
 * périmètre de données métier qui vivait en localStorage (lib/storage.ts, supprimé) : deux
 * utilisateurs ne voyaient pas le même nom de programme ni les mêmes workstreams selon leur
 * navigateur. Désormais partagé en temps réel comme le reste.
 *
 * Stockage en UN document par entreprise sous `meta/` (`meta/program__{companyId}`) : la
 * collection `meta` est déjà autorisée par les règles Firestore déployées — une collection
 * racine dédiée serait refusée tant que les règles ne sont pas redéployées (accès Firebase CLI
 * pas toujours disponible, même contrainte que lib/firestore/workforce.ts).
 *
 * Ces données sont des référentiels quasi statiques (aucune mutation dans l'UI aujourd'hui,
 * seulement le seed et le reset démo) — le subscribe sert surtout à ce qu'un reset de démo
 * sur un poste se propage aux autres.
 */

// Incrémenter force un reseed du périmètre programme (schéma modifié).
const SCHEMA_VERSION = "1";

export type ProgramConfigDoc = {
  program: ProgramConfig;
  workstreams: Workstream[];
  schemaVersion: string;
};

/** Un document par tenant — `global` pour l'admin plateforme (companyId null). */
const tenantKey = (companyId?: string | null) => companyId ?? "global";
const programDoc = (companyId?: string | null) =>
  doc(db, "meta", `program__${tenantKey(companyId)}`);

export type ProgramSeed = Omit<ProgramConfigDoc, "schemaVersion">;

export function subscribeProgramConfig(
  cb: (config: ProgramSeed | null) => void,
  companyId?: string | null
): Unsubscribe {
  return onSnapshot(
    programDoc(companyId),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      const data = snap.data() as ProgramConfigDoc;
      cb({ program: data.program, workstreams: data.workstreams });
    },
    onListenerError("programConfig")
  );
}

export async function saveProgramConfig(
  seed: ProgramSeed,
  companyId?: string | null
): Promise<void> {
  await setDoc(programDoc(companyId), { ...seed, schemaVersion: SCHEMA_VERSION });
}

/** Réécrit la config programme du tenant depuis le seed — utilisé par le reset démo. */
export async function forceReseedProgram(
  seed: ProgramSeed,
  companyId?: string | null
): Promise<void> {
  await saveProgramConfig(seed, companyId);
}

/** Amorce la config programme si absente ou d'un schéma antérieur — idempotent. */
export async function ensureProgramSeeded(
  seed: ProgramSeed,
  companyId?: string | null
): Promise<void> {
  const snap = await getDoc(programDoc(companyId));
  if (snap.exists() && snap.data().schemaVersion === SCHEMA_VERSION) return;
  await forceReseedProgram(seed, companyId);
}
