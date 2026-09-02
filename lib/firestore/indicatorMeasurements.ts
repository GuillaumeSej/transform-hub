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
import type { IndicatorMeasurement } from "@/types";

/**
 * CRUD temps réel des mesures périodiques d'indicateurs. Collection top-level scopée entreprise
 * (le lien à l'indicateur passe par `indicatorId`, filtré côté client) — la page KPI charge de
 * toute façon TOUTES les mesures de l'entreprise pour tracer un graphique par indicateur.
 */

const indicatorMeasurementsCol = () => collection(db, "indicatorMeasurements");

export function subscribeIndicatorMeasurements(
  companyId: string,
  cb: (measurements: IndicatorMeasurement[]) => void
): Unsubscribe {
  const scopedQuery = query(indicatorMeasurementsCol(), where("companyId", "==", companyId));
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      cb(snap.docs.map((d) => d.data() as IndicatorMeasurement));
    },
    onListenerError("indicatorMeasurements")
  );
}

export async function saveIndicatorMeasurement(measurement: IndicatorMeasurement): Promise<void> {
  await setDoc(doc(indicatorMeasurementsCol(), measurement.id), measurement);
}

export async function deleteIndicatorMeasurement(id: string): Promise<void> {
  await deleteDoc(doc(indicatorMeasurementsCol(), id));
}
