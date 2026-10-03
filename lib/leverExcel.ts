import * as engine from "@/lib/engine";
import {
  ACTION_IMPORT_HEADERS,
  ACTION_STATUS_LABEL,
  IMPACT_IMPORT_HEADERS,
  SAVING_TYPE_LABEL,
  WORKING_CAPITAL_EXPORT_HEADER,
} from "@/lib/leverExcelImport";
import { DEFAULT_LIFECYCLE_STAGES, resolveStatusLabel } from "@/lib/status-config";
import { isFteHire } from "@/lib/impactKinds";
import { getImpactNatures } from "@/lib/impactConfig";
import { riskLevelLabel } from "@/lib/leverRiskText";
import type {
  Alert,
  BeTrackData,
  ImpactNatureDef,
  Lever,
  LifecycleStage,
  RiskLevel,
} from "@/types";

/**
 * Mapping Lever -> ligne Excel, utilisé par `ExportButton` (type="excel") pour générer
 * le fichier .xlsx téléchargé sur la page Leviers. L'import (leviers + actions + impacts) vit
 * dans `lib/leverExcelImport.ts`, utilisé par `LeverImportButton` — voir ce fichier pour le format
 * des 3 feuilles attendues et la logique de validation/upsert par Code.
 */

/** Longueur maximale d'une cellule Excel (au-delà, SheetJS lève une exception à l'écriture). */
export const EXCEL_CELL_MAX_LENGTH = 32767;

/** Texte borné à la limite d'une cellule Excel (l'import sait reconnaître une description
 *  tronquée et conserve alors la version complète en base). */
export function truncateForExcel(text: string): { value: string; truncated: boolean } {
  return text.length > EXCEL_CELL_MAX_LENGTH
    ? { value: text.slice(0, EXCEL_CELL_MAX_LENGTH), truncated: true }
    : { value: text, truncated: false };
}

/** Libellé FRANÇAIS d'un niveau de risque (« Critique », « Élevé »…), comme à l'écran en fr — le
 *  classeur exporté est en français (en-têtes, statuts) ; avant, la colonne « Risque » contenait
 *  les codes internes anglais (`high`, `low`…). */
const frenchRiskLabel = (level: RiskLevel) =>
  riskLevelLabel((_key, fallback) => fallback ?? "", level);
