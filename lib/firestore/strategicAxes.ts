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
import type { StrategicAxis } from "@/types";

/**
 * CRUD temps réel des axes stratégiques (Plan Stratégique). Même pattern que
 * `subscribeHierarchyNodes` dans `lib/firestore/admin.ts` : filtrage par entreprise CÔTÉ SERVEUR
 * (`where("companyId","==",...)`), `includeMetadataChanges` + garde `hasPendingWrites` pour ne
 * jamais présenter une écriture locale non acquittée comme enregistrée (évite les lignes fantômes
 * en cas de rejet Firestore). Le filtrage par programme reste CÔTÉ CLIENT (voir
 * `useStrategicData`) : une même entreprise porte peu d'axes, et cela évite un index composite.
 */

const strategicAxesCol = () => collection(db, "strategicAxes");

export function subscribeStrategicAxes(
  companyId: string,
  cb: (axes: StrategicAxis[]) => void
): Unsubscribe {
  const scopedQuery = query(strategicAxesCol(), where("companyId", "==", companyId));
  const handleError = onListenerError("strategicAxes");
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      cb(snap.docs.map((d) => d.data() as StrategicAxis));
    },
    (error) => {
      handleError(error);
      // Ne jamais laisser un appelant attendre indéfiniment un premier résultat qui ne viendra
      // jamais (permission-denied, règles pas encore déployées) — voir useStrategicData.
      cb([]);
    }
  );
}

export async function saveStrategicAxis(axis: StrategicAxis): Promise<void> {
  await setDoc(doc(strategicAxesCol(), axis.id), axis);
}

export async function deleteStrategicAxis(id: string): Promise<void> {
  await deleteDoc(doc(strategicAxesCol(), id));
}
