import type { AuthUser, LeverImpact } from "@/types";
import { hasRole } from "@/lib/roleProfiles";

export type ImpactStatus = NonNullable<LeverImpact["status"]>;

/** Impact récurrent (gain annualisé, OPEX récurrent, ETP) vs ponctuel (CAPEX, one-off). */
export function isRecurringImpact(imp: LeverImpact): boolean {
  if (imp.type === "fte") return true;
  if (imp.type === "saving") return imp.gainRecurrence !== "oneoff";
  return imp.nature === "opex_rec";
}

/** Date de début propre à l'impact (sans repli sur le levier). */
export function impactStartDateOf(imp: LeverImpact): string | undefined {
  const isGain = imp.type === "saving" || (imp.type === "fte" && imp.fteDirection === "departure");
  return isGain ? imp.gainDate : (imp.capexStartDate ?? imp.capexDeploymentDate);
}

/** Statuts autorisés : ponctuel → planned/done ; récurrent → planned/ongoing. */
export function allowedImpactStatuses(imp: LeverImpact): ImpactStatus[] {
  return isRecurringImpact(imp) ? ["planned", "ongoing"] : ["planned", "done"];
}

/** Statut valide pour la nature de l'impact (done ↔ ongoing selon récurrence). */
export function coerceImpactStatus(imp: LeverImpact, status: ImpactStatus): ImpactStatus {
  if (status === "planned") return status;
  return isRecurringImpact(imp) ? "ongoing" : "done";
}

/**
 * Statut effectif d'un impact. Champ explicite s'il existe (normalisé selon la récurrence) ;
 * sinon dérivé de la date de début : futur ou absente → planned ; passée → done (ponctuel) /
 * ongoing (récurrent). `fallbackDate` sert quand l'impact n'a pas de date propre.
 */
export function impactStatusOf(
  imp: LeverImpact,
  today: Date = new Date(),
  fallbackDate?: string
): ImpactStatus {
  if (imp.status) return coerceImpactStatus(imp, imp.status);
  const start = impactStartDateOf(imp) ?? fallbackDate;
  if (!start) return "planned";
  const d = new Date(start);
  if (Number.isNaN(d.getTime()) || d > today) return "planned";
  return isRecurringImpact(imp) ? "ongoing" : "done";
}

/** Un profil finance peut décider (approuver/rejeter) la validation d'un impact réalisé. */
export function canDecideImpactRealized(
  user: Pick<AuthUser, "profiles"> | null | undefined
): boolean {
  return hasRole(user, "finance");
}

/** L'impact est-il coché "Réalisé" en attente de validation finance ? */
export function isImpactRealizedPending(imp: LeverImpact): boolean {
  const status = impactStatusOf(imp);
  return (status === "done" || status === "ongoing") && imp.realizedApproval?.status === "pending";
}

/**
 * Patch à appliquer quand un utilisateur coche/décoche "Réalisé" sur une ligne d'impact.
 * - Décoche (retour à "planned") → on efface l'approbation en cours.
 * - Coche, profil finance → validé directement ("approved").
 * - Coche, autre profil (lever/CTO/resp. de chantier…) → passe "pending", en attente d'un profil
 *   finance (voir `canDecideImpactRealized`/`isImpactRealizedPending`).
 */
export function realizedTogglePatch(
  imp: LeverImpact,
  checked: boolean,
  user: Pick<AuthUser, "profiles" | "name"> | null | undefined
): Partial<LeverImpact> {
  if (!checked) {
    return { status: "planned", realizedApproval: undefined };
  }
  const status = coerceImpactStatus(imp, "done");
  const now = new Date().toISOString();
  if (canDecideImpactRealized(user)) {
    return {
      status,
      realizedApproval: {
        status: "approved",
        decidedBy: user?.name,
        decidedAt: now,
      },
    };
  }
  return {
    status,
    realizedApproval: {
      status: "pending",
      requestedBy: user?.name,
      requestedAt: now,
    },
  };
}

/** Décision finance sur une ligne en attente ("approved"/"rejected"). Rejeter repasse l'impact en
 *  "planned" (le statut "Réalisé" n'est valide qu'une fois approuvé). */
export function decideImpactRealized(
  imp: LeverImpact,
  decision: "approved" | "rejected",
  user: Pick<AuthUser, "profiles" | "name"> | null | undefined
): Partial<LeverImpact> {
  const now = new Date().toISOString();
  if (decision === "rejected") {
    return {
      status: "planned",
      realizedApproval: { status: "rejected", decidedBy: user?.name, decidedAt: now },
    };
  }
  return {
    realizedApproval: {
      ...imp.realizedApproval,
      status: "approved",
      decidedBy: user?.name,
      decidedAt: now,
    },
  };
}
