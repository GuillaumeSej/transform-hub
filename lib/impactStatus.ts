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

/** Parse une date de l'app : une chaîne date seule ("YYYY-MM-DD") est une date CALENDAIRE LOCALE
 *  (minuit local) — `new Date("2026-03-01")` l'interprète en UTC, ce qui la décale à la veille
 *  dans un fuseau négatif (et fausse les comparaisons « date passée » autour de minuit). Toute
 *  autre forme (date-heure ISO…) est déléguée à `new Date`. */
export function parseLocalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(value);
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
  const d = parseLocalDate(start);
  if (Number.isNaN(d.getTime()) || d > today) return "planned";
  return isRecurringImpact(imp) ? "ongoing" : "done";
}

/**
 * RÈGLE UNIQUE « impact réalisé » (audit M7) — utilisée par le réalisé à date
 * (`engine.realizedSavings`/`realizedGrossSavings`/`realizedFte`, P&L, tableau Finance) ET, par
 * complément, par le retard (`isImpactLate` → `engine` « En retard ») : un impact est réalisé quand
 * son statut effectif (`impactStatusOf` : explicite, sinon dérivé de sa date de début — ce que
 * montre la case « Réalisé » de l'éditeur d'impacts) n'est pas « planned » ET qu'il n'attend pas
 * la validation finance (`realizedApproval.status === "pending"`). Sans workflow de validation
 * (champ absent, données antérieures) ou une fois approuvé, il compte. Un impact rejeté est repassé
 * « planned » par `decideImpactRealized`, donc non réalisé.
 */
export function isImpactRealized(imp: LeverImpact, today: Date = new Date()): boolean {
  if (impactStatusOf(imp, today) === "planned") return false;
  return imp.realizedApproval?.status !== "pending";
}

/**
 * Impact « en retard » — complément exact de `isImpactRealized` (jamais les deux à la fois) : non
 * réalisé, PAS en attente de validation finance (déjà déclaré réalisé : c'est la validation qui
 * est attendue, pas l'exécution), et dont la date de début (sinon `fallbackDate`, ex. fin du
 * levier) est passée. Avec la règle de dérivation par date de `impactStatusOf`, cela vise les
 * impacts explicitement laissés/remis « planifiés » (décochés, ou rejetés par la finance) après
 * leur date prévue. `fallbackDate` (ex. fin du levier) ne sert que d'ÉCHÉANCE à un impact sans
 * date propre — il ne le rend jamais « réalisé » (un impact sans date n'est réalisé que coché).
 */
export function isImpactLate(
  imp: LeverImpact,
  today: Date = new Date(),
  fallbackDate?: string
): boolean {
  if (isImpactRealized(imp, today)) return false;
  if (imp.realizedApproval?.status === "pending") return false;
  const start = impactStartDateOf(imp) ?? fallbackDate;
  if (!start) return false;
  const d = parseLocalDate(start);
  return !Number.isNaN(d.getTime()) && d.getTime() < today.getTime();
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
