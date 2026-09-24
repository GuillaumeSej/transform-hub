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

const APPROVAL_GATES: readonly LeverApprovalGate[] = ["qualified", "validated", "in_progress"];

/** Portes de validation EFFECTIVES (étapes à n'atteindre que via demande → approbation) selon le
 *  référentiel de cycle de vie du programme : les étapes `qualified`/`validated`/`in_progress`
 *  dont l'admin a coché « validation requise » (`LifecycleStage.validationRequired`, éditeur
 *  `components/admin/LifecycleEditor.tsx`). Sans référentiel fourni (appelant sans contexte
 *  programme : import, scripts, tests historiques) → les 3 portes, comportement historique. */
export function gatedStatusesFor(lifecycleStages?: LifecycleStage[]): LeverApprovalGate[] {
  if (!lifecycleStages || lifecycleStages.length === 0) return [...APPROVAL_GATES];
  return APPROVAL_GATES.filter(
    (gate) => lifecycleStages.find((s) => s.key === gate)?.validationRequired === true
  );
}

/** Première porte de validation (au sens de `gatedStatusesFor`) franchie par la transition
 *  `from` → `to` : une porte est franchie si elle se situe entre le statut de départ (exclu) et la
 *  cible (incluse) — viser une étape au-delà d'une porte ne la contourne pas. `undefined` si la
 *  transition ne franchit aucune porte (statut inchangé, abandon, régression, étapes libres).
 *  Règle unique partagée par `updateLever` (lib/leversLogic.ts), le stepper de la fiche levier et
 *  la garde de statut de l'import Excel (lib/leverExcelImport.ts). */
export function gateCrossedBy(
  from: LeverStatus,
  to: LeverStatus,
  lifecycleStages?: LifecycleStage[]
): LeverApprovalGate | undefined {
  if (from === to || to === "cancelled") return undefined;
  return gatedStatusesFor(lifecycleStages).find(
    (gate) => STATUS_ORDER[gate] > STATUS_ORDER[from] && STATUS_ORDER[gate] <= STATUS_ORDER[to]
  );
}

/** Porte de validation à franchir DEPUIS `status` (l'étape suivante du cycle, si elle est une
 *  porte effective — voir `gatedStatusesFor`). Sans référentiel : `GATE_BY_STATUS` historique. */
export function nextGateFor(
  status: LeverStatus,
  lifecycleStages?: LifecycleStage[]
): LeverApprovalGate | undefined {
  if (!lifecycleStages || lifecycleStages.length === 0) return GATE_BY_STATUS[status];
  const idx = STATUS_CYCLE.indexOf(status);
  if (idx === -1) return undefined;
  const next = STATUS_CYCLE[idx + 1];
  return (gatedStatusesFor(lifecycleStages) as LeverStatus[]).includes(next)
    ? (next as LeverApprovalGate)
    : undefined;
}

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
