import { doc, collection, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { stripUndefined } from "@/lib/strategicApprovals";
import type { StrategicImportWrites } from "@/lib/strategicExcelImport";

/**
 * Écriture d'un import de plan stratégique (créations + mises à jour) par `writeBatch` — remplace
 * les `Promise.all` de `save*` des appelants (StrategicAxesView, StrategicPlanOnboarding), qui
 * pouvaient laisser un demi-plan en base sans dire quoi.
 *
 *  - Jusqu'à `BATCH_LIMIT` écritures : UN seul batch, donc atomique (tout ou rien) — cas d'un plan
 *    courant (le fichier de référence Plan 2030 fait ~150 écritures).
 *  - Au-delà : batches successifs dans l'ordre parent → enfant (axes, chantiers, projets,
 *    indicateurs, mesures, ETP). En cas d'échec, `StrategicImportWriteError.written` indique
 *    précisément ce qui a déjà été écrit (par type), et l'erreur remonte à l'appelant.
 */

const BATCH_LIMIT = 450;

type WriteKey = keyof StrategicImportWrites;

const COLLECTIONS: Record<WriteKey, string> = {
  axes: "strategicAxes",
  chantiers: "chantiers",
  actions: "chantierActions",
  indicators: "indicators",
  measurements: "indicatorMeasurements",
  staffing: "chantierStaffing",
};

const ORDER: WriteKey[] = [
  "axes",
  "chantiers",
  "actions",
  "indicators",
  "measurements",
  "staffing",
];

export type StrategicImportWriteCounts = Record<WriteKey, number>;

export class StrategicImportWriteError extends Error {
  constructor(
    message: string,
    public readonly written: StrategicImportWriteCounts,
    public readonly total: number
  ) {
    super(message);
    this.name = "StrategicImportWriteError";
  }
}

export async function writeStrategicImport(
  writes: StrategicImportWrites
): Promise<StrategicImportWriteCounts> {
  const ops: { key: WriteKey; id: string; data: object }[] = [];
  for (const key of ORDER) {
    for (const entity of writes[key] as { id: string }[]) {
      ops.push({ key, id: entity.id, data: stripUndefined(entity) });
    }
  }
  const written: StrategicImportWriteCounts = {
    axes: 0,
    chantiers: 0,
    actions: 0,
    indicators: 0,
    measurements: 0,
    staffing: 0,
  };
  for (let start = 0; start < ops.length; start += BATCH_LIMIT) {
    const chunk = ops.slice(start, start + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const op of chunk) batch.set(doc(collection(db, COLLECTIONS[op.key]), op.id), op.data);
    try {
      await batch.commit();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new StrategicImportWriteError(reason, { ...written }, ops.length);
    }
    for (const op of chunk) written[op.key] += 1;
  }
  return written;
}
