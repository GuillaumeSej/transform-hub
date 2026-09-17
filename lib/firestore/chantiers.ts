import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import type { Chantier } from "@/types";

/**
 * CRUD temps réel des chantiers (niveau intermédiaire Axe → Chantier → Action du Plan
 * Stratégique). Même pattern que `lib/firestore/strategicAxes.ts` / `subscribeHierarchyNodes`.
 */

const chantiersCol = () => collection(db, "chantiers");

/**
 * Round 24 : `Chantier.axisId` (scalaire) est devenu `axisIds` (tableau) — mais des documents
 * Firestore existants, écrits avant ce round, n'ont encore que l'ancien champ `axisId` (le
 * script de rattrapage `scripts/migrate-chantier-axisids.js` corrige ça en base, mais n'est pas
 * garanti d'avoir tourné sur toutes les données déjà en place). Sans ce filet, tout le code aval
 * qui appelle `.includes()`/`.map()` sur `axisIds` plante sur un document encore au format
 * legacy. Normalisé une seule fois ici, à la frontière de lecture, plutôt que dans chaque
 * consommateur. */
function normalizeChantier(raw: Record<string, unknown>): Chantier {
  if (Array.isArray(raw.axisIds) && raw.axisIds.length > 0) return raw as Chantier;
  const legacyAxisId = raw.axisId;
  return {
    ...raw,
    axisIds: typeof legacyAxisId === "string" ? [legacyAxisId] : [],
  } as Chantier;
}

export function subscribeChantiers(
  companyId: string,
  cb: (chantiers: Chantier[]) => void
): Unsubscribe {
  const scopedQuery = query(chantiersCol(), where("companyId", "==", companyId));
  const handleError = onListenerError("chantiers");
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      cb(snap.docs.map((d) => normalizeChantier(d.data())));
    },
    (error) => {
      handleError(error);
      // Ne jamais laisser un appelant attendre indéfiniment un premier résultat qui ne viendra
      // jamais (permission-denied, règles pas encore déployées) — voir useStrategicData.
      cb([]);
    }
  );
}

export async function saveChantier(chantier: Chantier): Promise<void> {
  await setDoc(doc(chantiersCol(), chantier.id), chantier);
}

export async function deleteChantier(id: string): Promise<void> {
  await deleteDoc(doc(chantiersCol(), id));
}
