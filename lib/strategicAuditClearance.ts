import { isAnyAdmin } from "@/lib/roleProfiles";
import {
  approvalTargetLevels,
  levelsAccessibleTo,
  OUT_OF_SCOPE_APPROVAL_LABEL,
  strategicClearanceOf,
  strategicTargetLevels,
  unionLevels,
  type StrategicConfidentialityConfig,
} from "@/lib/strategicApprovalClearance";
import type {
  ChantierCreateApprovalPayload,
  StrategicApproval,
  StrategicApprovalTargetType,
} from "@/lib/strategicApprovals";
import type {
  AuditEntry,
  AuthUser,
  Chantier,
  ChantierAction,
  Indicator,
  StrategicAxis,
} from "@/types";

/**
 * CONFIDENTIALITÉ DU JOURNAL (/admin/history) — lot 6, décision PO « option A » étendue au
 * journal : un lecteur non admin ne voit JAMAIS le contenu d'une entrée dont la cible (axe,
 * chantier, projet, indicateur du Plan Stratégique) dépasse son habilitation. L'entrée reste
 * listée (date, auteur, type d'action) mais la cible est remplacée par « Élément hors de votre
 * périmètre », sans nom, valeurs avant/après, motif ni commentaire.
 *
 * Niveaux d'une entrée = union de :
 *  - ceux ENREGISTRÉS à l'écriture (`AuditEntry.targetConfidentiality`, lot 6) — couvrent un
 *    élément supprimé depuis ;
 *  - ceux de la cible résolue sur les données ACTUELLES de l'entreprise (toutes collections, non
 *    filtrées) — couvrent les entrées d'avant ce lot et un élément devenu confidentiel depuis.
 *    Création d'axe / de chantier par demande : l'élément créé est retrouvé via la demande
 *    (`StrategicApproval.payload`), la cible de l'entrée n'étant que l'axe de rattachement.
 * Aucun des deux (entrée ancienne dont la cible n'existe plus) : masquée par PRUDENCE pour un
 * non-admin. Les admins voient tout. Les entrées hors Plan Stratégique (leviers, RH) ne sont pas
 * concernées.
 */

export const OUT_OF_SCOPE_AUDIT_LABEL = OUT_OF_SCOPE_APPROVAL_LABEL;

/** Données nécessaires à la résolution (TOUTE l'entreprise, avant tout filtrage d'affichage). */
export type AuditClearanceData = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  indicators: Indicator[];
  /** Demandes de validation de l'entreprise (élément créé par une demande). */
  approvals?: StrategicApproval[];
  /** Paramètres de confidentialité de l'entreprise ; `null` = en cours de chargement (toute
   *  entrée confidentielle reste masquée en attendant). */
  confidentiality: StrategicConfidentialityConfig | null | undefined;
};

/** Copie d'AFFICHAGE d'une entrée (jamais persistée). */
export type DisplayAuditEntry = AuditEntry & { masked?: boolean };

type Reader = Pick<AuthUser, "username"> &
  Partial<
    Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin" | "confidentialityClearance">
  >;

/** Préfixes des ids générés pour le Plan Stratégique (`newId`, lib/hooks/useStrategicData.ts). */
const STRATEGIC_ID_PREFIX: [RegExp, StrategicApprovalTargetType][] = [
  [/^AX-/i, "axe"],
  [/^CH-/i, "chantier"],
  [/^CA-/i, "projet"],
  [/^IND-/i, "indicateur"],
];
const VALIDATION_FIELD = "validation:";
/** Champs qui ne disent que le TYPE de la cible ou de la demande (conservés sur une entrée masquée). */
const TYPE_FIELDS = new Set(["axe", "chantier", "projet", "indicateur"]);

/** Type de la cible d'une entrée : par recherche dans les données, à défaut par préfixe d'id. */
function targetTypeOf(
  entity: string,
  data: AuditClearanceData
): StrategicApprovalTargetType | null {
  if (data.axes.some((a) => a.id === entity)) return "axe";
  if (data.chantiers.some((c) => c.id === entity)) return "chantier";
  if (data.chantierActions.some((a) => a.id === entity)) return "projet";
  if (data.indicators.some((i) => i.id === entity)) return "indicateur";
  return STRATEGIC_ID_PREFIX.find(([re]) => re.test(entity))?.[1] ?? null;
}

