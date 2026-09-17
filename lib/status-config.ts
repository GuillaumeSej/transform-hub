import type { DependencyType, LeverApprovalGate, LifecycleStage, LeverStatus } from "@/types";

/**
 * Source unique des libellés du cycle de vie des leviers (fusion de l'ancien couple status /
 * maturityLevel) et des types de dépendance. Consommé par StageBadge, Kanban, formulaires,
 * filtres, Excel et le stepper du détail levier.
 *
 * Les libellés par défaut ci-dessous (STATUS_LABEL / STATUS_SHORT_LABEL / STATUS_LEVEL) servent de
 * base de repli pour les endroits sans contexte programme (Excel, moteur de calcul). Le référentiel
 * réellement affiché à l'utilisateur est la config PAR PROGRAMME (`LifecycleStage[]`, éditable
 * depuis la fiche « Gérer » d'un programme Performance dans `components/admin/ProgramsPanel.tsx` et
 * consommée via `useLifecycleLabels`) — voir plus bas.
 */

export const STATUS_LEVEL: Record<LeverStatus, string> = {
  idea: "M1",
  qualified: "M2",
  validated: "M3",
  in_progress: "M4",
  delivered: "M5",
  cancelled: "—",
};

export const STATUS_SHORT_LABEL: Record<LeverStatus, string> = {
  idea: "Identifié",
  qualified: "Validé",
  validated: "Planifié",
  in_progress: "Exécuté",
  delivered: "Réalisé",
  cancelled: "Abandonné",
};

export const STATUS_LABEL: Record<LeverStatus, string> = {
  idea: "Levier identifié",
  qualified: "Business case validé",
  validated: "Implémentation planifiée",
  in_progress: "En cours d'exécution",
  delivered: "Valeur réalisée",
  cancelled: "Levier abandonné",
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

/** Statut de départ pour chacune des 3 portes de validation (voir `LeverApprovalGate`) — dérivé
 *  de `STATUS_CYCLE` (l'étape juste avant la cible) plutôt que dupliqué en dur dans
 *  `lib/leversLogic.ts`. */
export const PREREQUISITE_STATUS: Record<LeverApprovalGate, LeverStatus> = STATUS_CYCLE.slice(
  1
).reduce(
  (acc, status, i) => {
    if (status === "qualified" || status === "validated" || status === "in_progress") {
      acc[status] = STATUS_CYCLE[i];
    }
    return acc;
  },
  {} as Record<LeverApprovalGate, LeverStatus>
);

/** Inverse de `PREREQUISITE_STATUS` : la porte à franchir depuis un statut donné, s'il y en a
 *  une (`idea`/`qualified`/`validated` seulement — `in_progress`/`delivered`/`cancelled` n'ont
 *  pas de porte suivante). */
export const GATE_BY_STATUS: Partial<Record<LeverStatus, LeverApprovalGate>> = Object.fromEntries(
  (Object.entries(PREREQUISITE_STATUS) as [LeverApprovalGate, LeverStatus][]).map(
    ([gate, prerequisite]) => [prerequisite, gate]
  )
);

// ─── Configurable lifecycle helpers ─────────────────────────────────────────

/** Référentiel de cycle de vie par défaut (5 étapes, seule la décision de lancement est une gate). */
export const DEFAULT_LIFECYCLE_STAGES: LifecycleStage[] = [
  { key: "idea", label: "Identifié", validationRequired: false },
  { key: "qualified", label: "Validé", validationRequired: true },
  { key: "validated", label: "Planifié", validationRequired: false },
  { key: "in_progress", label: "Exécuté", validationRequired: false },
  { key: "delivered", label: "Réalisé", validationRequired: false },
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

export const DEPENDENCY_TYPE_META: Record<
  DependencyType,
  {
    code: DependencyType;
    sourceMilestone: "Début" | "Fin";
    targetMilestone: "Début" | "Fin";
    directional: boolean;
  }
> = {
  FS: { code: "FS", sourceMilestone: "Début", targetMilestone: "Fin", directional: true },
  SS: { code: "SS", sourceMilestone: "Début", targetMilestone: "Début", directional: false },
  FF: { code: "FF", sourceMilestone: "Fin", targetMilestone: "Fin", directional: false },
  SF: { code: "SF", sourceMilestone: "Fin", targetMilestone: "Début", directional: true },
};

export const DEPENDENCY_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];
