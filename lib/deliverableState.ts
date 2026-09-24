import type { Deliverable } from "@/types";
import { daysBetween } from "@/lib/dateUtils";

/**
 * Livrable = ÉCHÉANCE, pas une plage (décision PO) : « tel jour tu dois l'avoir fait ». Une seule
 * date (`Deliverable.dueDate`, libellée "Échéance") et un statut BINAIRE Fait / À faire.
 *
 * Rétrocompatibilité (aucune migration Firestore) :
 *  - `status: "in_progress"` (ancien 3e état « En cours ») est LU comme « à faire » ;
 *  - les dates de début (`Deliverable.phases[].start`) sont ignorées ; un livrable historique sans
 *    `dueDate` autonome garde comme échéance la FIN de sa dernière phase (`effectiveDueDate`).
 *
 * L'état affiché (`deliverableState`) ajoute un 3e cas DÉRIVÉ, jamais stocké : « en retard » = à
 * faire ET échéance strictement dépassée.
 */
export type DeliverableState = "done" | "late" | "todo";

/** Échéance EFFECTIVE d'un livrable : sa `dueDate` si déclarée, sinon la fin de sa DERNIÈRE phase
 *  (données historiques uniquement — plus aucune phase n'est saisie). `undefined` si ni l'une ni
 *  l'autre. */
export function effectiveDueDate(
  d: Pick<Deliverable, "dueDate"> & { phases?: Deliverable["phases"] }
): string | undefined {
  return d.dueDate || d.phases?.[d.phases.length - 1]?.end || undefined;
}

/** Statut binaire : seul `"done"` compte comme fait ; `"todo"`, `"in_progress"` (legacy) et
 *  `undefined` sont « à faire ». */
export function isDeliverableDone(d: Pick<Deliverable, "status">): boolean {
  return d.status === "done";
}

/** « Aujourd'hui » en ISO local "YYYY-MM-DD" (pas `toISOString`, qui passerait en UTC et
 *  décalerait d'un jour autour de minuit). Une chaîne est renvoyée telle quelle (tronquée au jour). */
export function toISODay(today: Date | string): string {
  if (typeof today === "string") return today.slice(0, 10);
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type DeliverableLike = Pick<Deliverable, "status" | "dueDate"> & {
  phases?: Deliverable["phases"];
};

/** État affiché d'un livrable : `"done"` si fait ; `"late"` si à faire et échéance < aujourd'hui
 *  (l'échéance du jour même n'est PAS en retard) ; `"todo"` sinon (y compris sans échéance). */
export function deliverableState(
  d: DeliverableLike,
  today: Date | string = new Date()
): DeliverableState {
  if (isDeliverableDone(d)) return "done";
  const due = effectiveDueDate(d);
  if (due && due < toISODay(today)) return "late";
  return "todo";
}

/** Nombre de jours de retard (> 0) d'un livrable en retard, 0 sinon. */
export function deliverableLateDays(d: DeliverableLike, today: Date | string = new Date()): number {
  if (deliverableState(d, today) !== "late") return 0;
  return Math.max(0, daysBetween(effectiveDueDate(d)!, toISODay(today)));
}

/** Décompte par état — 2 statuts stockés (fait / à faire) + le retard dérivé : `late` est un
 *  SOUS-ENSEMBLE des « à faire » (`todo` ici = à faire NON en retard), `total` = done + todo + late. */
export function countDeliverableStates(
  list: DeliverableLike[],
  today: Date | string = new Date()
): { done: number; todo: number; late: number; total: number } {
  const counts = { done: 0, todo: 0, late: 0, total: list.length };
  for (const d of list) counts[deliverableState(d, today)] += 1;
  return counts;
}
