import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { mockData } from "@/data/mockData";
import type { Alert, AlertState } from "@/types";

const alertsCol = () => collection(db, "alerts");
const alertStatesCol = () => collection(db, "alertStates");
const metaDoc = () => doc(db, "meta", "alertsSeed");

function belongsToCompany(value: { companyId?: string | null }, companyId?: string | null) {
  return companyId == null || value.companyId === companyId;
}

export function subscribeAlerts(
  cb: (alerts: Alert[]) => void,
  companyId?: string | null
): Unsubscribe {
  return onSnapshot(alertsCol(), (snap) => {
    const alerts = snap.docs.map((entry) => entry.data() as Alert);
    cb(alerts.filter((alert) => belongsToCompany(alert, companyId)));
  });
}

export function subscribeAlertStates(
  cb: (states: Record<string, AlertState>) => void,
  companyId?: string | null
): Unsubscribe {
  return onSnapshot(alertStatesCol(), (snap) => {
    const states = snap.docs
      .map((entry) => entry.data() as AlertState)
      .filter((state) => belongsToCompany(state, companyId));
    cb(
      Object.fromEntries(
        states.map((state) => [`${state.companyId ?? "global"}__${state.alertId}`, state])
      )
    );
  });
}

export async function ensureAlertsSeeded(): Promise<void> {
  const existing = await getDocs(alertsCol());
  if (!existing.empty) return;

  const batch = writeBatch(db);
  const createdAt = new Date().toISOString();
  for (const alert of mockData.alerts) {
    const seeded: Alert = {
      ...alert,
      companyId: alert.companyId ?? "c1",
      createdAt: alert.createdAt ?? createdAt,
      suppressAutomaticAlerts: alert.suppressAutomaticAlerts ?? false,
    };
    batch.set(doc(alertsCol(), seeded.id), seeded);
  }
  batch.set(metaDoc(), { seededAt: createdAt, version: 1 });
  await batch.commit();
}

export async function saveManualAlert(alert: Alert): Promise<void> {
  await setDoc(doc(alertsCol(), alert.id), alert);
}

export async function saveAlertState(state: AlertState): Promise<void> {
  const tenantKey = state.companyId ?? "global";
  await setDoc(doc(alertStatesCol(), `${tenantKey}__${state.alertId}`), state);
}
