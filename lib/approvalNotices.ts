import type { StrategicApproval } from "@/lib/strategicApprovals";

/**
 * Notifications « votre demande a été validée / refusée » pour la personne qui a DEMANDÉ
 * (cloche). Dérivées côté client des demandes décidées récemment — aucune donnée stockée en plus.
 * Fenêtre de `days` jours après la décision (7 par défaut) ; une demande décidée par son propre
 * auteur (pilote/admin qui applique directement) ne notifie personne.
 * Lot 5 : la cloche ne s'en sert PLUS (doublon de l'alerte `…-decision` de `buildApprovalAlerts`,
 * lib/strategicApprovals.ts, seule conservée) — gardé pour compatibilité, sans appelant applicatif.
 */
export type DecisionNotice = {
  id: string;
  approvalId: string;
  status: "approved" | "rejected";
  kind: StrategicApproval["kind"];
  targetType: StrategicApproval["targetType"];
  targetId: string;
  targetName: string;
  decidedBy: string;
  decidedByName: string;
  decidedAt: string;
  comment?: string;
};

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.slice(0, 10));
  const b = Date.parse(toIso.slice(0, 10));
  return Math.round((b - a) / 86_400_000);
}

export function decisionNoticesFor(
  username: string | null | undefined,
  approvals: StrategicApproval[],
  today: string,
  days = 7
): DecisionNotice[] {
  if (!username) return [];
  return approvals
    .filter(
      (a) =>
        a.requestedBy === username &&
        (a.status === "approved" || a.status === "rejected") &&
        !!a.decidedAt &&
        a.decidedBy !== username &&
        daysBetween(a.decidedAt, today) <= days &&
        daysBetween(a.decidedAt, today) >= 0
    )
    .sort((x, y) => (y.decidedAt ?? "").localeCompare(x.decidedAt ?? ""))
    .map((a) => ({
      id: `decision-${a.id}`,
      approvalId: a.id,
      status: a.status as "approved" | "rejected",
      kind: a.kind,
      targetType: a.targetType,
      targetId: a.targetId,
      targetName: a.targetName ?? a.targetId,
      decidedBy: a.decidedBy ?? "",
      decidedByName: a.decidedByName ?? a.decidedBy ?? "",
      decidedAt: a.decidedAt as string,
      ...(a.decisionComment ? { comment: a.decisionComment } : {}),
    }));
}

/** « Demande envoyée — en attente de validation par A / B, puis C » à partir des noms par étape. */
export function pendingSubmissionMessage(
  stepNames: string[][],
  templates: { withChain: string; noChain: string; joiner: string }
): string {
  const chain = stepNames
    .map((names) => names.filter(Boolean).join(" / "))
    .filter(Boolean)
    .join(` ${templates.joiner} `);
  return chain ? templates.withChain.replace("{chain}", chain) : templates.noChain;
}
