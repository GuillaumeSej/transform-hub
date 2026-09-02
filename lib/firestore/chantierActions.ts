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
import type { ChantierAction } from "@/types";

/**
 * CRUD temps réel des actions de chantier. Collection TOP-LEVEL (pas un tableau embarqué dans le
 * chantier, contrairement à `Lever.actions` côté Performance) : le Gantt stratégique lit les
 * actions de plusieurs chantiers et de plusieurs axes à la fois, et les bornes d'un chantier en
 * sont dérivées (voir `axisLogic.chantierBounds`) — une collection plate évite d'avoir à recharger
 * et réécrire un chantier entier à chaque édition d'action.
 */

const chantierActionsCol = () => collection(db, "chantierActions");

export function subscribeChantierActions(
  companyId: string,
  cb: (actions: ChantierAction[]) => void
): Unsubscribe {
  const scopedQuery = query(chantierActionsCol(), where("companyId", "==", companyId));
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      cb(snap.docs.map((d) => d.data() as ChantierAction));
    },
    onListenerError("chantierActions")
  );
}

export async function saveChantierAction(action: ChantierAction): Promise<void> {
  await setDoc(doc(chantierActionsCol(), action.id), action);
}

export async function deleteChantierAction(id: string): Promise<void> {
  await deleteDoc(doc(chantierActionsCol(), id));
}
