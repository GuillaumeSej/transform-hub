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

/**
 * Horodatage d'une entrée d'audit (`AuditEntry.ts`) : ISO 8601 UTC complet, avec « Z » (lot 5).
 * Auparavant « AAAA-MM-JJ HH:MM » — heure UTC SANS fuseau, que `new Date()` relisait comme une
 * heure LOCALE (décalage de 1 à 2 h en Europe/Paris dans l'historique admin).
 */
export function auditTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

/** Ancien format « AAAA-MM-JJ HH:MM[:SS] » (UTC implicite, sans « Z »). */
const LEGACY_AUDIT_TS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/** Instant d'un horodatage d'audit — nouveau format ISO avec « Z » comme anciennes entrées sans
 *  fuseau (lues en UTC, comme elles ont été écrites). `null` si illisible. */
export function parseAuditTimestamp(ts: string | undefined | null): Date | null {
  if (!ts) return null;
  const legacy = LEGACY_AUDIT_TS.exec(ts.trim());
  const d = new Date(legacy ? `${legacy[1]}T${legacy[2]}Z` : ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Tri antichronologique (plus récent d'abord) d'entrées d'audit aux deux formats d'horodatage. */
export function compareAuditTsDesc(a: { ts: string }, b: { ts: string }): number {
  return (parseAuditTimestamp(b.ts)?.getTime() ?? 0) - (parseAuditTimestamp(a.ts)?.getTime() ?? 0);
}

/** « 03/10/2026 16:05 » dans la langue et le fuseau du navigateur ; texte brut si illisible. */
export function formatAuditTimestamp(ts: string, locale: string): string {
  const d = parseAuditTimestamp(ts);
  if (!d) return ts;
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
