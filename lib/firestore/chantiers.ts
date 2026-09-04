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
      cb(snap.docs.map((d) => d.data() as Chantier));
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
