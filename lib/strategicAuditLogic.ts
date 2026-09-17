import type { AuditEntry } from "@/types";

/**
 * Logique pure de construction des entrées d'audit du Plan Stratégique (axes/chantiers/projets/
 * indicateurs) — pendant de `lib/leversLogic.ts`/`lib/workforceLogic.ts` (mêmes conventions
 * `AuditEntry`/`makeAuditEntry`, voir leurs commentaires de tête), mais extrait dans son propre
 * fichier plutôt que dupliqué localement dans `lib/hooks/useStrategicData.ts` : contrairement au
 * reste de ce hook (qui écrit directement dans Firestore sans couche de logique pure
 * intermédiaire, voir son commentaire de tête), la construction des entrées d'audit gagne à rester
 * pure/testable comme les deux modules historiques ci-dessus plutôt que d'être noyée dans des
 * callbacks React connectés à Firestore.
 *
 * Convention de granularité (identique à `leversLogic.createLever`/`updateLever` pour les entités
 * de premier niveau) :
 *   - création : UNE entrée, `field` = le type d'entité (ex. "axe"), `new` = son nom ;
 *   - suppression : UNE entrée, mêmes `field`, `old` = son nom, `new` = "supprimé" (comme
 *     `workforceLogic.deleteMovement`) ;
 *   - mise à jour : UNE entrée PAR CHAMP effectivement modifié, mais UNIQUEMENT parmi les champs
 *     explicitement présents dans le `patch` de l'appelant (jamais les champs injectés
 *     automatiquement comme `lastUpdate`) — même règle que `leversLogic.updateLever`, qui itère
 *     `Object.keys(safePatch)` et non `Object.keys(after)`.
 */

function nowTs(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

export function makeAuditEntry(entry: Omit<AuditEntry, "ts">): AuditEntry {
  return { ...entry, ts: nowTs() };
}

export function makeCreatedAuditEntry(
  user: string,
  entity: string,
  field: string,
  name: string
): AuditEntry {
  return makeAuditEntry({ user, action: "created", entity, field, old: "", new: name });
}

export function makeDeletedAuditEntry(
  user: string,
  entity: string,
  field: string,
  name: string
): AuditEntry {
  return makeAuditEntry({ user, action: "deleted", entity, field, old: name, new: "supprimé" });
}

/**
 * Une entrée "updated" par champ modifié — comparaison `JSON.stringify` (comme
 * `workforceLogic.updateMovement`) pour rester correcte sur les champs non scalaires (ex.
 * `Chantier.axisIds`, `ChantierAction.deliverables`), pas seulement `===` (suffisant pour
 * `leversLogic.updateLever`, dont les champs patchés sont tous scalaires).
 */
export function buildUpdateAuditEntries<T extends Record<string, unknown>>(
  user: string,
  entity: string,
  patch: Partial<T>,
  before: T,
  after: T
): AuditEntry[] {
  return (Object.keys(patch) as (keyof T)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) =>
      makeAuditEntry({
        user,
        action: "updated",
        entity,
        field: String(k),
        old: String(before[k] ?? ""),
        new: String(after[k] ?? ""),
      })
    );
}
