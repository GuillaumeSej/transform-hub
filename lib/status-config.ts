import type { DependencyType, LeverStatus } from "@/types";

/**
 * Source unique des libellés du cycle de vie L1-L5 (fusion de l'ancien couple status /
 * maturityLevel) et des types de dépendance. Consommé par StageBadge, Kanban, formulaires,
 * filtres, Excel et le stepper du détail levier.
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
