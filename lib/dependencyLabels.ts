import type { DependencyType } from "@/types";
import { DEPENDENCY_TYPE_DESCRIPTION, DEPENDENCY_TYPE_LABEL } from "@/lib/status-config";
import type { DependencyAlert } from "@/lib/engine";

/** Signature de `t` (useTranslation) — passée en argument pour garder ce module pur (sans hook). */
type Translate = (key: string, fallback?: string) => string;

/**
 * Libellés affichables (traduits) des dépendances entre leviers. Les constantes françaises de
 * `lib/status-config.ts` (`DEPENDENCY_TYPE_LABEL`/`_DESCRIPTION`/`_META`) et le `message` de
 * `DependencyAlert` (lib/engine.ts) restent la source de repli ; seul l'affichage passe par ici.
 */
export function dependencyTypeLabel(t: Translate, type: DependencyType): string {
  return t(`dependency.type.${type}.label`, DEPENDENCY_TYPE_LABEL[type]);
}

export function dependencyTypeDescription(t: Translate, type: DependencyType): string {
  return t(`dependency.type.${type}.description`, DEPENDENCY_TYPE_DESCRIPTION[type]);
}

/** Jalon "Début" / "Fin" de `DEPENDENCY_TYPE_META.*Milestone`. */
export function dependencyMilestoneLabel(t: Translate, milestone: "Début" | "Fin"): string {
  return milestone === "Début"
    ? t("dependency.milestone.start", "Début")
    : t("dependency.milestone.end", "Fin");
}

const MESSAGE_FALLBACK: Record<DependencyType, string> = {
  FS: '"{target}" se termine {days} jours après le début prévu de "{source}"',
  SS: '"{source}" et "{target}" ont {days} jours de décalage au démarrage',
  FF: '"{source}" et "{target}" ont {days} jours de décalage à la fin',
  SF: '"{target}" démarre {days} jours après la fin prévue de "{source}"',
};

/** Message traduit d'une dépendance violée, reconstruit depuis les champs structurés. */
export function dependencyAlertMessage(
  t: Translate,
  alert: Pick<DependencyAlert, "type" | "sourceName" | "targetName" | "delayDays">
): string {
  return t(`dependency.alert.${alert.type}`, MESSAGE_FALLBACK[alert.type])
    .split("{source}")
    .join(alert.sourceName)
    .split("{target}")
    .join(alert.targetName)
    .split("{days}")
    .join(String(alert.delayDays));
}
