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
import type { ChantierStaffing } from "@/types";

/**
 * CRUD temps réel du staffing des chantiers (ETP par grande fonction, voir `ChantierStaffing`
 * dans `types/index.ts`). Même pattern que `lib/firestore/chantiers.ts` : scope serveur par
 * `companyId`, filtrage par `programId` laissé au consommateur (`useStrategicData`).
 *
 * Pas d'`update` : une ligne de staffing n'a que deux champs signifiants (fonction + ETP), la
 * corriger revient à la supprimer et à la ressaisir — un chemin de mutation en moins à tester.
 */

const chantierStaffingCol = () => collection(db, "chantierStaffing");

export function subscribeChantierStaffing(
  companyId: string,
  cb: (entries: ChantierStaffing[]) => void
): Unsubscribe {
  const scopedQuery = query(chantierStaffingCol(), where("companyId", "==", companyId));
  const handleError = onListenerError("chantierStaffing");
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      cb(snap.docs.map((d) => d.data() as ChantierStaffing));
    },
    (error) => {
      handleError(error);
      // Un listener en erreur (typiquement permission-denied, règles pas encore déployées) ne
      // doit pas bloquer indéfiniment l'appelant qui attend un premier résultat : on retombe sur
      // liste vide plutôt que de ne jamais rappeler `cb`.
      cb([]);
    }
  );
}

export async function saveChantierStaffing(entry: ChantierStaffing): Promise<void> {
  await setDoc(doc(chantierStaffingCol(), entry.id), entry);
}

export async function deleteChantierStaffing(id: string): Promise<void> {
  await deleteDoc(doc(chantierStaffingCol(), id));
}
