import type {
  ActionImpact,
  ActionStatus,
  Lever,
  LeverAction,
  LeverDependency,
  LeverStatus,
  RecognitionMode,
  SavingType,
} from "@/types";
import { hasActionImpacts } from "@/lib/leverConsolidate";

/** Forme d'un ancien sous-levier (référentiel legacy pré-migration), utilisée uniquement pour
 * convertir le seed `data/mockData.ts` historique vers le modèle actuel Levier → Action enrichie.
 * Ce type n'existe plus dans le modèle de données live (voir types/index.ts, "SubLever" retiré) —
 * confiné à ce script de migration ponctuelle du jeu de données de démo. */
export type LegacySubLever = {
  id: string;
  leverId: string;
  name: string;
  owner?: string;
  ownerInit?: string;
  expensePost: string;
  businessUnit: string;
  pnlMap: string;
  grossSavings: number;
  netSavings: number;
  opexOneOff: number;
  opexRec: number;
  capex: number;
  fteImpact: number;
  popImpacted: number;
  start: string;
  end: string;
  status: LeverStatus;
  deliveredDate?: string;
  dependencies: LeverDependency[];
  actions: LeverAction[];
};

function actionStatus(status: LeverStatus, progress = 0): ActionStatus {
  if (status === "delivered") return "done";
  if (status === "cancelled") return "delayed";
  if (status === "in_progress") return progress >= 70 ? "done" : "in_progress";
  return "todo";
}

function deliveredDate(status: ActionStatus, end: string): string | undefined {
  return status === "done" ? end : undefined;
}

function midpoint(start: string, end: string, ratio: number): string {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return new Date(a + (b - a) * ratio).toISOString().slice(0, 10);
}

/** Répartit déterministiquement les impacts "saving" migrés entre les deux modes de
 *  reconnaissance (voire aucun, pour illustrer l'héritage de Company.defaultRecognition) — sur la
 *  base d'un hash stable de la clé fournie, pour obtenir un mélange varié mais reproductible d'un
 *  seed à l'autre plutôt qu'une règle unique appliquée à tout le jeu de démo. */
function pickRecognition(key: string): RecognitionMode | undefined {
  const hash = Array.from(key).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const bucket = hash % 3;
  if (bucket === 0) return "one_shot";
  if (bucket === 1) return "smoothing";
  return undefined;
}

/** Repère les leviers/sous-leviers dont le libellé évoque un enjeu BFR (stocks, rotation,
 *  encours, délais de paiement) pour varier `savingType` sans forcer ce classement partout. */
function isWorkingCapitalCandidate(text: string): boolean {
  return /stock|inventaire|inventory|rotation entrep|créances|encours client|délai de paiement|besoin en fonds de roulement|\bBFR\b/i.test(
    text
  );
}

function inferSavingType(pnlMap: string, contextText: string): SavingType {
  if (isWorkingCapitalCandidate(contextText)) return "working_capital";
  if (pnlMap === "REV") return "revenue_increase";
  return "cost_reduction";
}

