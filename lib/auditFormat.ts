/**
 * Valeur « ancienne / nouvelle » d'une entrée du journal d'audit, lisible par un humain (audit
 * DB-17). `String(objet)` écrivait « [object Object] » dans le journal dès qu'un champ non
 * scalaire changeait (impacts, actions, effort d'un chantier…) : 61 entrées ACME inexploitables.
 *  - scalaire → tel quel ; absent → chaîne vide ;
 *  - liste → « n élément(s) », ou les libellés si ce sont des chaînes courtes ;
 *  - objet → son libellé/nom s'il en a un, sinon un JSON compact tronqué.
 */
export function formatAuditValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      const joined = value.join(", ");
      if (joined.length <= 80) return joined;
    }
    return `${value.length} élément${value.length > 1 ? "s" : ""}`;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const named = o.label ?? o.name;
    if (typeof named === "string") return named;
    const json = JSON.stringify(value);
    return json.length > 80 ? `${json.slice(0, 77)}…` : json;
  }
  return String(value);
}

/** Affichage d'une valeur déjà stockée : les anciennes entrées « [object Object] » ne peuvent
 *  pas être reconstituées — on le dit plutôt que d'afficher un artefact technique. */
export function displayAuditValue(value: unknown): string {
  const text = formatAuditValue(value);
  return text.includes("[object Object]") ? "(détail non enregistré)" : text;
}
