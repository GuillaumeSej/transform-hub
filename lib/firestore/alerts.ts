import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import type { Alert, AlertState } from "@/types";

const alertsCol = () => collection(db, "alerts");
const alertStatesCol = () => collection(db, "alertStates");

function belongsToCompany(value: { companyId?: string | null }, companyId?: string | null) {
  return companyId == null || value.companyId === companyId;
}

// `companyId` null/undefined = admin global, requête non filtrée. Sinon, filtre CÔTÉ SERVEUR via
// `where` (même contrat que `subscribeLevers` — voir son commentaire pour le détail sur pourquoi
// un filtre client seul ne suffit plus une fois `firestore.rules` durci).
export function subscribeAlerts(
  cb: (alerts: Alert[]) => void,
  companyId?: string | null
): Unsubscribe {
  const scopedQuery = companyId
    ? query(alertsCol(), where("companyId", "==", companyId))
    : alertsCol();
  return onSnapshot(
    scopedQuery,
    (snap) => {
      const alerts = snap.docs.map((entry) => entry.data() as Alert);
      cb(alerts.filter((alert) => belongsToCompany(alert, companyId)));
    },
    onListenerError("alerts")
  );
}

export function subscribeAlertStates(
  cb: (states: Record<string, AlertState>) => void,
  companyId?: string | null
): Unsubscribe {
  const scopedQuery = companyId
    ? query(alertStatesCol(), where("companyId", "==", companyId))
    : alertStatesCol();
  return onSnapshot(
    scopedQuery,
    (snap) => {
      const states = snap.docs
        .map((entry) => entry.data() as AlertState)
        .filter((state) => belongsToCompany(state, companyId));
      cb(
        Object.fromEntries(
          states.map((state) => [`${state.companyId ?? "global"}__${state.alertId}`, state])
        )
      );
    },
    onListenerError("alertStates")
  );
}

export async function saveManualAlert(alert: Alert): Promise<void> {
  await setDoc(doc(alertsCol(), alert.id), alert);
}

export async function saveAlertState(state: AlertState): Promise<void> {
  const tenantKey = state.companyId ?? "global";
  await setDoc(doc(alertStatesCol(), `${tenantKey}__${state.alertId}`), state);
}