function financialImpacts(
  prefix: string,
  values: {
    netSavings: number;
    capex: number;
    opexOneOff: number;
    opexRec: number;
    fteImpact: number;
    pnlMap: string;
    costCenter?: string;
    entity?: string;
  },
  // Intervalle de l'action porteuse — sert à dater `capexDeploymentDate`/`gainDate` plutôt que de
  // laisser ces champs vides (voir ActionImpact, types/index.ts).
  actionStart: string,
  actionEnd: string,
  options: { deliveredDate?: string; contextText?: string } = {}
): ActionImpact[] {
  const impacts: ActionImpact[] = [];
  if (values.capex > 0) {
    impacts.push({
      id: `${prefix}-CAPEX`,
      label: "Investissement / déploiement",
      type: "cost",
      nature: "capex",
      amount: values.capex,
      pnlMap: values.pnlMap,
      costCenter: values.costCenter,
      entity: values.entity,
      // Le CAPEX est engagé tôt dans l'exécution de l'action porteuse (premier tiers).
      capexDeploymentDate: midpoint(actionStart, actionEnd, 1 / 3),
    });
  }
  if (values.opexOneOff > 0) {
    impacts.push({
      id: `${prefix}-ONEOFF`,
      label: "Coûts ponctuels de transformation",
      type: "cost",
      nature: "oneoff",
      amount: values.opexOneOff,
      pnlMap: values.pnlMap,
      costCenter: values.costCenter,
      entity: values.entity,
    });
  }
  if (values.opexRec > 0) {
    impacts.push({
      id: `${prefix}-OPEX`,
      label: "Coûts récurrents",
      type: "cost",
      nature: "opex_rec",
      amount: values.opexRec,
      pnlMap: values.pnlMap,
      costCenter: values.costCenter,
      entity: values.entity,
    });
  }
  const totalCosts = values.capex + values.opexOneOff + values.opexRec;
  const grossValue = Math.max(0, values.netSavings + totalCosts);
  if (grossValue > 0) {
    impacts.push({
      id: `${prefix}-SAVING`,
      label: values.fteImpact < 0 ? "Gains de productivité / réduction ETP" : "Savings réalisés",
      type: "saving",
      nature: "opex_rec",
      amount: Math.round(grossValue * 100) / 100,
      fteCount: values.fteImpact || undefined,
      pnlMap: values.pnlMap,
      costCenter: values.costCenter,
      entity: values.entity,
      savingType: inferSavingType(values.pnlMap, options.contextText ?? ""),
      // Le gain est constaté à la clôture de l'action porteuse (date de livraison si déjà connue).
      gainDate: options.deliveredDate ?? actionEnd,
      recognition: pickRecognition(prefix),
    });
  }
  return impacts;
}

function migrateSubLever(sub: LegacySubLever, parent: Lever): LeverAction[] {
  // Un sous-levier sans détail historique devient une action unique.
  if (sub.actions.length === 0) {
    const status = actionStatus(sub.status, parent.progress);
    return [
      {
        id: `AC-${sub.id}`,
        name: sub.name,
        owner: sub.owner ?? parent.owner,
        ownerInit: sub.ownerInit ?? parent.ownerInit,
        start: sub.start,
        end: sub.end,
        cost: 0,
        status,
        deliveredDate: sub.deliveredDate ?? deliveredDate(status, sub.end),
        impacts: financialImpacts(
          `IMP-${sub.id}`,
          {
            netSavings: sub.netSavings,
            capex: sub.capex,
            opexOneOff: sub.opexOneOff,
            opexRec: sub.opexRec,
            fteImpact: sub.fteImpact,
            pnlMap: sub.pnlMap || parent.pnlMap,
            costCenter: sub.expensePost || parent.costCenter,
            entity: parent.entity,
          },
          sub.start,
          sub.end,
          { deliveredDate: sub.deliveredDate, contextText: sub.name }
        ),
      },
    ];
  }

  const sortedActions = [...sub.actions].sort((a, b) => a.end.localeCompare(b.end));
  const lastActionId = sortedActions.at(-1)!.id;
  const totalLegacyCost = sortedActions.reduce((sum, action) => sum + Math.max(0, action.cost), 0);
  const equalWeight = 1 / sortedActions.length;
  const totalCosts = sub.capex + sub.opexOneOff + sub.opexRec;
  const grossValue = Math.max(0, sub.netSavings + totalCosts);

  return sortedActions.map((action, index) => {
    const weight = totalLegacyCost > 0 ? Math.max(0, action.cost) / totalLegacyCost : equalWeight;
    const isLast = action.id === lastActionId;
    const impacts: ActionImpact[] = [];

    if (sub.capex > 0) {
      impacts.push({
        id: `IMP-${sub.id}-${index + 1}-CAPEX`,
        label: `${action.name} — investissement`,
        type: "cost",
        nature: "capex",
        amount: Math.round(sub.capex * weight * 100) / 100,
        pnlMap: sub.pnlMap || parent.pnlMap,
        costCenter: sub.expensePost || parent.costCenter,
        entity: parent.entity,
        // Le CAPEX est engagé tôt dans l'exécution de cette action (premier tiers).
        capexDeploymentDate: midpoint(action.start, action.end, 1 / 3),
      });
    }
    if (sub.opexOneOff > 0) {
      impacts.push({
        id: `IMP-${sub.id}-${index + 1}-ONEOFF`,
        label: `${action.name} — coûts ponctuels`,
        type: "cost",
        nature: "oneoff",
        amount: Math.round(sub.opexOneOff * weight * 100) / 100,
        pnlMap: sub.pnlMap || parent.pnlMap,
        costCenter: sub.expensePost || parent.costCenter,
        entity: parent.entity,
      });
    }
    if (sub.opexRec > 0) {
      impacts.push({
        id: `IMP-${sub.id}-${index + 1}-OPEX`,
        label: `${action.name} — coûts récurrents`,
        type: "cost",
        nature: "opex_rec",
        amount: Math.round(sub.opexRec * weight * 100) / 100,
        pnlMap: sub.pnlMap || parent.pnlMap,
        costCenter: sub.expensePost || parent.costCenter,
        entity: parent.entity,
      });
    }
    const resolvedDeliveredDate = action.deliveredDate ?? deliveredDate(action.status, action.end);

    if (isLast && grossValue > 0) {
      impacts.push({
        id: `IMP-${sub.id}-${index + 1}-SAVING`,
        label:
          sub.fteImpact < 0
            ? `${sub.name} — gains de productivité / réduction ETP`
            : `${sub.name} — savings réalisés`,
        type: "saving",
        nature: "opex_rec",
        amount: Math.round(grossValue * 100) / 100,
        fteCount: sub.fteImpact || undefined,
        pnlMap: sub.pnlMap || parent.pnlMap,
        costCenter: sub.expensePost || parent.costCenter,
        entity: parent.entity,
        savingType: inferSavingType(sub.pnlMap || parent.pnlMap, sub.name),
        // Le gain est constaté à la clôture de cette (dernière) action porteuse.
        gainDate: resolvedDeliveredDate ?? action.end,
        recognition: pickRecognition(`IMP-${sub.id}-${index + 1}-SAVING`),
      });
    }

    return {
      ...action,
      owner: sub.owner ?? parent.owner,
      ownerInit: sub.ownerInit ?? parent.ownerInit,
      deliveredDate: resolvedDeliveredDate,
      impacts: impacts.filter((impact) => impact.amount > 0),
    };
  });
}

