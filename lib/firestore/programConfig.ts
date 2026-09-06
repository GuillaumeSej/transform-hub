import { doc, setDoc, onSnapshot, type Unsubscribe } from "firebase/firestore";
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
 * AUCUN seed implicite de données démo ici : une entreprise sans ProgramConfig n'en a simplement
 * pas encore ; `subscribeProgramConfig` renvoie `null` et l'appelant (voir
 * lib/hooks/useStorage.ts) doit retomber sur des valeurs vides/neutres plutôt que sur
 * `data/mockData.ts`. `forceReseedProgram` reste un utilitaire explicite (reset démo côté admin),
 * jamais invoqué automatiquement au chargement d'une page.
 */

export type ProgramConfigDoc = {
  program: ProgramConfig;
  workstreams: Workstream[];
};

/** Un document par tenant — `global` pour l'admin plateforme (companyId null). */
const tenantKey = (companyId?: string | null) => companyId ?? "global";
const programDoc = (companyId?: string | null) =>
  doc(db, "meta", `program__${tenantKey(companyId)}`);

export type ProgramSeed = ProgramConfigDoc;

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
  await setDoc(programDoc(companyId), seed);
}

/** Réécrit la config programme du tenant depuis le seed fourni — utilitaire explicite (reset
 *  démo côté admin), JAMAIS appelé automatiquement au chargement d'une page (voir
 *  lib/hooks/useStorage.ts, qui n'appelle plus `ensureProgramSeeded` : ce mécanisme d'auto-seed
 *  implicite a été supprimé, il écrivait la config mock d'Acme dans le ProgramConfig de N'IMPORTE
 *  QUELLE entreprise dès le premier chargement de page après un bump de schéma). */
export async function forceReseedProgram(
  seed: ProgramSeed,
  companyId?: string | null
): Promise<void> {
  await saveProgramConfig(seed, companyId);
}
