import { axisDecisionMakers, isStrategicLeadOf } from "@/lib/axisLogic";
import { canFillIndicatorValue } from "@/lib/kpiHistory";
import { hasRole, isAnyAdmin } from "@/lib/roleProfiles";
import {
  approvalChain,
  type ApprovalStep,
  type HierarchyContext,
  type StrategicLevel,
} from "@/lib/strategicHierarchy";
import type { AuthUser, Chantier, ChantierAction, Indicator, StrategicAxis } from "@/types";

/**
 * Routage des CORRECTIONS / SUPPRESSIONS d'une mesure KPI déjà publiée (logique PURE, testée dans
 * `lib/__tests__/kpiCorrectionRouting.test.ts`).
 *
 * RÈGLE EN VIGUEUR (PO, « données de pilotage ») — une valeur KPI, saisie OU corrigée/supprimée,
 * est TOUJOURS validée par les deux niveaux au-dessus de son auteur, l'auteur étant traité au moins
 * comme sponsor de chantier (`approvalChain(..., 2, "chantierSponsor")`, voir
 * lib/strategicHierarchy.ts) : sponsor d'axe PUIS pilote du plan. Seuls le pilote du plan (chaîne
 * vide) et les admins corrigent directement ; un sponsor de chantier ou d'axe passe désormais par
 * une demande (plus de correction directe « avec information »). `routeKpiCorrection` renvoie la
 * chaîne (`chain`) ; `approver` = son 1er palier. Contexte hiérarchique : `kpiHierarchyContext`.
 *
 * Tableau HISTORIQUE (avant la règle ci-dessus, conservé pour les demandes legacy sans chaîne —
 * `kpiCorrectionApprover`, `kpiCorrectionDecisionInformees`) — hiérarchie des responsables :
 *
 *   responsable du plan (strategic_lead) > responsable d'axe (`StrategicAxis.owner`)
 *     > responsable de chantier (`Chantier.pilote`) > responsable de projet (`ChantierAction.owner`)
 *
 *  | Acteur (niveau le plus haut)  | Correction | Approbateur              | Informés                     |
 *  |-------------------------------|------------|--------------------------|------------------------------|
 *  | admin / responsable du plan   | directe    | —                        | personne                     |
 *  | responsable d'axe             | directe    | —                        | resp. du plan                |
 *  | responsable de chantier       | directe    | —                        | resp. d'axe + resp. du plan  |
 *  | responsable de projet         | DEMANDE    | resp. du chantier (1)    | à l'acceptation : resp.      |
 *  | autre saisisseur autorisé (2) | DEMANDE    | resp. du chantier (1)    |   d'axe + resp. du plan (3)  |
 *  | aucun droit                   | interdit   | —                        | —                            |
 *
 *  (1) repli en cascade si le chantier n'a pas de pilote : responsable d'axe, puis du plan.
 *  (2) `canFillIndicatorValue` (rôles responsables de l'indicateur, comptes additionnels) sans être
 *      responsable dans la hiérarchie — « la personne qui a saisi la valeur suit la règle de son rôle ».
 *  (3) hors décideur (ex. responsable d'axe décidant en repli) et hors demandeur.
 *
 * Rattachement d'un KPI : chantiers = `indicator.chantierId` + chantiers des projets dont
 * `ChantierAction.indicatorId` pointe sur le KPI (même lien que `chantiersByIndicatorId`, page KPI) ;
 * axes = `indicator.axisId` + axes de ces chantiers. Destinataires : responsables manquants ignorés,
 * dédoublonnés, jamais l'acteur lui-même.
 */

export type KpiCorrectionLevel = "plan" | "axis" | "chantier" | "projet" | "none";
export type KpiApproverLevel = "chantier" | "axis" | "plan";

export type KpiCorrectionData = {
  programId?: string | null;
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  users?: Pick<AuthUser, "username" | "profiles">[];
};