function buildSimpleActions(lever: Lever): LeverAction[] {
  if ((lever.actions ?? []).some((action) => (action.impacts ?? []).length > 0)) {
    return lever.actions ?? [];
  }
  const firstEnd = midpoint(lever.start, lever.end, 0.25);
  const secondStart = midpoint(lever.start, lever.end, 0.26);
  const secondEnd = midpoint(lever.start, lever.end, 0.72);
  const thirdStart = midpoint(lever.start, lever.end, 0.73);

  const firstStatus: ActionStatus =
    lever.status === "delivered" || lever.progress >= 30
      ? "done"
      : lever.progress > 0
        ? "in_progress"
        : "todo";
  const secondStatus: ActionStatus =
    lever.status === "delivered" || lever.progress >= 70
      ? "done"
      : lever.progress >= 30
        ? "in_progress"
        : "todo";
  const thirdStatus: ActionStatus =
    lever.status === "delivered" ? "done" : lever.status === "cancelled" ? "delayed" : "todo";

  return [
    {
      id: `AC-${lever.id}-01`,
      name: "Cadrage et préparation",
      start: lever.start,
      end: firstEnd,
      cost: Math.round(lever.opexOneOff * 1000),
      status: firstStatus,
      deliveredDate: deliveredDate(firstStatus, firstEnd),
      impacts:
        lever.opexOneOff > 0
          ? financialImpacts(
              `IMP-${lever.id}-01`,
              {
                netSavings: 0,
                capex: 0,
                opexOneOff: lever.opexOneOff,
                opexRec: 0,
                fteImpact: 0,
                pnlMap: lever.pnlMap,
                costCenter: lever.costCenter,
                entity: lever.entity,
              },
              lever.start,
              firstEnd,
              { contextText: lever.description }
            )
          : [],
    },
    {
      id: `AC-${lever.id}-02`,
      name: "Mise en œuvre et déploiement",
      start: secondStart,
      end: secondEnd,
      cost: Math.round((lever.capex + lever.opexRec) * 1000),
      status: secondStatus,
      deliveredDate: deliveredDate(secondStatus, secondEnd),
      impacts: financialImpacts(
        `IMP-${lever.id}-02`,
        {
          netSavings: 0,
          capex: lever.capex,
          opexOneOff: 0,
          opexRec: lever.opexRec,
          fteImpact: 0,
          pnlMap: lever.pnlMap,
          costCenter: lever.costCenter,
          entity: lever.entity,
        },
        secondStart,
        secondEnd,
        { contextText: lever.description }
      ),
    },
    {
      id: `AC-${lever.id}-03`,
      name: "Réalisation et sécurisation des gains",
      start: thirdStart,
      end: lever.end,
      cost: 0,
      status: thirdStatus,
      deliveredDate: lever.deliveredDate ?? deliveredDate(thirdStatus, lever.end),
      impacts: financialImpacts(
        `IMP-${lever.id}-03`,
        {
          // Les coûts sont portés par les deux actions précédentes : le gain de cette dernière
          // action doit donc correspondre au net du levier + tous ses coûts pour que la somme
          // consolidée des actions restitue exactement le netSavings du levier parent.
          netSavings: lever.netSavings + lever.capex + lever.opexOneOff + lever.opexRec,
          capex: 0,
          opexOneOff: 0,
          opexRec: 0,
          fteImpact: lever.fteImpact,
          pnlMap: lever.pnlMap,
          costCenter: lever.costCenter,
          entity: lever.entity,
        },
        thirdStart,
        lever.end,
        { deliveredDate: lever.deliveredDate, contextText: lever.description }
      ),
    },
  ];
}

