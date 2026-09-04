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
import type { Indicator } from "@/types";

/**
 * CRUD temps réel des indicateurs (KPI) du Plan Stratégique. Même pattern que
 * `lib/firestore/strategicAxes.ts` / `subscribeHierarchyNodes`.
 */

const indicatorsCol = () => collection(db, "indicators");

export function subscribeIndicators(
  companyId: string,
  cb: (indicators: Indicator[]) => void
): Unsubscribe {
  const scopedQuery = query(indicatorsCol(), where("companyId", "==", companyId));
  const handleError = onListenerError("indicators");
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      cb(snap.docs.map((d) => d.data() as Indicator));
    },
    (error) => {
      handleError(error);
      // Ne jamais laisser un appelant attendre indéfiniment un premier résultat qui ne viendra
      // jamais (permission-denied, règles pas encore déployées) — voir useStrategicData.
      cb([]);
    }
  );
}

export async function saveIndicator(indicator: Indicator): Promise<void> {
  await setDoc(doc(indicatorsCol(), indicator.id), indicator);
}

export async function deleteIndicator(id: string): Promise<void> {
  await deleteDoc(doc(indicatorsCol(), id));
}