/** L'entrée concerne-t-elle le Plan Stratégique ? */
export function isStrategicAuditEntry(entry: AuditEntry, data: AuditClearanceData): boolean {
  if (entry.targetConfidentiality) return true;
  if (entry.field?.startsWith(VALIDATION_FIELD)) return true;
  return targetTypeOf(entry.entity, data) !== null;
}

/** Niveaux de l'élément CRÉÉ par une demande `axe_create` / `chantier_create` (cible de l'entrée
 *  = l'axe), retrouvé via la demande ou, à défaut, l'élément existant. `null` = introuvable. */
function createdElementLevels(
  entry: AuditEntry,
  kind: "axe_create" | "chantier_create",
  data: AuditClearanceData
): string[] | null {
  const text = `${entry.old ?? ""} ${entry.new ?? ""}`;
  const matches = (data.approvals ?? []).filter((a) => {
    if (a.kind !== kind || a.targetId !== entry.entity) return false;
    if (kind === "axe_create") return true;
    const name = (a.payload as ChantierCreateApprovalPayload | undefined)?.chantier?.name;
    return !!name && text.includes(name);
  });
  if (matches.length) return unionLevels(...matches.map((a) => approvalTargetLevels(a, data)));
  if (kind === "axe_create") return strategicTargetLevels("axe", entry.entity, data);
  const created = data.chantiers.filter(
    (c) => c.axisIds?.includes(entry.entity) && !!c.name && text.includes(c.name)
  );
  return created.length
    ? unionLevels(...created.map((c) => strategicTargetLevels("chantier", c.id, data)))
    : null;
}

/**
 * Niveaux de confidentialité qui protègent la cible d'une entrée (voir l'en-tête) — `[]` = non
 * confidentielle, `null` = indéterminable (entrée ancienne, cible disparue).
 */
export function auditEntryTargetLevels(
  entry: AuditEntry,
  data: AuditClearanceData
): string[] | null {
  const kind = entry.field?.startsWith(VALIDATION_FIELD)
    ? entry.field.slice(VALIDATION_FIELD.length)
    : undefined;
  let current: string[] | null;
  if (kind === "axe_create" || kind === "chantier_create") {
    const created = createdElementLevels(entry, kind, data);
    // Sans enregistrement ni élément retrouvable : indéterminable (l'axe seul ne suffit pas).
    current =
      created && kind === "chantier_create"
        ? unionLevels(created, strategicTargetLevels("axe", entry.entity, data))
        : created;
  } else {
    const type = targetTypeOf(entry.entity, data);
    current = type ? strategicTargetLevels(type, entry.entity, data) : null;
  }
  return unionLevels(entry.targetConfidentiality, current);
}

/** `reader` peut-il voir le contenu de cette entrée ? Admin : toujours ; hors Plan Stratégique :
 *  oui ; sinon tous les niveaux de la cible doivent lui être accessibles. */
export function canReadAuditEntry(
  entry: AuditEntry,
  reader: Reader | null | undefined,
  data: AuditClearanceData
): boolean {
  if (reader && isAnyAdmin(reader)) return true;
  if (!isStrategicAuditEntry(entry, data)) return true;
  const levels = auditEntryTargetLevels(entry, data);
  if (levels === null) return false; // cible disparue sans enregistrement : prudence
  if (levels.length === 0) return true;
  if (!reader || data.confidentiality === null) return false;
  return levelsAccessibleTo(levels, strategicClearanceOf(reader, data.confidentiality));
}

/** Copie masquée : date, auteur, type d'action (et type de cible) conservés ; cible, champ
 *  modifié, valeurs avant/après, motif et commentaires retirés. */
export function maskAuditEntry(entry: AuditEntry): DisplayAuditEntry {
  const keepField = entry.field?.startsWith(VALIDATION_FIELD) || TYPE_FIELDS.has(entry.field);
  return {
    ts: entry.ts,
    user: entry.user,
    action: entry.action,
    entity: OUT_OF_SCOPE_AUDIT_LABEL,
    field: keepField ? entry.field : "",
    old: "",
    new: "",
    masked: true,
  };
}

/** Journal tel qu'affiché à `reader` : entrées hors habilitation masquées (`maskAuditEntry`). */
export function maskAuditForReader(
  entries: AuditEntry[],
  reader: Reader | null | undefined,
  data: AuditClearanceData
): DisplayAuditEntry[] {
  if (reader && isAnyAdmin(reader)) return entries;
  return entries.map((e) => (canReadAuditEntry(e, reader, data) ? e : maskAuditEntry(e)));
}