function alignActionsToLeverFinancials(actions: LeverAction[], lever: Lever): LeverAction[] {
  if (actions.length === 0) return actions;
  const next = actions.map((action) => ({
    ...action,
    impacts: (action.impacts ?? []).map((impact) => ({ ...impact })),
  }));

  const adjust = (
    predicate: (impact: ActionImpact) => boolean,
    target: number,
    create: (amount: number) => ActionImpact
  ) => {
    const current = next.reduce(
      (sum, action) =>
        sum + (action.impacts ?? []).filter(predicate).reduce((s, impact) => s + impact.amount, 0),
      0
    );
    const delta = Math.round((target - current) * 100) / 100;
    if (Math.abs(delta) < 0.005) return;

    for (let actionIdx = next.length - 1; actionIdx >= 0; actionIdx--) {
      const impacts = next[actionIdx].impacts ?? [];
      const impactIdx = impacts.findLastIndex(predicate);
      if (impactIdx !== -1 && impacts[impactIdx].amount + delta > 0) {
        impacts[impactIdx] = {
          ...impacts[impactIdx],
          amount: Math.round((impacts[impactIdx].amount + delta) * 100) / 100,
        };
        return;
      }
    }
    if (delta > 0) {
      next.at(-1)!.impacts = [...(next.at(-1)!.impacts ?? []), create(delta)];
    }
  };

  adjust(
    (impact) => impact.type === "cost" && impact.nature === "capex",
    lever.capex,
    (amount) => ({
      id: `IMP-${lever.id}-CAPEX-ADJ`,
      label: "Investissement complémentaire",
      type: "cost",
      nature: "capex",
      amount,
      pnlMap: lever.pnlMap,
      costCenter: lever.costCenter,
      entity: lever.entity,
      capexDeploymentDate: midpoint(next.at(-1)!.start, next.at(-1)!.end, 1 / 3),
    })
  );
  adjust(
    (impact) => impact.type === "cost" && impact.nature === "oneoff",
    lever.opexOneOff,
    (amount) => ({
      id: `IMP-${lever.id}-ONEOFF-ADJ`,
      label: "Coûts ponctuels complémentaires",
      type: "cost",
      nature: "oneoff",
      amount,
      pnlMap: lever.pnlMap,
      costCenter: lever.costCenter,
      entity: lever.entity,
    })
  );
  adjust(
    (impact) => impact.type === "cost" && impact.nature === "opex_rec",
    lever.opexRec,
    (amount) => ({
      id: `IMP-${lever.id}-OPEX-ADJ`,
      label: "Coûts récurrents complémentaires",
      type: "cost",
      nature: "opex_rec",
      amount,
      pnlMap: lever.pnlMap,
      costCenter: lever.costCenter,
      entity: lever.entity,
    })
  );

  const totalCosts = lever.capex + lever.opexOneOff + lever.opexRec;
  adjust(
    (impact) => impact.type === "saving",
    lever.netSavings + totalCosts,
    (amount) => ({
      id: `IMP-${lever.id}-SAVING-ADJ`,
      label: "Savings complémentaires",
      type: "saving",
      nature: "opex_rec",
      amount,
      pnlMap: lever.pnlMap,
      costCenter: lever.costCenter,
      entity: lever.entity,
      savingType: inferSavingType(lever.pnlMap, lever.description),
      gainDate: lever.deliveredDate ?? next.at(-1)!.end,
      recognition: pickRecognition(`IMP-${lever.id}-SAVING-ADJ`),
    })
  );

  // Le FTE n'est pas un montant financier : rattache l'écart à la dernière ligne de savings.
  const currentFte = next.reduce(
    (sum, action) =>
      sum + (action.impacts ?? []).reduce((s, impact) => s + (impact.fteCount ?? 0), 0),
    0
  );
  const fteDelta = lever.fteImpact - currentFte;
  if (fteDelta !== 0) {
    for (let actionIdx = next.length - 1; actionIdx >= 0; actionIdx--) {
      const impacts = next[actionIdx].impacts ?? [];
      const impactIdx = impacts.findLastIndex((impact) => impact.type === "saving");
      if (impactIdx !== -1) {
        impacts[impactIdx] = {
          ...impacts[impactIdx],
          fteCount: (impacts[impactIdx].fteCount ?? 0) + fteDelta,
        };
        break;
      }
    }
  }

  return next;
}

