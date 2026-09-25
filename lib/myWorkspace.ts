/**
 * Moteur PUR du portail « Mon espace » (`/me`) — V1 en lecture seule, sans messagerie. Voir le
 * contrat `lib/myWorkspaceTypes.ts`. Aucune nouvelle règle métier n'est inventée quand le code en
 * a déjà une : chaque source RÉUTILISE son résolveur existant.
 *
 * Sources (qui alimente quoi) :
 *  - `resolveApprovalQueue`          → portes de validation de levier (« À faire », `/validation`)
 *  - `resolveRealizedApprovalQueue`  → réalisés à valider (profil finance)
 *  - `resolveMilestoneApprovalQueue` → jalons de projet (flux historique `milestoneApproval`),
 *                                      hors projets déjà couverts par une demande stratégique
 *  - `bucketApprovals(...).pending`  → demandes de validation stratégiques décidables
 *  - `generateAlerts` + `targetAlerts` → alertes levier ciblées (la cloche), rouges/ambre ouvertes
 *  - `movementAlerts` + `primaryAlertKindByMovement` → mouvements RH en alerte (rôle `hr`)
 *  - `ChantierAction.owner/end` + `isProjetLate`/`isProjetDone` → projets dont l'utilisateur est owner
 *  - indicateurs dont l'utilisateur est responsable (`resolveIndicatorOwner`) sans mesure pour la
 *    dernière période échue (voir `missingMeasurementPeriod`, règle documentée ci-dessous)
 *
 * Choix simples, documentés ici (pas de règle existante) :
 *  - Classement d'un élément DATÉ (`classifyDue`) : échéance dépassée → « À faire » `critical` ;
 *    échéance dans `dueSoonDays` (7 j, même fenêtre que `DUE_WINDOW_DAYS` de lib/hrEngine.ts) →
 *    « À faire » `warning` ; échéance dans `upcomingDays` (28 j) → « À venir » `info` ; au-delà :
 *    ignoré. Un élément NON daté (validation, alerte) va toujours dans « À faire ».
 *  - Validation en attente depuis plus de `blockedAfterDays` : `critical` (sinon `warning`).
 *  - Vue pilotage (cto / program_sponsor / program_owner / admins) :
 *      · « Bloqué chez d'autres » = validations en attente depuis plus de `blockedAfterDays` dont
 *        l'approbateur NOMINAL n'est pas l'utilisateur (il ne peut au mieux qu'escalader) — le
 *        temps d'attente vient des horodatages de demande existants (`LeverApproval.requestedAt`,
 *        `realizedApproval.requestedAt`, `ChantierMilestoneApproval.requestedAt`,
 *        `StrategicApproval.requestedAt`) ;
 *      · une validation que le pilote ne peut décider que par escalade (admin, strategic_lead) et
 *        qui n'est pas encore bloquée n'apparaît PAS dans « À faire » (exceptions d'abord) ;
 *      · alertes : seulement les `pilotTopAlerts` plus graves (rouge puis ambre, tri de
 *        `generateAlerts`) ;
 *      · périmètre : une ligne par programme (santé = pire alerte ouverte de ses leviers côté
 *        Performance, pire `chantierHealthState` côté Stratégique ; `neutral` si non chargé/vide).
 *  - Dédoublonnage : un même objet (clé `dedupeKey`) remonté par plusieurs sources ne garde que
 *    l'élément le plus grave ; un élément de « À faire » est retiré de « À venir »/« Bloqué ».
 */
import {
  resolveApprovalQueue,
  resolveMilestoneApprovalQueue,
  resolveRealizedApprovalQueue,
} from "@/lib/hooks/useApprovalQueue";
import type { StrategicData } from "@/lib/hooks/useStrategicData";
import { generateAlerts } from "@/lib/alertEngine";
import { alertTitle } from "@/lib/alertText";
import { targetAlerts } from "@/lib/notifications";
import { movementAlerts, primaryAlertKindByMovement, type MovementAlertKind } from "@/lib/hrEngine";
import { etpMovementDeepLink } from "@/lib/hrMovementLink";
import { isLeverCtoOf, isLeverOwnedBy, isLeverSponsoredBy } from "@/lib/leversLogic";
import { canDecideImpactRealized, isImpactRealizedPending } from "@/lib/impactStatus";
import {
  chantierHealthState,
  displayMilestoneId,
  isProjetDone,
  isProjetLate,
  milestoneProgressPct,
  resolveIndicatorOwner,
  resolveProgramType,
  type ChantierHealthState,
  type ProjetProgressLookup,
} from "@/lib/axisLogic";
import {
  bucketApprovals,
  approvalStepInfo,
  pendingApproversOf,
  type MilestoneApprovalPayload,
  type StrategicApproval,
} from "@/lib/strategicApprovals";
import { canFillIndicatorValue, currentPeriod } from "@/lib/kpiHistory";
import { comparePeriods, indicatorPeriodRange } from "@/lib/indicatorPeriod";
import {
  getAuthorizedPrograms,
  getPerformanceProfiles,
  hasRole,
  isAnyAdmin,
} from "@/lib/roleProfiles";
import { getConsolidatedPerformancePrograms } from "@/lib/consolidatedProgramAccess";
import { STATUS_LEVEL } from "@/lib/status-config";
import { daysBetween } from "@/lib/dateUtils";
import { fillTemplate } from "@/lib/importIssue";
import {
  EMPTY_WORKSPACE,
  type MyWorkspace,
  type WorkspaceHealth,
  type WorkspaceItem,
  type WorkspacePerimeterEntry,
  type WorkspaceSeverity,
} from "@/lib/myWorkspaceTypes";
import type {
  Alert,
  AuthUser,
  BeTrackData,
  Chantier,
  ChantierAction,
  Company,
  Indicator,
  IndicatorMeasurement,
  Lever,
  Program,
  StrategicAxis,
} from "@/types";