export type KpiCorrectionIndicator = Pick<
  Indicator,
  "id" | "programId" | "axisId" | "chantierId" | "responsibleRoles" | "additionalAuthorizedUserIds"
>;

type Actor = Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">;

export type KpiResponsibles = {
  chantiers: Chantier[];
  axes: StrategicAxis[];
  chantierPilotes: string[];
  axisOwners: string[];
  planLeads: string[];
  projetOwners: string[];
};

function uniq(list: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const v of list) if (v && !out.includes(v)) out.push(v);
  return out;
}

function programOf(indicator: KpiCorrectionIndicator, data: KpiCorrectionData): string {
  return indicator.programId ?? data.programId ?? "";
}

/** Responsables de chaque niveau pour un KPI (voir l'en-tête pour le rattachement). */
export function kpiResponsibles(
  indicator: KpiCorrectionIndicator,
  data: KpiCorrectionData
): KpiResponsibles {
  const chantierIds = uniq([
    indicator.chantierId,
    ...data.chantierActions.filter((a) => a.indicatorId === indicator.id).map((a) => a.chantierId),
  ]);
  const chantiers = chantierIds
    .map((id) => data.chantiers.find((c) => c.id === id))
    .filter((c): c is Chantier => !!c);
  const axisIds = uniq([indicator.axisId, ...chantiers.flatMap((c) => c.axisIds ?? [])]);
  const axes = axisIds
    .map((id) => data.axes.find((a) => a.id === id))
    .filter((a): a is StrategicAxis => !!a);
  const linkedChantierIds = new Set(chantiers.map((c) => c.id));
  const programId = programOf(indicator, data);
  return {
    chantiers,
    axes,
    chantierPilotes: uniq(chantiers.map((c) => c.pilote)),
    axisOwners: uniq(axes.flatMap((a) => axisDecisionMakers(a))),
    planLeads: uniq(
      (data.users ?? []).filter((u) => isStrategicLeadOf({ programId }, u)).map((u) => u.username)
    ),
    projetOwners: uniq(
      data.chantierActions
        .filter((a) => linkedChantierIds.has(a.chantierId) || a.indicatorId === indicator.id)
        .map((a) => a.owner)
    ),
  };
}

/**
 * Contexte hiérarchique d'un KPI pour `approvalChain` : chantier = celui où `requestedBy` porte un
 * projet lié au KPI s'il y en a un, sinon `indicator.chantierId`, sinon le 1er chantier lié ;
 * axes = `indicator.axisId` + axes de ce chantier (leurs sponsors détiennent ensemble le palier
 * "axisSponsor") ; pilotes = strategic_lead du programme du KPI.
 */
export function kpiHierarchyContext(
  indicator: KpiCorrectionIndicator,
  data: KpiCorrectionData,
  requestedBy?: string,
  resp: KpiResponsibles = kpiResponsibles(indicator, data)
): HierarchyContext {
  const own = requestedBy
    ? resp.chantiers.find((c) =>
        data.chantierActions.some((a) => a.chantierId === c.id && a.owner === requestedBy)
      )
    : undefined;
  const chantier =
    own ?? resp.chantiers.find((c) => c.id === indicator.chantierId) ?? resp.chantiers[0] ?? null;
  const axisIds = uniq([indicator.axisId, ...(chantier?.axisIds ?? [])]);
  const axes = axisIds
    .map((id) => data.axes.find((a) => a.id === id))
    .filter((a): a is StrategicAxis => !!a);
  return { axis: axes[0] ?? null, axes, chantier, projet: null, pilots: resp.planLeads };
}

/** Chaîne de validation d'une valeur KPI saisie/corrigée par `author` (voir l'en-tête). */
export function kpiApprovalChain(
  author: string,
  indicator: KpiCorrectionIndicator,
  data: KpiCorrectionData,
  resp: KpiResponsibles = kpiResponsibles(indicator, data)
): ApprovalStep[] {
  return approvalChain(
    author,
    kpiHierarchyContext(indicator, data, author, resp),
    2,
    "chantierSponsor"
  );
}