/** Migration déterministe du seed legacy (Levier → Sous-levier → Action) vers 2 mailles
 * Levier → Action enrichie. Le type sous-levier n'existe plus dans le modèle live (voir
 * LegacySubLever plus haut) : cette fonction n'est appelée qu'au bootstrap du seed de démo, et le
 * résultat retourné ne contient plus aucun sous-levier. */
export function migrateMockLeversToActions(levers: Lever[], subLevers: LegacySubLever[]): Lever[] {
  const subLeverParentById = new Map(subLevers.map((sub) => [sub.id, sub.leverId]));

  return levers.map((lever) => {
    const children = subLevers.filter((sub) => sub.leverId === lever.id);
    // Déjà migré/enrichi : conserver exactement les données utilisateur. Cette garde rend la
    // migration idempotente et empêche un chargement ultérieur de réécrire les impacts saisis.
    if (children.length === 0 && hasActionImpacts(lever)) return lever;

    const actions =
      children.length > 0
        ? children.flatMap((sub) => migrateSubLever(sub, lever))
        : buildSimpleActions(lever);

    // Remonte les dépendances historiques entre sous-leviers au niveau des leviers.
    // Les dépendances internes au même levier disparaissent : les actions d'un même levier
    // sont désormais suivies dans son plan d'action plutôt que comme dépendances externes.
    const promotedDependencies = [
      ...lever.dependencies,
      ...children.flatMap((sub) => sub.dependencies),
    ]
      .map((dependency) => ({
        ...dependency,
        targetId: subLeverParentById.get(dependency.targetId) ?? dependency.targetId,
      }))
      .filter((dependency) => dependency.targetId !== lever.id);

    const dependencyByTarget = new Map(
      promotedDependencies.map((dependency) => [dependency.targetId, dependency])
    );

    return {
      ...lever,
      actions: alignActionsToLeverFinancials(actions, lever),
      dependencies: Array.from(dependencyByTarget.values()),
    };
  });
}
