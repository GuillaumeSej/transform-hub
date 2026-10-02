import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  stripUndefined,
  type ApprovalEffects,
  type StrategicApproval,
} from "@/lib/strategicApprovals";
import {
  cascadeWriteCount,
  emptyCascadePlan,
  mergeCascadePlans,
  planDeletionCascade,
  type CascadePlan,
  type CascadeRoots,
  type CascadeSnapshot,
} from "@/lib/strategicIntegrity";
import type {
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

/**
 * Écriture ATOMIQUE des suppressions du Plan Stratégique et de leur cascade (lot 3) — voir
 * `planDeletionCascade` (lib/strategicIntegrity.ts) pour les règles. Un seul `writeBatch` par
 * opération : tout ou rien (plus de chantier supprimé avec ses lignes ETP laissées en base parce
 * qu'une écriture intermédiaire a échoué).
 *
 * La cascade est calculée sur un instantané FRAIS de l'entreprise relu ici (et non sur les données
 * déjà chargées par l'écran) : les listes d'un écran sont filtrées par confidentialité/périmètre,
 * et une ligne ETP ou une demande invisible pour l'auteur de la suppression doit quand même partir.
 */

/** Limite Firestore d'un `writeBatch`. */
const BATCH_LIMIT = 500;

const COLLECTIONS = {
  axes: "strategicAxes",
  chantiers: "chantiers",
  actions: "chantierActions",
  staffing: "chantierStaffing",
  indicators: "indicators",
  measurements: "indicatorMeasurements",
  approvals: "strategicApprovals",
} as const;

async function readCompany<T>(name: string, companyId: string): Promise<T[]> {
  const snap = await getDocs(query(collection(db, name), where("companyId", "==", companyId)));
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}

/** Instantané de l'entreprise nécessaire au calcul de la cascade. */
export async function loadCascadeSnapshot(companyId: string): Promise<CascadeSnapshot> {
  const [axes, chantiers, chantierActions, staffing, indicators, measurements, approvals] =
    await Promise.all([
      readCompany<StrategicAxis>(COLLECTIONS.axes, companyId),
      readCompany<Chantier & { axisId?: string }>(COLLECTIONS.chantiers, companyId),
      readCompany<ChantierAction>(COLLECTIONS.actions, companyId),
      readCompany<ChantierStaffing>(COLLECTIONS.staffing, companyId),
      readCompany<Indicator>(COLLECTIONS.indicators, companyId),
      readCompany<IndicatorMeasurement>(COLLECTIONS.measurements, companyId),
      readCompany<StrategicApproval>(COLLECTIONS.approvals, companyId),
    ]);
  return {
    axes,
    // Même normalisation que `subscribeChantiers` (ancien champ scalaire `axisId`).
    chantiers: chantiers.map((c) => ({
      ...c,
      axisIds:
        Array.isArray(c.axisIds) && c.axisIds.length > 0
          ? c.axisIds
          : typeof c.axisId === "string"
            ? [c.axisId]
            : [],
    })),
    chantierActions,
    staffing,
    indicators,
    measurements,
    approvals,
  };
}

/** Effets d'une décision de validation à écrire en plus de la cascade (même batch). */
type ExtraEffects = Omit<
  ApprovalEffects,
  "deleteActionIds" | "deleteChantierIds" | "deleteIndicatorIds"
> & {
  // Suppressions déjà portées par le plan de cascade (racines) : jamais réécrites ici.
  deleteActionIds?: string[];
  deleteChantierIds?: string[];
  deleteIndicatorIds?: string[];
};

function commitPlan(plan: CascadePlan, extra?: ExtraEffects): Promise<void> {
  const batch = writeBatch(db);
  const ref = (name: string, id: string) => doc(collection(db, name), id);
  let count = cascadeWriteCount(plan);
  if (extra) {
    count +=
      extra.saveActions.length +
      extra.saveMeasurements.length +
      extra.deleteMeasurementIds.length +
      extra.saveIndicators.length +
      extra.saveStaffing.length +
      extra.saveChantiers.length +
      extra.saveAxes.length +
      extra.deleteStaffingIds.length;
  }
  if (count > BATCH_LIMIT) {
    return Promise.reject(
      new Error(
        `Suppression trop volumineuse pour une écriture atomique (${count} écritures, limite ${BATCH_LIMIT}) : rien n'a été supprimé. Supprimez d'abord une partie des projets ou indicateurs.`
      )
    );
  }
  if (extra) {
    for (const a of extra.saveActions) batch.set(ref(COLLECTIONS.actions, a.id), stripUndefined(a));
    for (const m of extra.saveMeasurements) {
      batch.set(ref(COLLECTIONS.measurements, m.id), stripUndefined(m));
    }
    for (const i of extra.saveIndicators) {
      batch.set(ref(COLLECTIONS.indicators, i.id), stripUndefined(i));
    }
    for (const s of extra.saveStaffing)
      batch.set(ref(COLLECTIONS.staffing, s.id), stripUndefined(s));
    for (const c of extra.saveChantiers) {
      batch.set(ref(COLLECTIONS.chantiers, c.id), stripUndefined(c));
    }
    for (const ax of extra.saveAxes) batch.set(ref(COLLECTIONS.axes, ax.id), stripUndefined(ax));
    for (const id of extra.deleteMeasurementIds) batch.delete(ref(COLLECTIONS.measurements, id));
    for (const id of extra.deleteStaffingIds) batch.delete(ref(COLLECTIONS.staffing, id));
  }
  for (const id of plan.deleteAxisIds) batch.delete(ref(COLLECTIONS.axes, id));
  for (const id of plan.deleteChantierIds) batch.delete(ref(COLLECTIONS.chantiers, id));
  for (const id of plan.deleteActionIds) batch.delete(ref(COLLECTIONS.actions, id));
  for (const id of plan.deleteStaffingIds) batch.delete(ref(COLLECTIONS.staffing, id));
  for (const id of plan.deleteIndicatorIds) batch.delete(ref(COLLECTIONS.indicators, id));
  for (const id of plan.deleteMeasurementIds) batch.delete(ref(COLLECTIONS.measurements, id));
  for (const u of plan.chantierDependencyUpdates) {
    batch.update(ref(COLLECTIONS.chantiers, u.id), { dependencies: u.dependencies });
  }
  for (const u of plan.actionPrerequisiteUpdates) {
    batch.update(ref(COLLECTIONS.actions, u.id), {
      prerequisites: stripUndefined(u.prerequisites),
    });
  }
  for (const c of plan.cancelledApprovals) {
    batch.update(ref(COLLECTIONS.approvals, c.id), stripUndefined(c.patch));
  }
  return batch.commit();
}

/**
 * Supprime `roots` ET leur cascade en un seul `writeBatch`. Lève `AxisNotEmptyError` (rien
 * d'écrit) pour un axe qui porte encore des chantiers/indicateurs. Renvoie le plan écrit (audit,
 * tests manuels).
 */
export async function deleteWithCascade(
  companyId: string,
  roots: CascadeRoots,
  actor: { username: string; name?: string },
  options: { excludeApprovalIds?: string[] } = {}
): Promise<CascadePlan> {
  const snapshot = await loadCascadeSnapshot(companyId);
  const plan = planDeletionCascade(roots, snapshot, {
    actor,
    now: new Date().toISOString(),
    excludeApprovalIds: options.excludeApprovalIds,
  });
  await commitPlan(plan);
  return plan;
}

/**
 * Écrit les effets d'une décision de validation (`applyApprovedPayload` / `applyRejectedPayload`
 * / `applyRequestSideEffects`) en UN SEUL `writeBatch`. Une suppression approuvée
 * (`deleteChantierIds` / `deleteActionIds`) est étendue à sa cascade complète, relue en base ;
 * `approvalId` (la demande en cours de décision) n'est jamais annulée par cette cascade.
 */
export async function commitApprovalEffects(
  effects: ApprovalEffects,
  ctx: { companyId: string; actor: { username: string; name?: string }; approvalId?: string }
): Promise<void> {
  const roots: CascadeRoots = {
    chantierIds: effects.deleteChantierIds,
    actionIds: effects.deleteActionIds,
    indicatorIds: effects.deleteIndicatorIds,
  };
  let plan = emptyCascadePlan();
  if (
    effects.deleteChantierIds.length > 0 ||
    effects.deleteActionIds.length > 0 ||
    effects.deleteIndicatorIds.length > 0
  ) {
    const snapshot = await loadCascadeSnapshot(ctx.companyId);
    plan = planDeletionCascade(roots, snapshot, {
      actor: ctx.actor,
      now: new Date().toISOString(),
      excludeApprovalIds: ctx.approvalId ? [ctx.approvalId] : [],
    });
    // Les lignes ETP déjà listées par l'effet pur font partie du même batch (union sans doublon).
    plan = mergeCascadePlans(plan, {
      ...emptyCascadePlan(),
      deleteStaffingIds: effects.deleteStaffingIds,
      deleteMeasurementIds: effects.deleteMeasurementIds,
    });
  }
  const isEmpty =
    cascadeWriteCount(plan) === 0 &&
    effects.saveActions.length +
      effects.saveMeasurements.length +
      effects.deleteMeasurementIds.length +
      effects.saveIndicators.length +
      effects.saveStaffing.length +
      effects.saveChantiers.length +
      effects.saveAxes.length +
      effects.deleteStaffingIds.length ===
      0;
  if (isEmpty) return;
  const inPlan = cascadeWriteCount(plan) > 0;
  await commitPlan(plan, {
    ...effects,
    // Déjà portés par le plan (cascade) : pas de double écriture du même document.
    deleteStaffingIds: inPlan ? [] : effects.deleteStaffingIds,
    deleteMeasurementIds: inPlan ? [] : effects.deleteMeasurementIds,
  });
}
