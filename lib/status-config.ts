import type { DependencyType, LifecycleStage, LeverStatus } from "@/types";

/**
 * Source unique des libellés du cycle de vie des leviers (fusion de l'ancien couple status /
 * maturityLevel) et des types de dépendance. Consommé par StageBadge, Kanban, formulaires,
 * filtres, Excel et le stepper du détail levier.
 *
 * Les libellés par défaut ci-dessous (STATUS_LABEL / STATUS_SHORT_LABEL / STATUS_LEVEL) servent de
 * base de repli pour les endroits sans contexte entreprise (Excel, moteur de calcul). Le référentiel
 * réellement affiché à l'utilisateur est la config par entreprise (`LifecycleConfig`, éditable dans
 * /admin/lifecycle et consommée via `useLifecycleLabels`) — voir plus bas.
 */

export const STATUS_LEVEL: Record<LeverStatus, string> = {
  idea: "1",
  qualified: "2",
  validated: "3",
  in_progress: "4",
  delivered: "5",
  cancelled: "—",
};

export const STATUS_SHORT_LABEL: Record<LeverStatus, string> = {
  idea: "Repérage",
  qualified: "Chiffrage",
  validated: "Décision",
  in_progress: "Déploiement",
  delivered: "Clôture",
  cancelled: "Annulé",
};

export const STATUS_LABEL: Record<LeverStatus, string> = {
  idea: "Piste repérée",
  qualified: "Business case chiffré",
  validated: "Décision de lancement",
  in_progress: "Déploiement en cours",
  delivered: "Valeur livrée",
  cancelled: "Annulé",
};

/** Cycle de vie par défaut, dans l'ordre (cancelled hors cycle). */
export const STATUS_CYCLE: LeverStatus[] = [
  "idea",
  "qualified",
  "validated",
  "in_progress",
  "delivered",
];

export const STATUS_ORDER: Record<LeverStatus, number> = {
  idea: 1,
  qualified: 2,
  validated: 3,
  in_progress: 4,
  delivered: 5,
  cancelled: 0,
};

// ─── Configurable lifecycle helpers ─────────────────────────────────────────

/** Référentiel de cycle de vie par défaut (5 étapes, seule la décision de lancement est une gate). */
export const DEFAULT_LIFECYCLE_STAGES: LifecycleStage[] = [
  { key: "idea", label: "Repérage", validationRequired: false },
  { key: "qualified", label: "Chiffrage", validationRequired: false },
  { key: "validated", label: "Décision de lancement", validationRequired: true },
  { key: "in_progress", label: "Déploiement", validationRequired: false },
  { key: "delivered", label: "Clôture", validationRequired: false },
];

/** Resolve label for a status, with optional per-company lifecycle override. When an override is
 * given, its stage label is used verbatim (no numeric prefix) — that's the whole point of making
 * the referential configurable rather than hardcoding a "L# · Word" convention. */
export function resolveStatusLabel(
  status: LeverStatus,
  lifecycleStages?: LifecycleStage[]
): string {
  if (status === "cancelled") return STATUS_LABEL.cancelled;
  if (lifecycleStages) {
    const stage = lifecycleStages.find((s) => s.key === status);
    if (stage) return stage.label;
  }
  return STATUS_LABEL[status];
}

/** Resolve short label for a status, with optional per-company lifecycle override. */
export function resolveStatusShortLabel(
  status: LeverStatus,
  lifecycleStages?: LifecycleStage[]
): string {
  if (status === "cancelled") return STATUS_SHORT_LABEL.cancelled;
  if (lifecycleStages) {
    const stage = lifecycleStages.find((s) => s.key === status);
    if (stage) return stage.label;
  }
  return STATUS_SHORT_LABEL[status];
}

/** Return only the active cycle stages for a given lifecycle config. */
export function resolveActiveCycle(lifecycleStages?: LifecycleStage[]): LeverStatus[] {
  if (!lifecycleStages) return STATUS_CYCLE;
  return lifecycleStages.map((s) => s.key);
}

export const DEPENDENCY_TYPE_LABEL: Record<DependencyType, string> = {
  FS: "Fin → Début",
  SS: "Début → Début",
  FF: "Fin → Fin",
  SF: "Début → Fin",
};

export const DEPENDENCY_TYPE_DESCRIPTION: Record<DependencyType, string> = {
  FS: "L'autre doit être terminé avant que celui-ci commence",
  SS: "Les deux doivent démarrer en même temps",
  FF: "Les deux doivent se terminer en même temps",
  SF: "L'autre doit avoir démarré avant que celui-ci se termine",
};

export const DEPENDENCY_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];