export function leverToExcelRow(
  lever: Lever,
  data: BeTrackData,
  alerts: Alert[],
  riskThresholds?: { level: RiskLevel; minAmount: number }[],
  /** Référentiel de cycle de vie ACTIF de l'entreprise (voir `subscribeLifecycleConfig` /
   *  `useLifecycleLabels`) — la colonne "Statut" doit toujours écrire le libellé RÉELLEMENT
   *  affiché sur la plateforme pour ce levier (Kanban, dropdown de statut...), jamais un libellé
   *  Excel figé qui diverge silencieusement dès que le cycle de vie par défaut ou personnalisé
   *  change. Absent = référentiel par défaut (`DEFAULT_LIFECYCLE_STAGES`), déjà celui réellement
   *  affiché pour toute entreprise sans personnalisation — voir `lib/leverExcelImport.ts` pour le
   *  mapping inverse, qui accepte ce même libellé au ré-import. */
  lifecycleStages: LifecycleStage[] = DEFAULT_LIFECYCLE_STAGES,
  /** Programmes de l'entreprise, pour résoudre la colonne "Programme" (voir
   *  `lib/leverExcelImport.ts` — obligatoire au ré-import dès que l'entreprise a plusieurs
   *  programmes). Absent = la colonne écrit l'id brut du programme. */
  programs: { id: string; name: string }[] = []
): Record<string, string | number> {
  const ws = data.workstreams.find((w) => w.id === lever.ws);
  const pnl = data.pnlAccounts.find((p) => p.id === lever.pnlMap);
  // Montants financiers : TOUS sur la même base, le réactualisé affiché (`displayedReforecastSnapshot`
  // — impacts si le levier en porte, sinon reforecast enregistré, sinon plan figé, sinon champs
  // courants), pour que brut − OPEX récurrent = net dans le fichier. Avant, brut/CAPEX/OPEX lisaient
  // les champs courants et le net le réactualisé : incohérent pour un levier macro réactualisé.
  // Ré-import : un levier sans impact ni plan figé a par construction snapshot = champs courants
  // (round-trip inchangé) ; sinon l'import conserve ses montants calculés (lib/leverExcelImport.ts).
  // Levier ABANDONNÉ (audit lot 6) : la ligne boucle sur la même base que son net retenu (0,
  // `leverReforecastNetValue`) — brut, CAPEX, OPEX (`leverReforecastSnapshotValue`), ETP
  // (`leverFteImpactValue`), gains one-off et BFR à 0 (avant : brut 2,4, OPEX 0,3, net 0,
  // ETP −2). Son plan initial reste dans « Planifié initial ».
  const isCancelled = lever.status === "cancelled";
  const refo = engine.leverReforecastSnapshotValue(lever);
  const totals = engine.leverImpactTotals(lever);
  return {
    Code: lever.code,
    "Type de levier": lever.type,
    "Nom du levier": lever.name,
    Chantier: ws?.name ?? lever.ws,
    Programme: programs.find((p) => p.id === lever.programId)?.name ?? lever.programId ?? "",
    Owner: lever.owner,
    "Owner (initiales)": lever.ownerInit,
    Sponsor: lever.sponsor,
    "Sponsor (initiales)": lever.sponsorInit,
    Géographie: lever.geography,
    Pays: lever.country,
    Entité: lever.entity,
    Fonction: lever.function,
    "Centre de coût": lever.costCenter,
    "Compte P&L impacté": pnl?.name ?? lever.pnlMap,
    "Date de départ": lever.start,
    "Date de fin estimée": lever.end,
    Statut: resolveStatusLabel(lever.status, lifecycleStages),
    // Colonne calculée (plan d'action) : ignorée au ré-import (lib/leverExcelImport.ts).
    "Progression (%)": engine.leverProgressPct(lever),
    Risque: frenchRiskLabel(engine.computeLeverRisk(lever.id, alerts, riskThresholds).level),
    "Impact estimé brut (€M)": refo.grossSavings,
    // Même valeur que la colonne « Réactualisé (net) » du tableau des leviers
    // (`leverReforecastNetValue` : net des impacts si le levier en porte, sinon réactualisation,
    // plan figé ou net courant ; 0 pour un levier ABANDONNÉ, comme le P&L / la Finance) —
    // l'ancienne colonne « Réactualisé (net) » séparée en était un doublon et est retirée.
    // Ré-import : lue comme `netSavings`, mais un levier porteur d'impacts, au plan figé ou
    // abandonné conserve ses valeurs (lib/leverExcelImport.ts), et un levier actif sans impact ni
    // plan figé a par construction net courant = réactualisé affiché.
    "Impact estimé net (€M)": engine.leverReforecastNetValue(lever),
    // Même valeur que l'écran (fiche, tableau Finance) — colonne informative, ignorée à l'import.
    "Planifié initial": engine.displayedLockedPlanNet(lever).value,
    "Réalisé à date (€M)": engine.realizedSavings(lever),
    "Impact estimé (ETP)": engine.leverFteImpactValue(lever),
    "Réalisé à date (ETP)": engine.realizedFte(lever),
    "Gains one-off (€M)": isCancelled ? 0 : totals.oneOffGains,
    // Impact BFR : trésorerie, jamais dans les économies (`isWorkingCapitalImpact`) — informatif.
    [WORKING_CAPITAL_EXPORT_HEADER]: isCancelled ? 0 : totals.workingCapital,
    "Population impactée": typeof lever.popImpacted === "number" ? lever.popImpacted : "",
    "CAPEX (€M)": refo.capex,
    "OPEX one-off (€M)": refo.opexOneOff,
    "OPEX récurrent (€M/an)": refo.opexRec,
    "Dépendances (ID:type, séparées par ;)": lever.dependencies
      .map((d) => `${d.targetId}:${d.type}`)
      .join("; "),
    Description: truncateForExcel(lever.description ?? "").value,
    "Créé le": lever.createdAt,
    "Dernière mise à jour": lever.lastUpdate,
  };
}