export type Translate = (key: string, fallback?: string) => string;

export type MyWorkspaceOptions = {
  /** Fenêtre « À venir » (jours). */
  upcomingDays: number;
  /** Au-delà, une validation en attente est « bloquée » (vue pilotage) / `critical`. */
  blockedAfterDays: number;
  /** Nombre maximum d'alertes levier en vue pilotage. */
  pilotTopAlerts: number;
  /** Échéance « proche » : reste dans « À faire » (même fenêtre que lib/hrEngine.ts). */
  dueSoonDays: number;
};

export const DEFAULT_WORKSPACE_OPTIONS: MyWorkspaceOptions = {
  upcomingDays: 28,
  blockedAfterDays: 7,
  pilotTopAlerts: 10,
  dueSoonDays: 7,
};

/** Sous-ensemble de `StrategicData` (programme stratégique chargé) + demandes de validation. */
export type MyWorkspaceStrategicInput = Pick<
  StrategicData,
  "axes" | "chantiers" | "chantierActions" | "indicators" | "measurements"
> & {
  programId: string;
  /** `StrategicData.projetProgress` — repli `milestoneProgressPct` si absent. */
  projetProgress?: ProjetProgressLookup;
  /** Demandes de validation stratégiques du programme (`useStrategicApprovals().approvals`). */
  approvals?: StrategicApproval[];
};

export type MyWorkspaceInput = {
  user: AuthUser | null | undefined;
  performance?: BeTrackData | null;
  strategic?: MyWorkspaceStrategicInput | null;
  programs?: Program[];
  users?: AuthUser[];
  companies?: Company[];
  /** Aujourd'hui, ISO `YYYY-MM-DD` (date locale, `hrToday()`). */
  today: string;
  options?: Partial<MyWorkspaceOptions>;
};

// ─── Petits utilitaires ─────────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<WorkspaceSeverity, number> = { critical: 0, warning: 1, info: 2 };
const HEALTH_RANK: Record<WorkspaceHealth, number> = { red: 0, amber: 1, green: 2, neutral: 3 };

/** Élément interne : l'élément du contrat + sa clé d'objet pour le dédoublonnage. */
type Candidate = WorkspaceItem & { dedupeKey: string };

function isoDay(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

/** Jours écoulés depuis un horodatage ISO (0 si inconnu / futur). */
function daysSince(timestamp: string | undefined, today: string): number {
  const day = isoDay(timestamp);
  if (!day) return 0;
  return Math.max(0, daysBetween(day, today));
}

function leverContext(lever: Pick<Lever, "code" | "name">): string {
  return lever.code ? `${lever.code} · ${lever.name}` : lever.name;
}

function leverHref(leverId: string): string {
  return `/levers/detail?id=${encodeURIComponent(leverId)}`;
}

function projetHref(chantierId: string, actionId: string): string {
  return `/levers?chantier=${encodeURIComponent(chantierId)}&action=${encodeURIComponent(actionId)}`;
}

function chantierHref(chantierId: string): string {
  return `/levers?chantier=${encodeURIComponent(chantierId)}`;
}

const VALIDATION_HREF = "/validation";

/** Classement d'un élément daté (voir l'en-tête). `null` = hors fenêtre. */
function classifyDue(
  dueDate: string,
  today: string,
  opts: MyWorkspaceOptions
): { list: "todo" | "upcoming"; severity: WorkspaceSeverity; daysLate?: number } | null {
  const delta = daysBetween(today, dueDate);
  if (!Number.isFinite(delta)) return null;
  if (delta < 0) return { list: "todo", severity: "critical", daysLate: -delta };
  if (delta <= opts.dueSoonDays) return { list: "todo", severity: "warning" };
  if (delta <= opts.upcomingDays) return { list: "upcoming", severity: "info" };
  return null;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  // Plus grave d'abord, puis plus en retard, puis plus ancien en attente.
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (b.daysLate ?? 0) - (a.daysLate ?? 0) ||
    (b.waitingDays ?? 0) - (a.waitingDays ?? 0)
  );
}

