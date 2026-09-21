"use client";

/**
 * useStrategicApprovals — API de validation du Plan Stratégique (à brancher dans les écrans).
 *
 *   const sa = useStrategicApprovals({ user, companyId, programId, data: strategic });
 *   // `data` = ce que renvoie useStrategicData (axes, chantiers, chantierActions, indicators,
 *   //          measurements, users) — passé en paramètre pour ne pas ouvrir d'abonnement en double.
 *
 *   sa.pending   StrategicApproval[]  en attente ET décidables par l'utilisateur courant
 *   sa.mine      StrategicApproval[]  demandes émises par l'utilisateur (tous statuts)
 *   sa.history   StrategicApproval[]  demandes décidées visibles de l'utilisateur
 *   sa.alerts    Alert[]              alertes dérivées (à valider / en attente / décision)
 *   sa.pendingCount number
 *   sa.needsApproval(kind, target) => boolean
 *        true  → appeler sa.request(...) au lieu d'agir ; false → l'utilisateur EST l'approbateur
 *        (ou admin/strategic_lead) : appliquer l'action directement, sans demande.
 *   sa.request(kind, target, payload, reason?) => Promise<StrategicApproval>
 *        kind    "milestone" | "kpi_value" | "projet_create" | "projet_delete" | "chantier_delete"
 *        target  { type: "axe"|"chantier"|"projet"|"indicateur", id, name? }
 *        payload milestone      { targetMilestone, fromMilestone? }   target = projet
 *                kpi_value      { period, value?, note? }             target = indicateur
 *                projet_create  { action: ChantierAction (id déjà généré) }  target = chantier parent
 *                projet_delete  { name? }                             target = projet
 *                chantier_delete{ name? }                             target = chantier
 *        Écrit la demande + une entrée d'audit ; pour "milestone" pose aussi
 *        `ChantierAction.milestoneApproval` (marqueur "en attente" de l'UI existante).
 *   sa.approve(id, comment?) => Promise<void>   applique l'effet (jalon/KPI/création/suppression)
 *   sa.reject(id, comment)   => Promise<void>   commentaire OBLIGATOIRE
 * Toutes les méthodes lèvent une Error (message FR) si non habilité / périmé / déjà traité.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeStrategicApprovals,
  saveStrategicApproval,
  decideStrategicApproval,
} from "@/lib/firestore/strategicApprovals";
import { saveChantierAction, deleteChantierAction } from "@/lib/firestore/chantierActions";
import { deleteChantier } from "@/lib/firestore/chantiers";
import { saveIndicator } from "@/lib/firestore/indicators";
import { saveIndicatorMeasurement } from "@/lib/firestore/indicatorMeasurements";
import { appendAuditEntries } from "@/lib/firestore/levers";
import {
  applyApprovedPayload,
  applyRejectedPayload,
  applyRequestSideEffects,
  bucketApprovals,
  buildApproval,
  buildApprovalAlerts,
  buildApprovalAuditEntry,
  canDecide,
  needsApproval as needsApprovalLogic,
  type ApprovalEffects,
  type StrategicApproval,
  type StrategicApprovalData,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
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
  for (const i of effects.saveIndicators) await saveIndicator(i);
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
    (approval: StrategicApproval, event: "requested" | "approved" | "rejected") => {
      const entry = buildApprovalAuditEntry(approval, event, dataRef.current.users);
      appendAuditEntries(companyId, [entry]).catch((err) =>
        console.error("[betrack] audit validation stratégique :", err)
      );
    },
    [companyId]
  );

  const needsApproval = useCallback(
    (kind: StrategicApprovalKind, target: StrategicApprovalTarget) =>
      needsApprovalLogic(kind, user, target, dataRef.current),
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

  const decide = useCallback(
    async (id: string, status: "approved" | "rejected", comment?: string) => {
      if (!user) throw new Error("Session indisponible");
      const approval = approvalsRef.current.find((a) => a.id === id);
      if (!approval) throw new Error("Demande introuvable");
      if (!canDecide(user, approval, dataRef.current)) {
        throw new Error("Vous n'êtes pas habilité à traiter cette demande");
      }
      const decidedAt = new Date().toISOString();
      const decided: StrategicApproval = {
        ...approval,
        status,
        decidedBy: user.username,
        decidedByName: user.name,
        decidedAt,
        decisionComment: comment?.trim() || undefined,
      };
      // Effets d'abord : s'ils échouent (cible disparue, jalon périmé), la demande reste en attente.
      await runEffects(
        status === "approved"
          ? applyApprovedPayload(decided, dataRef.current)
          : applyRejectedPayload(decided, dataRef.current)
      );
      const saved = await decideStrategicApproval(id, {
        status,
        decidedBy: decided.decidedBy,
        decidedByName: decided.decidedByName,
        decidedAt,
        decisionComment: decided.decisionComment,
      });
      logAudit(saved, status);
    },
    [user, logAudit]
  );

  const approve = useCallback(
    (id: string, comment?: string) => decide(id, "approved", comment),
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
    request,
    approve,
    reject,
  };
}
