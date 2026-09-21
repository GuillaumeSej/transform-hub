import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import { stripUndefined, type StrategicApproval } from "@/lib/strategicApprovals";

/**
 * Demandes de validation du Plan Stratégique (voir lib/strategicApprovals.ts). Collection
 * TOP-LEVEL `strategicApprovals`, scopée entreprise (`companyId` requis sur chaque document,
 * requête filtrée côté serveur comme les autres collections stratégiques).
 * NB : la règle Firestore correspondante doit être (re)publiée à la main dans la console Firebase.
 */
const approvalsCol = () => collection(db, "strategicApprovals");

export function subscribeStrategicApprovals(
  companyId: string,
  cb: (approvals: StrategicApproval[]) => void
): Unsubscribe {
  const scopedQuery = query(approvalsCol(), where("companyId", "==", companyId));
  const handleError = onListenerError("strategicApprovals");
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      cb(snap.docs.map((d) => d.data() as StrategicApproval));
    },
    (error) => {
      handleError(error);
      cb([]);
    }
  );
}

export async function saveStrategicApproval(approval: StrategicApproval): Promise<void> {
  await setDoc(doc(approvalsCol(), approval.id), stripUndefined(approval));
}

export type ApprovalDecisionPatch = Pick<
  StrategicApproval,
  "status" | "decidedBy" | "decidedByName" | "decidedAt" | "decisionComment"
>;

/** Enregistre la décision en transaction : refuse si la demande n'est plus "pending" (double
 *  décision concurrente). Renvoie la demande mise à jour. */
export async function decideStrategicApproval(
  id: string,
  patch: ApprovalDecisionPatch
): Promise<StrategicApproval> {
  const ref = doc(approvalsCol(), id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Demande introuvable");
    const current = snap.data() as StrategicApproval;
    if (current.status !== "pending") throw new Error("Cette demande a déjà été traitée");
    const next = stripUndefined({ ...current, ...patch });
    tx.set(ref, next);
    return next;
  });
}