/** Niveau hiérarchique le plus haut de l'acteur vis-à-vis de ce KPI. */
export function kpiCorrectionLevel(
  actor: Actor | null | undefined,
  indicator: KpiCorrectionIndicator,
  data: KpiCorrectionData,
  resp: KpiResponsibles = kpiResponsibles(indicator, data)
): KpiCorrectionLevel {
  if (!actor) return "none";
  if (isAnyAdmin(actor)) return "plan";
  if (
    hasRole(actor, "strategic_lead") &&
    isStrategicLeadOf({ programId: programOf(indicator, data) }, actor)
  ) {
    return "plan";
  }
  if (resp.axisOwners.includes(actor.username)) return "axis";
  if (resp.chantierPilotes.includes(actor.username)) return "chantier";
  if (resp.projetOwners.includes(actor.username)) return "projet";
  return "none";
}

/** Personnes à INFORMER après une correction appliquée par un acteur de niveau `level` : tous les
 *  responsables des niveaux strictement supérieurs. `exclude` (acteur, demandeur…) jamais inclus. */
export function kpiCorrectionInformees(
  level: KpiCorrectionLevel,
  resp: KpiResponsibles,
  exclude: (string | undefined)[] = []
): string[] {
  const list =
    level === "plan"
      ? []
      : level === "axis"
        ? resp.planLeads
        : [...resp.axisOwners, ...resp.planLeads];
  return uniq(list).filter((u) => !exclude.includes(u));
}

export type KpiCorrectionApprover = {
  level: KpiApproverLevel;
  usernames: string[];
  /** Libellés des entités du niveau approbateur (chantier(s) / axe(s)) ; vide pour le plan. */
  entityNames: string[];
};

/**
 * Approbateur d'une DEMANDE de correction : responsable(s) du chantier — de préférence les chantiers
 * où le demandeur porte un projet —, repli responsable d'axe, puis responsable du plan.
 */
export function kpiCorrectionApprover(
  indicator: KpiCorrectionIndicator,
  data: KpiCorrectionData,
  requestedBy?: string,
  resp: KpiResponsibles = kpiResponsibles(indicator, data)
): KpiCorrectionApprover {
  const own = requestedBy
    ? resp.chantiers.filter((c) =>
        data.chantierActions.some((a) => a.chantierId === c.id && a.owner === requestedBy)
      )
    : [];
  const scope = own.length ? own : resp.chantiers;
  const withPilote = scope.filter((c) => c.pilote && c.pilote !== requestedBy);
  if (withPilote.length) {
    return {
      level: "chantier",
      usernames: uniq(withPilote.map((c) => c.pilote)),
      entityNames: uniq(withPilote.map((c) => c.name)),
    };
  }
  const scopeAxisIds = new Set(
    scope.length ? scope.flatMap((c) => c.axisIds ?? []) : resp.axes.map((a) => a.id)
  );
  const axes = resp.axes.filter(
    (a) => scopeAxisIds.has(a.id) && axisDecisionMakers(a).some((u) => u !== requestedBy)
  );
  if (axes.length) {
    return {
      level: "axis",
      usernames: uniq(axes.flatMap((a) => axisDecisionMakers(a))).filter((u) => u !== requestedBy),
      entityNames: uniq(axes.map((a) => a.name)),
    };
  }
  return {
    level: "plan",
    usernames: resp.planLeads.filter((u) => u !== requestedBy),
    entityNames: [],
  };
}

/** Niveaux effectivement représentés parmi des destinataires (textes UI « … seront informés »). */
export type KpiInformLevel = "axis" | "plan";