const IMPACT_TYPE_EXPORT = { cost: "Coût", saving: "Gain", fte: "ETP" } as const;
const IMPACT_NATURE_EXPORT = {
  capex: "CAPEX",
  opex_rec: "OPEX récurrent",
  oneoff: "One-off",
} as const;

/** Lignes de la feuille "Impacts" (impacts portés par le levier) — mêmes colonnes que
 *  `IMPACT_IMPORT_HEADERS` (lib/leverExcelImport.ts) ; "Nom de l'action" reste vide. Le libellé
 *  est exporté : c'est la clé de rapprochement qui permet au ré-import de conserver l'id, les
 *  commentaires et la validation finance de chaque ligne. « Nature de l'impact » est exportée par
 *  son LIBELLÉ dans les natures de l'entreprise (`impactNatures`, natures par défaut à défaut —
 *  lot 5), relu par l'import ; une nature disparue du paramétrage garde son id. */
export function leverImpactsToExcelRows(
  lever: Lever,
  impactNatures?: ImpactNatureDef[]
): Record<string, string | number>[] {
  const natures = getImpactNatures({ impactNatures });
  const natureLabel = (id: string | undefined) =>
    id ? (natures.find((n) => n.id === id)?.label ?? id) : "";
  return engine.leverImpactsOf(lever).map((imp) => ({
    "Code Levier": lever.code,
    "Nom de l'action": "",
    Libellé: imp.label,
    Type: IMPACT_TYPE_EXPORT[imp.type],
    Nature: imp.type === "cost" ? IMPACT_NATURE_EXPORT[imp.nature] : "",
    "Montant (€M)": imp.amount,
    ETP: imp.fteCount ?? "",
    "Type de gain": imp.savingType ? SAVING_TYPE_LABEL[imp.savingType] : "",
    "Date CAPEX": imp.capexDeploymentDate ?? "",
    "Date gain": imp.gainDate ?? "",
    "Poste de coût": imp.pnlMap ?? "",
    "Centre de coût": imp.costCenter ?? "",
    "Entité P&L": imp.entity ?? "",
    Commentaire: "",
    Mode:
      imp.type === "saving"
        ? imp.gainRecurrence === "oneoff"
          ? "Gain one-off"
          : "Gain annuel"
        : "",
    "Nature de l'impact": natureLabel(imp.natureId),
    Technologie: imp.technology ?? "",
    Sens: imp.type === "fte" ? (isFteHire(imp) ? "Recrutement" : "Départ") : "",
    "Statut impact": imp.status
      ? { planned: "Planifié", done: "Réalisé", ongoing: "En cours" }[imp.status]
      : "",
  }));
}

/** En-têtes de la feuille "Impacts" de l'export (ordre du modèle d'import). */
export const IMPACT_EXPORT_HEADERS = [...IMPACT_IMPORT_HEADERS];

/** Lignes de la feuille "Actions" de l'export — mêmes colonnes et libellés que
 *  `ACTION_IMPORT_HEADERS` : ré-importer un export conserve ainsi les plans d'action (sans cette
 *  feuille, l'ancien import vidait les actions de chaque levier mis à jour). */
export function leverActionsToExcelRows(lever: Lever): Record<string, string>[] {
  return (lever.actions ?? []).map((a) => {
    const row: Record<(typeof ACTION_IMPORT_HEADERS)[number], string> = {
      "Code Levier": lever.code,
      "Nom de l'action": a.name,
      Owner: a.owner ?? "",
      "Date début": a.start,
      "Date fin": a.end,
      Statut: ACTION_STATUS_LABEL[a.status],
      // Colonne technique : clé de rapprochement prioritaire au ré-import (renommage conservé).
      "ID action": a.id,
    };
    return row;
  });
}
