import type { MovementStatus, MovementType } from "@/types";
import { EXECUTION_LABELS, type MovementExecutionStatus } from "@/lib/hrExecution";
import type { MovementAlert } from "@/lib/hrEngine";

/** Signature de `t` (useTranslation) — passée en argument pour garder ce module pur (sans hook). */
type Translate = (key: string, fallback?: string) => string;

/**
 * Libellés affichables (traduits) des énumérations RH. Les valeurs métier (`MovementType`,
 * `MovementStatus`, `EXECUTION_LABELS`) restent en français car elles sont persistées, filtrées et
 * échangées via Excel/URL : seul l'AFFICHAGE passe par ces helpers. Le libellé français d'origine
 * sert de fallback, donc une valeur inconnue s'affiche telle quelle.
 */
const MOVEMENT_TYPE_KEYS: Record<MovementType, string> = {
  Recrutement: "hr.movementType.recruitment",
  Attrition: "hr.movementType.attrition",
  "Départ forcé": "hr.movementType.forcedDeparture",
  "Transfert entrant": "hr.movementType.transferIn",
  "Transfert sortant": "hr.movementType.transferOut",
};

const MOVEMENT_STATUS_KEYS: Record<MovementStatus, string> = {
  Réalisé: "hr.movementStatus.done",
  Planifié: "hr.movementStatus.planned",
  "À faire": "hr.movementStatus.todo",
  Abandonné: "hr.movementStatus.abandoned",
};

const EXECUTION_KEYS: Record<MovementExecutionStatus | "toValidate", string> = {
  realized: "hr.execution.realized",
  overdue: "hr.execution.overdue",
  dueSoon: "hr.execution.dueSoon",
  later: "hr.execution.later",
  abandoned: "hr.execution.abandoned",
  toValidate: "hr.execution.toValidate",
};

export function movementTypeLabel(t: Translate, type: string): string {
  const key = MOVEMENT_TYPE_KEYS[type as MovementType];
  return key ? t(key, type) : type;
}

export function movementStatusLabel(t: Translate, status: string): string {
  const key = MOVEMENT_STATUS_KEYS[status as MovementStatus];
  return key ? t(key, status) : status;
}

export function executionLabel(
  t: Translate,
  status: MovementExecutionStatus | "toValidate"
): string {
  return t(EXECUTION_KEYS[status], EXECUTION_LABELS[status]);
}

const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;

/** Message d'alerte mouvement traduit, reconstruit depuis `alert.detail` (données structurées de
 *  `movementAlerts`, lib/hrEngine.ts) ; retombe sur `alert.message` (français) sans détail. */
export function movementAlertMessage(t: Translate, alert: MovementAlert): string {
  const m = alert.movement;
  const d = alert.detail;
  if (!d) return alert.message;
  const fill = (tpl: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), tpl);
  switch (d.reason) {
    case "toValidate":
      return fill(
        t("hr.alertMessage.toValidate", "{label} — réalisé le {date}, en attente de validation RH"),
        { label: m.label, date: d.actualDate }
      );
    case "overdue":
      return fill(
        t("hr.alertMessage.overdue", "{label} — échéance dépassée de {days} j (prévu le {date})"),
        { label: m.label, days: d.daysLate, date: m.plannedDate }
      );
    case "due":
      return fill(t("hr.alertMessage.due", "{label} — échéance dans {days} j ({date})"), {
        label: m.label,
        days: d.daysLeft,
        date: m.plannedDate,
      });
    case "leverCancelled":
      return fill(
        t(
          "hr.alertMessage.leverCancelled",
          "{label} — le levier {code} est annulé, mouvement à requalifier"
        ),
        { label: m.label, code: d.leverCode }
      );
    case "afterLeverEnd":
      return fill(
        t(
          "hr.alertMessage.afterLeverEnd",
          "{label} — planifié le {date}, après la fin du levier {code} ({end})"
        ),
        { label: m.label, date: d.plannedDate, code: d.leverCode, end: d.leverEnd }
      );
    case "signMismatch":
      return fill(
        t(
          "hr.alertMessage.signMismatch",
          "{label} — sens ({fte} ETP) contraire à l'impact visé du levier {code} ({leverFte} ETP)"
        ),
        {
          label: m.label,
          fte: signed(d.movementFte),
          code: d.leverCode,
          leverFte: signed(d.leverFte),
        }
      );
    default:
      return alert.message;
  }
}

/** Traduit une valeur `EXECUTION_LABELS` (libellé français stocké tel quel dans les lignes de
 *  tableau / filtres d'URL `f_execution`) vers la langue active. Valeur inconnue : inchangée. */
export function executionLabelFromValue(t: Translate, value: string): string {
  const entry = (Object.keys(EXECUTION_LABELS) as (keyof typeof EXECUTION_LABELS)[]).find(
    (k) => EXECUTION_LABELS[k] === value
  );
  return entry ? executionLabel(t, entry) : value;
}