/** Un seul élément par objet : le plus grave (voir `compareCandidates`). */
function dedupe(items: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const item of items) {
    const current = best.get(item.dedupeKey);
    if (!current || compareCandidates(item, current) < 0) best.set(item.dedupeKey, item);
  }
  return Array.from(best.values());
}

function strip(item: Candidate): WorkspaceItem {
  const { dedupeKey: _key, ...rest } = item;
  void _key;
  return rest;
}

function sortTodo(a: WorkspaceItem, b: WorkspaceItem): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (b.daysLate ?? 0) - (a.daysLate ?? 0) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    (b.waitingDays ?? 0) - (a.waitingDays ?? 0) ||
    a.title.localeCompare(b.title)
  );
}

function sortUpcoming(a: WorkspaceItem, b: WorkspaceItem): number {
  return (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.title.localeCompare(b.title);
}

function sortBlocked(a: WorkspaceItem, b: WorkspaceItem): number {
  return (b.waitingDays ?? 0) - (a.waitingDays ?? 0) || a.title.localeCompare(b.title);
}

function alertSeverity(alert: Pick<Alert, "type">): WorkspaceSeverity | null {
  if (alert.type === "red") return "critical";
  if (alert.type === "amber") return "warning";
  return null; // vert / bleu = informatif, hors portail
}

function worstHealth(values: WorkspaceHealth[]): WorkspaceHealth {
  if (values.length === 0) return "neutral";
  return values.reduce((worst, h) => (HEALTH_RANK[h] < HEALTH_RANK[worst] ? h : worst));
}

function chantierHealthToWorkspace(state: ChantierHealthState): WorkspaceHealth {
  return state === "critical" ? "red" : state === "watch" ? "amber" : "green";
}

/** Profil « pilotage » : exceptions plutôt que listes exhaustives. */
export function isPilotProfile(user: AuthUser | null | undefined): boolean {
  return (
    isAnyAdmin(user) ||
    hasRole(user, "cto") ||
    hasRole(user, "program_sponsor") ||
    hasRole(user, "program_owner")
  );
}

/**
 * Dernière période ÉCHUE d'un indicateur (la période précédant la période courante) — c'est la
 * mesure « attendue » : la période courante n'est pas encore terminée, on ne la réclame pas.
 * Renvoie aussi l'index de mois (année × 12 + mois) de sa fin, pour ignorer un indicateur créé après.
 */
function lastClosedPeriod(
  frequency: Indicator["frequency"],
  today: string
): { period: string; endMonthIndex: number } | undefined {
  const now = new Date(`${today}T00:00:00`);
  const current = indicatorPeriodRange(currentPeriod(frequency, now));
  if (!current) return undefined;
  const prevMonth = current.start - 1;
  const prevDate = new Date(Math.floor(prevMonth / 12), prevMonth % 12, 1);
  const period = currentPeriod(frequency, prevDate);
  const range = indicatorPeriodRange(period);
  return range ? { period, endMonthIndex: range.end } : undefined;
}

/** Période manquante (voir `lastClosedPeriod`) : aucune mesure pour cette période ni après. */
export function missingMeasurementPeriod(
  indicator: Pick<Indicator, "id" | "frequency" | "createdAt">,
  measurements: Pick<IndicatorMeasurement, "indicatorId" | "period">[],
  today: string
): string | undefined {
  const expected = lastClosedPeriod(indicator.frequency, today);
  if (!expected) return undefined;
  const created = isoDay(indicator.createdAt);
  if (created) {
    const createdMonth = Number(created.slice(0, 4)) * 12 + Number(created.slice(5, 7)) - 1;
    if (createdMonth > expected.endMonthIndex) return undefined; // créé après la période attendue
  }
  const covered = measurements.some(
    (m) => m.indicatorId === indicator.id && comparePeriods(m.period, expected.period) >= 0
  );
  return covered ? undefined : expected.period;
}

// ─── Moteur ─────────────────────────────────────────────────────────────────────────────────

export function buildMyWorkspace(input: MyWorkspaceInput, t: Translate): MyWorkspace {
  const { user, today } = input;
  if (!user) return { ...EMPTY_WORKSPACE };
  const opts: MyWorkspaceOptions = { ...DEFAULT_WORKSPACE_OPTIONS, ...input.options };
  const perf = input.performance ?? null;
  const strategic = input.strategic ?? null;
  const programs = input.programs ?? [];
  const pilotView = isPilotProfile(user);

  const tf = (key: string, fallback: string, vars: Record<string, string | number> = {}) =>
    fillTemplate(t(key, fallback), vars);

  // Périmètre de programmes du pilote (null = pas de filtre, programmes non chargés).
  const pilotProgramIds: Set<string> | null =
    pilotView && programs.length > 0
      ? new Set(
          (isAnyAdmin(user)
            ? programs
            : [
                ...getAuthorizedPrograms(user, programs),
                ...getConsolidatedPerformancePrograms(user, programs),
              ]
          ).map((p) => p.id)
        )
      : null;
  const inPilotScope = (programId: string | undefined) =>
    !pilotProgramIds || (!!programId && pilotProgramIds.has(programId));

  const todo: Candidate[] = [];
  const upcoming: Candidate[] = [];
  const blocked: Candidate[] = [];

  const approvalSeverity = (waitingDays: number): WorkspaceSeverity =>
    waitingDays > opts.blockedAfterDays ? "critical" : "warning";
  const isStale = (waitingDays: number) => waitingDays > opts.blockedAfterDays;

  // ── Plan Performance ─────────────────────────────────────────────────────────────────────
  // Toutes les alertes (non ciblées) servent aussi à la santé du périmètre.
  const allAlerts: Alert[] = perf ? generateAlerts(perf) : [];

  if (perf) {
    const wsById = new Map(perf.workstreams.map((w) => [w.id, w]));

    // 1. Portes de validation de levier. Approbateur nominal = sponsor du workstream/levier OU cto
    //    habilité (modèle à approbateur unique, lib/leversLogic.ts::approveLeverGate) ; un admin
    //    ne décide que par escalade.
    const decidable = new Set(resolveApprovalQueue(perf, user).map((l) => l.id));
    for (const lever of perf.levers) {
      const approval = lever.approval;
      if (!approval) continue;
      const ws = wsById.get(lever.ws);
      const nominal = isLeverSponsoredBy(lever, ws, user) || isLeverCtoOf(lever, user);
      const waitingDays = daysSince(approval.requestedAt, today);
      const base = {
        source: "leverApproval" as const,
        plan: "performance" as const,
        title: tf("me.item.leverApproval", "Valider le passage {from} → {to}", {
          from: STATUS_LEVEL[lever.status] ?? lever.status,
          to: STATUS_LEVEL[approval.targetStatus] ?? approval.targetStatus,
        }),
        context: leverContext(lever),
        waitingDays,
        href: VALIDATION_HREF,
        programId: lever.programId,
        dedupeKey: `lever:${lever.id}:approval`,
      };
      if (decidable.has(lever.id) && (nominal || !pilotView)) {
        todo.push({
          ...base,
          id: `leverApproval:${lever.id}:${approval.targetStatus}`,
          severity: approvalSeverity(waitingDays),
        });
      } else if (pilotView && !nominal && isStale(waitingDays) && inPilotScope(lever.programId)) {
        blocked.push({
          ...base,
          id: `blockedValidation:lever:${lever.id}:${approval.targetStatus}`,
          source: "blockedValidation",
          severity: "warning",
          waitingOn:
            ws?.sponsorUsername ||
            ws?.sponsor ||
            lever.sponsorUsername ||
            lever.sponsor ||
            t("me.role.sponsor", "Sponsor"),
        });
      }
    }

    // 2. Réalisés à valider — approbateur nominal = profil finance.
    const realizedDecidable = new Set(
      resolveRealizedApprovalQueue(perf, user).map(
        ({ lever, impact }) => `${lever.id}:${impact.id}`
      )
    );
    // Vue pilotage : TOUS les réalisés en attente (même filtre que le résolveur) pour repérer
    // ceux bloqués chez la finance ; sinon seulement ceux que l'utilisateur peut décider.
    const pendingRealized = pilotView
      ? perf.levers
          .filter((lever) => lever.status !== "cancelled")
          .flatMap((lever) =>
            (lever.impacts ?? [])
              .filter((impact) => isImpactRealizedPending(impact))
              .map((impact) => ({ lever, impact }))
          )
      : resolveRealizedApprovalQueue(perf, user);
    for (const { lever, impact } of pendingRealized) {
      const key = `${lever.id}:${impact.id}`;
      const waitingDays = daysSince(impact.realizedApproval?.requestedAt, today);
      const base = {
        source: "realizedApproval" as const,
        plan: "performance" as const,
        title: tf("me.item.realizedApproval", "Valider le réalisé : {label}", {
          label: impact.label,
        }),
        context: leverContext(lever),
        waitingDays,
        href: VALIDATION_HREF,
        programId: lever.programId,
        dedupeKey: `impact:${key}:realized`,
      };
      if (realizedDecidable.has(key)) {
        todo.push({
          ...base,
          id: `realizedApproval:${key}`,
          severity: approvalSeverity(waitingDays),
        });
      } else if (
        pilotView &&
        !canDecideImpactRealized(user) &&
        isStale(waitingDays) &&
        inPilotScope(lever.programId)
      ) {
        blocked.push({
          ...base,
          id: `blockedValidation:realized:${key}`,
          source: "blockedValidation",
          severity: "warning",
          waitingOn: t("me.role.finance", "Finance"),
        });
      }
    }

    // 3. Alertes levier ciblées (même ciblage que la cloche). L'utilisateur courant est ajouté à la
    //    liste s'il n'y figure pas encore (liste des comptes pas encore chargée).
    const users = input.users ?? [];
    const recipients = users.some((u) => u.username === user.username) ? users : [...users, user];
    const leverById = new Map(perf.levers.map((l) => [l.id, l]));
    let targeted = targetAlerts(allAlerts, user, recipients, perf, input.companies ?? []).filter(
      (a) => !a.resolved && alertSeverity(a) !== null
    );
    // `generateAlerts` trie déjà : non résolues → sévérité → |impact €|.
    if (pilotView) targeted = targeted.slice(0, opts.pilotTopAlerts);
    for (const alert of targeted) {
      const lever = leverById.get(alert.scope);
      todo.push({
        id: `leverAlert:${alert.id}`,
        source: "leverAlert",
        plan: "performance",
        severity: alertSeverity(alert) ?? "warning",
        title: alertTitle(t, alert),
        context: lever ? leverContext(lever) : (alert.scopeLabel ?? alert.scope),
        href: lever ? leverHref(lever.id) : "/workstreams",
        programId: lever?.programId,
        dedupeKey: `lever:${alert.scope}:alert`,
      });
    }

    // 4. Mouvements RH (rôle `hr`) — une ligne par mouvement, catégorie la plus grave.
    const hrProfiles = getPerformanceProfiles(user).filter((p) => p.role === "hr");
    if (hrProfiles.length > 0) {
      const hrPrograms = hrProfiles.some((p) => !p.programId)
        ? null
        : new Set(hrProfiles.map((p) => p.programId as string));
      const movementInScope = (m: { programId?: string; leverId: string }) =>
        !hrPrograms || hrPrograms.has(m.programId ?? leverById.get(m.leverId)?.programId ?? "");
      const alerts = movementAlerts(perf.workforce, perf.levers, today).filter((a) =>
        movementInScope(a.movement)
      );
      const primary = primaryAlertKindByMovement(alerts);
      const kindTitle: Record<MovementAlertKind, [string, string]> = {
        overdue: ["me.item.hrOverdue", "Mouvement RH en retard"],
        due: ["me.item.hrDue", "Mouvement RH à échéance"],
        toValidate: ["me.item.hrToValidate", "Mouvement RH à valider"],
        leverMismatch: ["me.item.hrLeverMismatch", "Mouvement RH désynchronisé du levier"],
      };
      for (const [movementId, kind] of Array.from(primary.entries())) {
        const alert = alerts.find((a) => a.movement.id === movementId && a.kind === kind);
        if (!alert) continue;
        const m = alert.movement;
        const late = kind === "overdue" ? Math.max(0, -daysBetween(today, m.plannedDate)) : 0;
        todo.push({
          id: `hrMovement:${m.id}`,
          source: "hrMovement",
          plan: "performance",
          severity: kind === "overdue" || kind === "leverMismatch" ? "critical" : "warning",
          title: t(kindTitle[kind][0], kindTitle[kind][1]),
          context: m.label,
          dueDate: m.status !== "Réalisé" ? m.plannedDate : undefined,
          daysLate: late > 0 ? late : undefined,
          href: etpMovementDeepLink([m.id]),
          programId: m.programId ?? leverById.get(m.leverId)?.programId,
          dedupeKey: `movement:${m.id}`,
        });
      }
      // « À venir » : mouvements non réalisés planifiés au-delà de la fenêtre d'alerte « due ».
      for (const m of perf.workforce.movements) {
        if (m.status === "Réalisé" || m.status === "Abandonné" || primary.has(m.id)) continue;
        if (!movementInScope(m)) continue;
        const cls = classifyDue(m.plannedDate, today, opts);
        if (!cls || cls.list !== "upcoming") continue;
        upcoming.push({
          id: `hrMovement:${m.id}`,
          source: "hrMovement",
          plan: "performance",
          severity: "info",
          title: t("me.item.hrPlanned", "Mouvement RH planifié"),
          context: m.label,
          dueDate: m.plannedDate,
          href: etpMovementDeepLink([m.id]),
          programId: m.programId ?? leverById.get(m.leverId)?.programId,
          dedupeKey: `movement:${m.id}`,
        });
      }
    }
  }

  // ── Plan Stratégique ─────────────────────────────────────────────────────────────────────
  if (strategic) {
    const { axes, chantiers, chantierActions, indicators, measurements, programId } = strategic;
    const progressOf: ProjetProgressLookup =
      strategic.projetProgress ?? ((a) => milestoneProgressPct(a));
    const chantierById = new Map(chantiers.map((c) => [c.id, c]));
    const actionById = new Map(chantierActions.map((a) => [a.id, a]));
    const approvals = (strategic.approvals ?? []).filter((a) => a.status === "pending");
    const approvalData = { ...strategic, programId, users: input.users ?? [] };

    const projetContext = (action: ChantierAction) => {
      const chantier = chantierById.get(action.chantierId);
      return chantier ? `${chantier.name} · ${action.name}` : action.name;
    };

    // 5. Demandes de validation stratégiques. Nominal = parmi les approbateurs du palier COURANT
    //    (`pendingApproversOf` : chaîne N+1 puis N+2 ; legacy : `approverUsernames`). Un
    //    approbateur de l'étape 2 ne voit la demande qu'une fois l'étape 1 validée ; « bloqué chez »
    //    nomme le(s) approbateur(s) de l'étape en cours.
    const decidableIds = new Set(
      bucketApprovals(approvals, user, approvalData).pending.map((a) => a.id)
    );
    const approvalTitle = (a: StrategicApproval): string => {
      switch (a.kind) {
        case "milestone":
          return tf("me.item.milestoneApproval", "Valider le passage au jalon {to}", {
            to: displayMilestoneId((a.payload as MilestoneApprovalPayload).targetMilestone),
          });
        case "kpi_value":
          return t("me.item.kpiValueApproval", "Valider une valeur d'indicateur");
        case "projet_create":
          return t("me.item.projetCreateApproval", "Valider la création d'un projet");
        case "projet_delete":
          return t("me.item.projetDeleteApproval", "Valider la suppression d'un projet");
        case "chantier_delete":
          return t("me.item.chantierDeleteApproval", "Valider la suppression d'un chantier");
        case "chantier_create":
          return t("me.item.chantierCreateApproval", "Valider la création d'un chantier");
        case "projet_update":
          return t("me.item.projetUpdateApproval", "Valider une modification de projet");
        case "chantier_update":
          return t("me.item.chantierUpdateApproval", "Valider une modification de chantier");
      }
    };
    for (const a of approvals) {
      const currentApprovers = pendingApproversOf(a);
      const nominal = currentApprovers.includes(user.username);
      const info = approvalStepInfo(a);
      const step =
        info && info.total > 1
          ? tf("me.item.approvalStep", "Étape {current}/{total}", {
              current: info.current,
              total: info.total,
            })
          : "";
      const waitingDays = daysSince(a.requestedAt, today);
      const action = a.targetType === "projet" ? actionById.get(a.targetId) : undefined;
      const base = {
        source: "strategicApproval" as const,
        plan: "strategic" as const,
        title: step ? `${approvalTitle(a)} · ${step}` : approvalTitle(a),
        context: action ? projetContext(action) : (a.targetName ?? a.targetId),
        waitingDays,
        href: VALIDATION_HREF,
        programId: a.programId,
        dedupeKey: a.kind === "milestone" ? `projet:${a.targetId}:milestone` : `strategic:${a.id}`,
      };
      if (decidableIds.has(a.id) && (nominal || !pilotView)) {
        todo.push({
          ...base,
          id: `strategicApproval:${a.id}`,
          severity: approvalSeverity(waitingDays),
        });
      } else if (pilotView && !nominal && isStale(waitingDays) && inPilotScope(a.programId)) {
        blocked.push({
          ...base,
          id: `blockedValidation:strategic:${a.id}`,
          source: "blockedValidation",
          severity: "warning",
          waitingOn: currentApprovers.length
            ? currentApprovers
                .map((u) => approvalData.users.find((x) => x.username === u)?.name || u)
                .join(", ")
            : a.approverRole,
        });
      }
    }

    // 6. Jalons (flux historique `milestoneApproval`), hors projets couverts par une demande
    //    stratégique (même exclusion que app/(app)/validation/page.tsx). Nominal = pilote du
    //    chantier, à défaut responsable d'axe (cascade `canDecideMilestone` hors escalade).
    const covered = new Set(approvals.filter((a) => a.kind === "milestone").map((a) => a.targetId));
    const milestoneDecidable = new Set(
      resolveMilestoneApprovalQueue(chantierActions, chantiers, user, axes).map((e) => e.action.id)
    );
    for (const action of chantierActions) {
      const approval = action.milestoneApproval;
      if (!approval || covered.has(action.id)) continue;
      const chantier = chantierById.get(action.chantierId);
      if (!chantier) continue;
      const axisOwners = axes
        .filter((ax) => chantier.axisIds.includes(ax.id) && ax.owner)
        .map((ax) => ax.owner as string);
      const nominal = chantier.pilote
        ? chantier.pilote === user.username
        : axisOwners.includes(user.username);
      const waitingDays = daysSince(approval.requestedAt, today);
      const base = {
        source: "milestoneApproval" as const,
        plan: "strategic" as const,
        title: tf("me.item.milestoneApproval", "Valider le passage au jalon {to}", {
          to: displayMilestoneId(approval.targetMilestone),
        }),
        context: projetContext(action),
        waitingDays,
        href: VALIDATION_HREF,
        programId: chantier.programId,
        dedupeKey: `projet:${action.id}:milestone`,
      };
      if (milestoneDecidable.has(action.id) && (nominal || !pilotView)) {
        todo.push({
          ...base,
          id: `milestoneApproval:${action.id}`,
          severity: approvalSeverity(waitingDays),
        });
      } else if (
        pilotView &&
        !nominal &&
        isStale(waitingDays) &&
        inPilotScope(chantier.programId)
      ) {
        blocked.push({
          ...base,
          id: `blockedValidation:milestone:${action.id}`,
          source: "blockedValidation",
          severity: "warning",
          waitingOn:
            chantier.pilote ?? axisOwners[0] ?? t("me.role.strategicLead", "Pilote stratégique"),
        });
      }
    }

    // 7. Projets dont l'utilisateur est owner : retard / échéance proche / à venir.
    const todayDate = new Date(`${today}T00:00:00`);
    for (const action of chantierActions) {
      if (action.owner !== user.username || !action.end) continue;
      const pct = progressOf(action);
      if (isProjetDone(action, progressOf)) continue;
      const late = isProjetLate(action, pct, todayDate);
      const cls = late
        ? {
            list: "todo" as const,
            severity: "critical" as const,
            daysLate: Math.max(1, daysBetween(action.end, today)),
          }
        : classifyDue(action.end, today, opts);
      if (!cls) continue;
      const item: Candidate = {
        id: `chantierAction:${action.id}`,
        source: "chantierAction",
        plan: "strategic",
        severity: cls.severity,
        title: late
          ? t("me.item.projetLate", "Projet en retard")
          : t("me.item.projetDue", "Échéance du projet"),
        context: projetContext(action),
        dueDate: action.end,
        daysLate: cls.daysLate,
        href: projetHref(action.chantierId, action.id),
        programId: chantierById.get(action.chantierId)?.programId ?? programId,
        dedupeKey: `projet:${action.id}:deadline`,
      };
      (cls.list === "todo" ? todo : upcoming).push(item);
    }

    // 8. Mesures d'indicateur à saisir (indicateurs dont l'utilisateur est responsable ET
    //    habilité à saisir — `canFillIndicatorValue`, KPI marché compris).
    for (const indicator of indicators) {
      const owner = resolveIndicatorOwner(indicator, axes, chantiers, "");
      const responsible =
        owner === user.username ||
        (indicator.additionalAuthorizedUserIds ?? []).includes(user.username);
      if (!responsible || !canFillIndicatorValue(indicator, user, { axes, chantiers })) continue;
      const period = missingMeasurementPeriod(indicator, measurements, today);
      if (!period) continue;
      todo.push({
        id: `indicatorMeasurement:${indicator.id}:${period}`,
        source: "indicatorMeasurement",
        plan: "strategic",
        severity: "warning",
        title: tf("me.item.measurementMissing", "Saisir la mesure {period}", { period }),
        context: indicator.name,
        href: `/kpi?indicator=${encodeURIComponent(indicator.id)}`,
        programId: indicator.programId,
        dedupeKey: `indicator:${indicator.id}:measure`,
      });
    }
  }

  // ── Dédoublonnage et tri ─────────────────────────────────────────────────────────────────
  const todoFinal = dedupe(todo);
  const todoKeys = new Set(todoFinal.map((i) => i.dedupeKey));
  const upcomingFinal = dedupe(upcoming).filter((i) => !todoKeys.has(i.dedupeKey));
  const blockedFinal = pilotView ? dedupe(blocked).filter((i) => !todoKeys.has(i.dedupeKey)) : [];

  return {
    todo: todoFinal.map(strip).sort(sortTodo),
    upcoming: upcomingFinal.map(strip).sort(sortUpcoming),
    blocked: blockedFinal.map(strip).sort(sortBlocked),
    perimeter: pilotView
      ? buildPilotPerimeter(user, programs, pilotProgramIds, perf, strategic, allAlerts, t)
      : buildPerimeter(user, perf, strategic, allAlerts, today, t),
    pilotView,
  };
}

// ─── Périmètre ──────────────────────────────────────────────────────────────────────────────

/** Santé d'un levier = pire alerte OUVERTE dont il est le scope (même source que la cloche). */
function leverHealth(lever: Lever, alerts: Alert[]): WorkspaceHealth {
  if (lever.status === "cancelled") return "neutral";
  const open = alerts.filter((a) => a.scope === lever.id && !a.resolved);
  if (open.some((a) => a.type === "red")) return "red";
  if (open.some((a) => a.type === "amber")) return "amber";
  return "green";
}

function strategicHealthLookup(strategic: MyWorkspaceStrategicInput) {
  const cache = new Map<string, WorkspaceHealth>();
  return (chantier: Chantier): WorkspaceHealth => {
    const hit = cache.get(chantier.id);
    if (hit) return hit;
    const h = chantierHealthToWorkspace(
      chantierHealthState(
        chantier,
        strategic.indicators,
        strategic.measurements,
        strategic.chantiers,
        strategic.chantierActions
      )
    );
    cache.set(chantier.id, h);
    return h;
  };
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function sortPerimeter(a: WorkspacePerimeterEntry, b: WorkspacePerimeterEntry): number {
  return HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.label.localeCompare(b.label);
}

function buildPerimeter(
  user: AuthUser,
  perf: BeTrackData | null,
  strategic: MyWorkspaceStrategicInput | null,
  alerts: Alert[],
  today: string,
  t: Translate
): WorkspacePerimeterEntry[] {
  const out: WorkspacePerimeterEntry[] = [];
  const roleOwner = t("me.role.owner", "Responsable");
  const roleSponsor = t("me.role.sponsor", "Sponsor");

  if (perf) {
    const wsById = new Map(perf.workstreams.map((w) => [w.id, w]));
    for (const lever of perf.levers) {
      const owned = isLeverOwnedBy(lever, user);
      const sponsored = !owned && isLeverSponsoredBy(lever, wsById.get(lever.ws), user);
      if (!owned && !sponsored) continue;
      out.push({
        id: `lever:${lever.id}`,
        kind: "lever",
        plan: "performance",
        label: leverContext(lever),
        role: owned ? roleOwner : roleSponsor,
        health: leverHealth(lever, alerts),
        progressPct: lever.progress,
        href: leverHref(lever.id),
      });
    }
  }

  if (strategic) {
    const { axes, chantiers, chantierActions } = strategic;
    const progressOf: ProjetProgressLookup =
      strategic.projetProgress ?? ((a) => milestoneProgressPct(a));
    const healthOf = strategicHealthLookup(strategic);
    const todayDate = new Date(`${today}T00:00:00`);

    for (const axis of axes as StrategicAxis[]) {
      if (axis.owner !== user.username) continue;
      const own = chantiers.filter((c) => c.axisIds.includes(axis.id));
      out.push({
        id: `axis:${axis.id}`,
        kind: "axis",
        plan: "strategic",
        label: axis.name,
        role: t("me.role.axisSponsor", "Sponsor d'axe"),
        health: worstHealth(own.map(healthOf)),
        progressPct: average(
          chantierActions.filter((a) => own.some((c) => c.id === a.chantierId)).map(progressOf)
        ),
        href: leverHref(axis.id),
      });
    }
    for (const chantier of chantiers) {
      const pilote = chantier.pilote === user.username;
      const sponsor = !pilote && chantier.sponsorName === user.username;
      if (!pilote && !sponsor) continue;
      out.push({
        id: `chantier:${chantier.id}`,
        kind: "chantier",
        plan: "strategic",
        label: chantier.name,
        role: pilote ? t("me.role.pilote", "Pilote") : roleSponsor,
        health: healthOf(chantier),
        progressPct: average(
          chantierActions.filter((a) => a.chantierId === chantier.id).map(progressOf)
        ),
        href: chantierHref(chantier.id),
      });
    }
    const chantierById = new Map(chantiers.map((c) => [c.id, c]));
    for (const action of chantierActions) {
      const owner = action.owner === user.username;
      const sponsor = !owner && action.sponsor === user.username;
      if (!owner && !sponsor) continue;
      const pct = progressOf(action);
      const chantier = chantierById.get(action.chantierId);
      out.push({
        id: `action:${action.id}`,
        kind: "action",
        plan: "strategic",
        label: chantier ? `${chantier.name} · ${action.name}` : action.name,
        role: owner ? roleOwner : roleSponsor,
        health: isProjetDone(action, progressOf)
          ? "green"
          : isProjetLate(action, pct, todayDate)
            ? "red"
            : "green",
        progressPct: pct,
        href: projetHref(action.chantierId, action.id),
      });
    }
  }

  return out.sort(sortPerimeter);
}

/** Vue pilotage : une ligne par programme du périmètre. */
function buildPilotPerimeter(
  user: AuthUser,
  programs: Program[],
  scope: Set<string> | null,
  perf: BeTrackData | null,
  strategic: MyWorkspaceStrategicInput | null,
  alerts: Alert[],
  t: Translate
): WorkspacePerimeterEntry[] {
  const inScope = programs.filter((p) => !scope || scope.has(p.id));
  return inScope
    .map((program): WorkspacePerimeterEntry => {
      const type = resolveProgramType(program);
      let health: WorkspaceHealth = "neutral";
      let progressPct: number | undefined;
      if (type === "performance" && perf) {
        const levers = perf.levers.filter(
          (l) => l.programId === program.id && l.status !== "cancelled"
        );
        health = worstHealth(levers.map((l) => leverHealth(l, alerts)));
        progressPct = average(levers.map((l) => l.progress));
      } else if (type === "strategic" && strategic && strategic.programId === program.id) {
        const progressOf: ProjetProgressLookup =
          strategic.projetProgress ?? ((a) => milestoneProgressPct(a));
        const healthOf = strategicHealthLookup(strategic);
        health = worstHealth(strategic.chantiers.map(healthOf));
        progressPct = average(strategic.chantierActions.map(progressOf));
      }
      const role =
        program.sponsor === user.username
          ? t("me.role.sponsor", "Sponsor")
          : program.owner === user.username
            ? t("me.role.programOwner", "Owner du programme")
            : hasRole(user, "cto")
              ? t("me.role.cto", "CTO")
              : isAnyAdmin(user)
                ? t("me.role.admin", "Administrateur")
                : hasRole(user, "program_sponsor")
                  ? t("me.role.sponsor", "Sponsor")
                  : t("me.role.programOwner", "Owner du programme");
      return {
        id: `program:${program.id}`,
        kind: "program",
        plan: type,
        label: program.name,
        role,
        health,
        progressPct,
        href: `/dashboard?program=${encodeURIComponent(program.id)}`,
      };
    })
    .sort(sortPerimeter);
}