function informLevels(usernames: string[], resp: KpiResponsibles): KpiInformLevel[] {
  const out: KpiInformLevel[] = [];
  if (usernames.some((u) => resp.axisOwners.includes(u))) out.push("axis");
  if (usernames.some((u) => resp.planLeads.includes(u) && !resp.axisOwners.includes(u))) {
    out.push("plan");
  }
  return out;
}

export type KpiCorrectionRoute =
  | { mode: "forbidden"; level: KpiCorrectionLevel }
  | {
      mode: "direct";
      level: KpiCorrectionLevel;
      inform: string[];
      informLevels: KpiInformLevel[];
    }
  | {
      mode: "request";
      level: KpiCorrectionLevel;
      /** 1er palier de `chain` (compat des écrans existants). */
      approver: KpiCorrectionApprover;
      /** Chaîne complète (sponsor d'axe puis pilote, en général). */
      chain: ApprovalStep[];
      /** Informés à l'acceptation (si le responsable nominal décide). */
      informOnApproval: string[];
      informLevels: KpiInformLevel[];
    };

const STEP_APPROVER_LEVEL: Partial<Record<StrategicLevel, KpiApproverLevel>> = {
  chantierSponsor: "chantier",
  axisSponsor: "axis",
  pilot: "plan",
};

/** Qui peut corriger directement, qui approuve (chaîne), qui est informé (voir l'en-tête). */
export function routeKpiCorrection(
  actor: Actor | null | undefined,
  indicator: KpiCorrectionIndicator,
  data: KpiCorrectionData
): KpiCorrectionRoute {
  const resp = kpiResponsibles(indicator, data);
  const level = kpiCorrectionLevel(actor, indicator, data, resp);
  if (!actor) return { mode: "forbidden", level };
  if (
    level === "none" &&
    !canFillIndicatorValue(indicator, actor, { axes: data.axes, chantiers: data.chantiers })
  ) {
    return { mode: "forbidden", level };
  }
  const chain = level === "plan" ? [] : kpiApprovalChain(actor.username, indicator, data, resp);
  if (chain.length === 0) {
    // Pilote du plan / admin (ou personne au-dessus) : correction directe, personne à informer.
    return { mode: "direct", level, inform: [], informLevels: [] };
  }
  const first = chain[0];
  const approver: KpiCorrectionApprover = {
    level: STEP_APPROVER_LEVEL[first.level] ?? "plan",
    usernames: first.usernames,
    entityNames:
      first.level === "axisSponsor"
        ? uniq(
            resp.axes.filter((a) => a.owner && first.usernames.includes(a.owner)).map((a) => a.name)
          )
        : first.level === "chantierSponsor"
          ? uniq(
              resp.chantiers
                .filter((c) => c.pilote && first.usernames.includes(c.pilote))
                .map((c) => c.name)
            )
          : [],
  };
  // Les paliers de la chaîne VALIDENT (ils ne sont donc pas « informés ») : restent les éventuels
  // autres responsables d'axe/plan du KPI (ex. KPI rattaché à plusieurs axes).
  const informOnApproval = kpiCorrectionInformees("chantier", resp, [
    actor.username,
    ...chain.flatMap((st) => st.usernames),
  ]);
  return {
    mode: "request",
    level,
    approver,
    chain,
    informOnApproval,
    informLevels: informLevels(informOnApproval, resp),
  };
}

/** Informés quand une demande de correction est ACCEPTÉE : responsable(s) d'axe et du plan (règle
 *  PO, quel que soit le décideur — pilote, ou escalade axe/plan/admin), hors décideur et
 *  demandeur. */
export function kpiCorrectionDecisionInformees(
  decider: Pick<Actor, "username"> | null | undefined,
  requestedBy: string,
  indicator: KpiCorrectionIndicator,
  data: KpiCorrectionData
): string[] {
  return kpiCorrectionInformees("chantier", kpiResponsibles(indicator, data), [
    decider?.username,
    requestedBy,
  ]);
}
