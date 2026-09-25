"use client";

/**
 * useStrategicApprovals — API de validation du Plan Stratégique (à brancher dans les écrans).
 * Règles et modèle à PALIERS (N+1 puis N+2) : voir l'en-tête de lib/strategicApprovals.ts.
 *
 *   const sa = useStrategicApprovals({ user, companyId, programId, data: strategic });
 *   // `data` = ce que renvoie useStrategicData (axes, chantiers, chantierActions, indicators,
 *   //          measurements, users) — passé en paramètre pour ne pas ouvrir d'abonnement en double.
 *
 *   sa.approvals StrategicApproval[]  toutes les demandes du programme (badges « en attente »)
 *   sa.pending   StrategicApproval[]  en attente ET décidables MAINTENANT par l'utilisateur (palier
 *                                     courant — l'approbateur de l'étape 2 ne voit la demande
 *                                     qu'après l'étape 1) → badge Topbar = sa.pendingCount
 *   sa.mine      StrategicApproval[]  demandes émises par l'utilisateur (tous statuts)
 *   sa.history   StrategicApproval[]  demandes décidées visibles de l'utilisateur
 *   sa.alerts    Alert[]              alertes dérivées (à valider / en attente / décision)
 *   sa.needsApproval(kind, target, stage?, payload?) => boolean
 *        false → appliquer directement (admin, pilote du plan, catégorie libre) ; true → sa.request.
 *        `payload` requis pour "projet_update"/"chantier_update" (catégorie) et "chantier_create".
 *   sa.previewChain(kind, target, payload?) => ApprovalStep[]  « sera validé par X puis Y »
 *   sa.request(kind, target, payload, reason?) => Promise<StrategicApproval>
 *        kind    "milestone" | "kpi_value" | "projet_create" | "projet_update" | "projet_delete"
 *                | "chantier_create" | "chantier_update" | "chantier_delete"
 *        target  { type: "axe"|"chantier"|"projet"|"indicateur", id, name? }
 *        payload milestone       { targetMilestone, fromMilestone? }          target = projet
 *                kpi_value       { period, value?, note?, measurementId?, remove? }
 *                                                                              target = indicateur
 *                projet_create   { action: ChantierAction (id déjà généré), staffing? }
 *                                                                              target = chantier parent
 *                projet_update   { patch, before, category }                  target = projet
 *                projet_delete   { name? }                                    target = projet
 *                chantier_create { chantier: Chantier (id déjà généré) }      target = axe principal
 *                chantier_update { patch, before, category }                  target = chantier
 *                chantier_delete { name? }                                    target = chantier
 *        Chaîne calculée et SNAPSHOTÉE à la création. Écrit la demande + une entrée d'audit ; pour
 *        "milestone" pose aussi `ChantierAction.milestoneApproval` (marqueur "en attente").
 *   sa.approve(id, comment?, adjust?) => Promise<void>
 *        Valide le palier COURANT : palier intermédiaire → la demande passe au palier suivant (rien
 *        n'est appliqué) ; dernier palier → effet appliqué (jalon/KPI/création/modification/
 *        suppression). Demandes LEGACY (sans chaîne) : décision unique, et l'ancien enchaînement
 *        "projet_create" palier "chantier" → "axis" (`nextProjetCreateApproval`) reste géré.
 *        `adjust` (correction KPI uniquement) : valeur AJUSTÉE par l'approbateur.
 *   sa.reject(id, comment)   => Promise<void>   commentaire OBLIGATOIRE ; clôt la demande
 *   sa.kpiCorrectionRoute(indicator) => KpiCorrectionRoute   directe (pilote/admin) / demande / interdite
 *   sa.notifyKpiCorrection(target, payload, informUsernames) => enregistrement d'information
 * Toutes les méthodes lèvent une Error (message FR) si non habilité / périmé / déjà traité.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeStrategicApprovals,
  saveStrategicApproval,
  decideStrategicApproval,
} from "@/lib/firestore/strategicApprovals";
import { saveChantierAction, deleteChantierAction } from "@/lib/firestore/chantierActions";
import { deleteChantier, saveChantier } from "@/lib/firestore/chantiers";
import { saveChantierStaffing } from "@/lib/firestore/chantierStaffing";
import { saveIndicator } from "@/lib/firestore/indicators";
import {
  deleteIndicatorMeasurement,
  saveIndicatorMeasurement,
} from "@/lib/firestore/indicatorMeasurements";
import { appendAuditEntries } from "@/lib/firestore/levers";
import {
  kpiCorrectionDecisionInformees,
  routeKpiCorrection,
  type KpiCorrectionIndicator,
} from "@/lib/kpiCorrectionRouting";
import {
  applyApprovedPayload,
  applyRejectedPayload,
  applyRequestSideEffects,
  bucketApprovals,
  buildApproval,
  buildApprovalAlerts,
  buildApprovalAuditEntry,
  buildDirectKpiCorrectionRecord,
  canDecide,
  decideApproval,
  needsApproval as needsApprovalLogic,
  nextProjetCreateApproval,
  previewApprovalChain,
  type ApprovalEffects,
  type ApprovalEvent,
  type KpiValueApprovalPayload,
  type ProjetCreateApprovalPayload,
  type ProjetCreateStage,
  type StrategicApproval,
  type StrategicApprovalData,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import type { ApprovalStep } from "@/lib/strategicHierarchy";
import type { Alert, AuthUser } from "@/types";

type ApprovalUser = Pick<
  AuthUser,
  "username" | "name" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin"
>;

async function runEffects(effects: ApprovalEffects): Promise<void> {
  for (const a of effects.saveActions) await saveChantierAction(a);
  for (const id of effects.deleteActionIds) await deleteChantierAction(id);
  for (const id of effects.deleteChantierIds) await deleteChantier(id);
  for (const m of effects.saveMeasurements) await saveIndicatorMeasurement(m);
  for (const id of effects.deleteMeasurementIds) await deleteIndicatorMeasurement(id);
  for (const i of effects.saveIndicators) await saveIndicator(i);
  for (const s of effects.saveStaffing) await saveChantierStaffing(s);
  for (const c of effects.saveChantiers) await saveChantier(c);
}

export type UseStrategicApprovalsArgs = {
  user: ApprovalUser | null | undefined;
  companyId: string | null | undefined;
  programId: string | null | undefined;
  data: Omit<StrategicApprovalData, "programId">;
};

export function useStrategicApprovals({
  user,
  companyId,
  programId,
  data,
}: UseStrategicApprovalsArgs) {
  const [all, setAll] = useState<StrategicApproval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) {
      setAll([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeStrategicApprovals(companyId, (v) => {
      setAll(v);
      setLoading(false);
    });
  }, [companyId]);

  const approvals = useMemo(
    () => (programId ? all.filter((a) => a.programId === programId) : []),
    [all, programId]
  );
  const fullData = useMemo<StrategicApprovalData>(
    () => ({ ...data, programId }),
    [data, programId]
  );
  const dataRef = useRef(fullData);
  dataRef.current = fullData;
  const approvalsRef = useRef(approvals);
  approvalsRef.current = approvals;

  const buckets = useMemo(
    () => bucketApprovals(approvals, user, fullData),
    [approvals, user, fullData]
  );
  const alerts = useMemo<Alert[]>(
    () => buildApprovalAlerts(approvals, user, fullData),
    [approvals, user, fullData]
  );

  const logAudit = useCallback(
    (approval: StrategicApproval, event: ApprovalEvent) => {
      const entry = buildApprovalAuditEntry(approval, event, dataRef.current.users);
      appendAuditEntries(companyId, [entry]).catch((err) =>
        console.error("[betrack] audit validation stratégique :", err)
      );
    },
    [companyId]
  );

  const needsApproval = useCallback(
    (
      kind: StrategicApprovalKind,
      target: StrategicApprovalTarget,
      stage?: ProjetCreateStage,
      payload?: StrategicApprovalPayload
    ) => needsApprovalLogic(kind, user, target, dataRef.current, stage, payload),
    [user]
  );

  const previewChain = useCallback(
    (
      kind: StrategicApprovalKind,
      target: StrategicApprovalTarget,
      payload?: StrategicApprovalPayload
    ): ApprovalStep[] => previewApprovalChain(kind, user, target, payload, dataRef.current),
    [user]
  );

  const request = useCallback(
    async (
      kind: StrategicApprovalKind,
      target: StrategicApprovalTarget,
      payload: StrategicApprovalPayload,
      reason?: string
    ): Promise<StrategicApproval> => {
      if (!user || !companyId || !programId) throw new Error("Session ou programme indisponible");
      const approval = buildApproval({
        kind,
        target,
        payload,
        reason,
        companyId,
        programId,
        requester: user,
        data: dataRef.current,
      });
      await saveStrategicApproval(approval);
      await runEffects(applyRequestSideEffects(approval, dataRef.current));
      logAudit(approval, "requested");
      return approval;
    },
    [user, companyId, programId, logAudit]
  );

  const kpiCorrectionRoute = useCallback(
    (indicator: KpiCorrectionIndicator) => routeKpiCorrection(user, indicator, fullData),
    [user, fullData]
  );

  const notifyKpiCorrection = useCallback(
    async (
      target: StrategicApprovalTarget,
      payload: KpiValueApprovalPayload,
      informUsernames: string[]
    ): Promise<void> => {
      if (!user || !companyId || !programId) return;
      const informees = informUsernames.filter((u) => u !== user.username);
      if (!informees.length) return;
      await saveStrategicApproval(
        buildDirectKpiCorrectionRecord({
          target,
          payload,
          informUsernames: informees,
          companyId,
          programId,
          actor: user,
          data: dataRef.current,
        })
      );
    },
    [user, companyId, programId]
  );

  const decide = useCallback(
    async (
      id: string,
      status: "approved" | "rejected",
      comment?: string,
      adjust?: { value?: number }
    ) => {
      if (!user) throw new Error("Session indisponible");
      const approval = approvalsRef.current.find((a) => a.id === id);
      if (!approval) throw new Error("Demande introuvable");
      if (!canDecide(user, approval, dataRef.current)) {
        throw new Error("Vous n'êtes pas habilité à traiter cette demande");
      }
      const decidedAt = new Date().toISOString();
      // Correction/suppression KPI : valeur éventuellement AJUSTÉE par l'approbateur, et
      // responsables supérieurs au décideur informés (lib/kpiCorrectionRouting.ts).
      let payloadPatch: KpiValueApprovalPayload | undefined;
      let informUsernames: string[] | undefined;
      const kpiPayload =
        approval.kind === "kpi_value" ? (approval.payload as KpiValueApprovalPayload) : undefined;
      if (status === "approved" && kpiPayload?.measurementId) {
        if (
          !kpiPayload.remove &&
          adjust?.value !== undefined &&
          adjust.value !== kpiPayload.value
        ) {
          payloadPatch = {
            ...kpiPayload,
            value: adjust.value,
            requestedValue: kpiPayload.requestedValue ?? kpiPayload.value,
          };
        }
        const indicator = dataRef.current.indicators.find((i) => i.id === approval.targetId);
        if (indicator) {
          informUsernames = kpiCorrectionDecisionInformees(
            user,
            approval.requestedBy,
            indicator,
            dataRef.current
          );
        }
      }
      const base: StrategicApproval = {
        ...approval,
        ...(payloadPatch ? { payload: payloadPatch } : {}),
      };
      const { approval: decidedRaw, final } = decideApproval(
        base,
        user,
        status,
        comment,
        decidedAt
      );
      // Informés (correction KPI) : seulement à la clôture approuvée, jamais les paliers de la
      // chaîne (ils ont validé eux-mêmes).
      const chainUsers = new Set((approval.chain ?? []).flatMap((st) => st.usernames));
      const informees =
        final && status === "approved"
          ? (informUsernames ?? []).filter((u) => !chainUsers.has(u))
          : [];
      const decided: StrategicApproval = {
        ...decidedRaw,
        ...(informees.length ? { informUsernames: informees } : {}),
      };
      // Effets d'abord (clôture uniquement) : s'ils échouent (cible disparue, jalon/champ périmé),
      // la demande reste en attente. Palier intermédiaire : aucun effet.
      // LEGACY "projet_create" palier "chantier" : `applyApprovedPayload` ne crée RIEN pour ce
      // palier — l'enchaînement vers le palier "axis" se fait juste en dessous.
      if (final) {
        await runEffects(
          status === "approved"
            ? applyApprovedPayload(decided, dataRef.current)
            : applyRejectedPayload(decided, dataRef.current)
        );
      }
      const saved = await decideStrategicApproval(
        id,
        {
          status: decided.status,
          decidedBy: decided.decidedBy,
          decidedByName: decided.decidedByName,
          decidedAt: decided.decidedAt,
          decisionComment: decided.decisionComment,
          ...(payloadPatch ? { payload: payloadPatch } : {}),
          ...(informees.length ? { informUsernames: informees } : {}),
          ...(decided.chain
            ? {
                chain: decided.chain,
                stepIndex: decided.stepIndex,
                approverRole: decided.approverRole,
                approverUsername: decided.approverUsername,
                approverUsernames: decided.approverUsernames,
              }
            : {}),
        },
        approval.chain?.length ? (approval.stepIndex ?? 0) : undefined
      );
      if (!final) {
        logAudit(saved, "step_approved");
        return;
      }
      logAudit(saved, status);
      if (status === "approved" && saved.kind === "projet_create" && !saved.chain?.length) {
        const payload = saved.payload as ProjetCreateApprovalPayload;
        if (payload.stage === "chantier") {
          // Double validation (voir l'en-tête de lib/strategicApprovals.ts) : le pilote du chantier
          // vient de valider — enchaîne automatiquement la 2e demande (palier "axis"), sauf si elle
          // serait inutile/indécidable (`nextProjetCreateApproval`), auquel cas le projet est créé
          // directement ici même (effet "axis" appliqué avec le même payload).
          const next = nextProjetCreateApproval(saved, dataRef.current);
          if (next) {
            await saveStrategicApproval(next);
            logAudit(next, "requested");
          } else {
            await runEffects(
              applyApprovedPayload(
                { ...saved, payload: { ...payload, stage: "axis" as const } },
                dataRef.current
              )
            );
          }
        }
      }
    },
    [user, logAudit]
  );

  const approve = useCallback(
    (id: string, comment?: string, adjust?: { value?: number }) =>
      decide(id, "approved", comment, adjust),
    [decide]
  );
  const reject = useCallback(
    async (id: string, comment: string) => {
      if (!comment?.trim()) throw new Error("Un commentaire est obligatoire pour refuser");
      await decide(id, "rejected", comment);
    },
    [decide]
  );

  return {
    loading,
    approvals,
    pending: buckets.pending,
    mine: buckets.mine,
    history: buckets.history,
    pendingCount: buckets.pending.length,
    alerts,
    needsApproval,
    previewChain,
    request,
    kpiCorrectionRoute,
    notifyKpiCorrection,
    approve,
    reject,
  };
}
