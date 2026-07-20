import type { DependencyType, LifecycleStage, LeverStatus } from "@/types";

/**
 * Source unique des libellés du cycle de vie L1-L5 (fusion de l'ancien couple status /
 * maturityLevel) et des types de dépendance. Consommé par StageBadge, Kanban, formulaires,
 * filtres, Excel et le stepper du détail levier.
 *
 * Les libellés par défaut sont utilisés quand aucune configuration par entreprise n'est définie.
 */

export const STATUS_LEVEL: Record<LeverStatus, string> = {
  idea: "L1",
  qualified: "L2",
  validated: "L3",
  in_progress: "L4",
  delivered: "L5",
  cancelled: "—",
};

export const STATUS_SHORT_LABEL: Record<LeverStatus, string> = {
  idea: "Idée",
  qualified: "Qualifié",
  validated: "Validé",
  in_progress: "Planifié",
  delivered: "Réalisé",
  cancelled: "Annulé",
};

export const STATUS_LABEL: Record<LeverStatus, string> = {
  idea: "L1 · Idée",
  qualified: "L2 · Qualifié",
  validated: "L3 · Validé",
  in_progress: "L4 · Planifié",
  delivered: "L5 · Réalisé",
  cancelled: "Annulé",
};

/** Cycle L1→L5 dans l'ordre (cancelled hors cycle). */
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

/** Default lifecycle config (5 stages, only L3 validated = gate). */
export const DEFAULT_LIFECYCLE_STAGES: LifecycleStage[] = [
  { key: "idea", label: "Idée", validationRequired: false },
  { key: "qualified", label: "Qualifié", validationRequired: false },
  { key: "validated", label: "Validé", validationRequired: true },
  { key: "in_progress", label: "Planifié", validationRequired: false },
  { key: "delivered", label: "Réalisé", validationRequired: false },
];

/** Resolve label for a status, with optional per-company lifecycle override. */
export function resolveStatusLabel(
  status: LeverStatus,
  lifecycleStages?: LifecycleStage[]
): string {
  if (status === "cancelled") return "Annulé";
  if (lifecycleStages) {
    const stage = lifecycleStages.find((s) => s.key === status);
    if (stage) {
      const level = STATUS_LEVEL[status];
      return `${level} · ${stage.label}`;
    }
  }
  return STATUS_LABEL[status];
}

/** Resolve short label for a status, with optional per-company lifecycle override. */
export function resolveStatusShortLabel(
  status: LeverStatus,
  lifecycleStages?: LifecycleStage[]
): string {
  if (status === "cancelled") return "Annulé";
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
