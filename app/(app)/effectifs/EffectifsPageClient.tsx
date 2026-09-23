"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import {
  BudgetDonutChart,
  type BudgetDonutSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { Modal } from "@/components/shared/Modal";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { StaffingImportButton } from "@/components/strategic/StaffingImportButton";
import { StaffingPeriodBreakdown } from "@/components/strategic/StaffingPeriodBreakdown";
import { StaffingRateSection } from "@/components/strategic/StaffingRateSection";
import { EMPTY_BUDGET, rollupBudgets } from "@/lib/budgetRollup";
import { saveChantierStaffing } from "@/lib/firestore/chantierStaffing";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatCompactCurrency, formatPercent } from "@/lib/formatCompactAmount";

/**
 * Page « Effectifs mobilisés » — lecture transverse du staffing saisi chantier par chantier
 * (`ChantierStaffingEditor`, dans la pop-up de détail d'un chantier), ou importé en lot via
 * `StaffingImportButton` (round 7). Trois niveaux de lecture, dans l'ordre demandé par le PO :
 *
 *  0. MOBILISÉ vs DISPONIBLE (`StaffingRateSection`, calcul dans `lib/staffingRate.ts`) : ETP
 *     mobilisés (`ChantierStaffing.fte`, moyens sur la période) comparés au disponible RÉEL de la
 *     base ETP entreprise (`Employee.fte` par département — `useCompanyDepartments`, live), via le
 *     TAUX DE STAFFING = mobilisé / disponible (> 100 % sur-staffé, 85–100 % tendu). Vue par
 *     mois/trimestre/semestre/année, filtre multi-axes, et heatmap équipe × mois (« en mars l'IT
 *     est sur-staffée »). Remplace l'ancienne section « Besoin déclaré vs disponible » (notion de
 *     besoin déclaré et graphique par équipe retirés à la demande du PO).
 *  1. PAR PÉRIODE ET PAR AXE (`StaffingPeriodBreakdown`, round 7, fusionné round 22) : combien
 *     d'ETP le programme mobilise-t-il, trimestre/semestre/année par trimestre/semestre/année, et
 *     par équipe OU par axe (toggle "Période"/"Axe" interne au composant) dans chaque période.
 *     Round 22 (PO : le second graphique historique « Répartition par axe », sans dimension
 *     temporelle, ne réagissait jamais au toggle de granularité seul) — les deux anciennes cartes
 *     séparées ("par période" et "par axe") sont désormais UNE seule carte, l'abscisse restant
 *     TOUJOURS la période dans les deux modes. Toute la logique de cross-filtering (équipe/chantier
 *     sélectionnés, période épinglée, granularité) est désormais interne à ce composant — cette
 *     page ne lève plus cet état, voir le doc-comment de `StaffingPeriodBreakdown.tsx`.
 *
 * Aucune écriture MANUELLE ici : la saisie ligne par ligne vit exclusivement dans la fiche
 * chantier, pour ne pas avoir deux flux de saisie divergents sur la même donnée (même parti pris
 * que la page KPI vs la fiche axe). Seule exception, round 7 : le bouton d'import Excel
 * (`StaffingImportButton`) délègue l'écriture EN LOT à `saveChantierStaffing` — après aperçu et
 * confirmation explicite, jamais en silence (voir `lib/staffingExcelImport.ts`).
 *
 * Round 13 : la liste des équipes n'est plus une union fermée à 9 valeurs codée en dur
 * (`StaffingFunction`, retirée de `types/index.ts`) mais dérivée EN LIVE de la base ETP entreprise
 * (`useCompanyDepartments`) — voir le lien « Voir la base ETP » dans l'en-tête, qui pointe vers
 * `/hr/etp` (module RH/Plan Performance, désormais accessible aussi depuis le Plan Stratégique,
 * voir `lib/nav-config.ts`). Une entreprise sans base ETP encore saisie voit cette page vide de
 * toute équipe, avec un message explicite plutôt qu'un référentiel arbitraire.
 *
 * Rien à voir avec les écrans RH du Plan Performance eux-mêmes : `Chantier`/`ChantierStaffing`
 * n'existent que côté stratégique, et la route est fermée aux programmes Performance (voir la
 * garde `programType` en bas de fichier + `programTypes: ["strategic"]` dans `lib/nav-config.ts`).
 * Seule la base ETP (`Employee`, via `useCompanyDepartments`) est PARTAGÉE entre les deux plans.
 */

/** Repère "à quel niveau du drill-down budgétaire suis-je ?" pour le donut « Budget financier
 *  alloué » ci-dessous (round 26) — même patron que `HierarchyLevelBreadcrumb` du module Finance
 *  (`components/finance/FinanceCostCharts.tsx`.`CostByHierarchyChart`), simplifié à 3 niveaux FIXES
 *  (axe → chantier → projet) plutôt que dérivé d'une config `HierarchyLevelDef[]` — cette page n'a
 *  pas besoin de la généralité d'une arborescence configurable, la profondeur est toujours 3.
 *  Purement informatif : le drill-down se fait toujours en cliquant une part du donut ou via le
 *  bouton retour du `CardHeader`. */
function BudgetDrillBreadcrumb({ currentIndex }: { currentIndex: number }) {
  const { t } = useTranslation();
  const levels = [
    t("effectifs.moneyBudget.levelAxis"),
    t("effectifs.moneyBudget.levelChantier"),
    t("effectifs.moneyBudget.levelProjet"),
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {levels.map((label, index) => (
        <span key={label} className="flex items-center gap-1">
          {index > 0 && <ChevronRight size={12} className="text-tertiary" />}
          <span
            className={
              index === currentIndex
                ? "rounded-full bg-black px-2 py-0.5 text-[10.5px] font-semibold text-white"
                : "rounded-full px-2 py-0.5 text-[10.5px] font-medium text-tertiary"
            }
          >
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}

export function EffectifsPageClient() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const { user, loading: roleLoading } = useRole();
  const {
    activeProgram,
    activeProgramId,
    programType,
    loading: programLoading,
  } = useActiveProgram();
  const {
    axes,
    chantiers,
    chantierActions,
    staffing,
    strategicRole,
    loading: dataLoading,
  } = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const {
    employees,
    fteByDept,
    loading: departmentsLoading,
  } = useCompanyDepartments(user?.companyId ?? null);

  /** État du drill-down EN PLACE du donut « Budget financier alloué » (round 26 — remplace le
   *  drill-down par MODALE de round 13/25 : le même donut se redessine désormais d'un niveau à
   *  l'autre, comme `CostByHierarchyChart` du module Finance, plutôt que d'ouvrir une seconde vue
   *  superposée). Chemin de 0 à 2 entrées, PROFONDEUR FIXE à 3 niveaux (axe → chantier → projet,
   *  contrairement à `CostByHierarchyChart` dont la profondeur est configurable) :
   *   - `[]`                  → le donut affiche les AXES (niveau 1, comme avant) ;
   *   - `[axe]`                → le donut redessine EN PLACE les CHANTIERS de cet axe ;
   *   - `[axe, chantier]`      → le donut redessine EN PLACE les PROJETS (`ChantierAction`, alias
   *     « levier ») de ce chantier ; cliquer un projet NE POUSSE PAS de 3e entrée, il navigue
   *     directement vers sa fiche (voir `moneyBudgetSection` plus bas) — la profondeur du chemin
   *     reste donc toujours ≤ 2.
   *  Chaque entrée porte `id` (pour retrouver l'entité) ET `label` (le nom déjà résolu, affiché tel
   *  quel par le bouton retour du `CardHeader` — même contrat que `drillPath` dans
   *  `CostByHierarchyChart`, simplifié ici sans `levelKey`/`parentId` puisque l'ordre des niveaux
   *  est fixe et connu d'avance). */
  const [budgetDrillPath, setBudgetDrillPath] = useState<{ id: string; label: string }[]>([]);

  /** Round 25 (RBAC), porté round 26 sur le nouveau `budgetDrillPath` : pour `axis_sponsor`, `axes`
   *  ne contient déjà plus que SON/SES propre(s) axe(s) (scoping du hook) — le donut « Répartition
   *  par axe » n'a donc plus rien d'informatif à montrer EN PREMIER pour ce rôle (une seule part à
   *  100%, ou quelques parts qui lui appartiennent toutes déjà). Plutôt que de le faire cliquer sur
   *  sa propre part pour descendre au niveau chantier — mécanisme déjà construit pour les autres
   *  rôles, voir `moneyBudgetSection` plus bas —, on descend directement à ce niveau sur son
   *  premier axe dès que la liste (scopée) est connue. Le garde `budgetDrillPath.length === 0` est
   *  la transposition exacte de l'ancien `budgetDrilldownAxisId === null`. */
  useEffect(() => {
    if (strategicRole === "axis_sponsor" && axes.length > 0 && budgetDrillPath.length === 0) {
      setBudgetDrillPath([{ id: axes[0].id, label: axes[0].name }]);
    }
  }, [strategicRole, axes, budgetDrillPath]);

  /** Équipe dont on affiche les employés disponibles (bouton « Voir les employés disponibles » à
   *  côté du tag de filtre équipe de `StaffingRateSection`) — `null` = fermé. */
  const [availableTeam, setAvailableTeam] = useState<string | null>(null);

  const chantierNames = useMemo(() => new Map(chantiers.map((c) => [c.id, c.name])), [chantiers]);

  /** Même lookup que `chantierNames` ci-dessus, en `Record` plutôt qu'en `Map` — round 20, point 3 :
   *  `StaffingPeriodBreakdown` (composant partagé, pas de dépendance à cette page) attend une map
   *  de noms sous cette forme pour son détail par chantier au survol d'une équipe. */
  const chantierNamesById = useMemo(() => Object.fromEntries(chantierNames), [chantierNames]);

  /** `Chantier.id` → `Chantier.axisIds` — round 24 : remplace l'ancien `ChantierStaffing.axisId`
   *  dénormalisé (supprimé) pour le mode "axis" de `StaffingPeriodBreakdown`, qui rejoint désormais
   *  chaque ligne de staffing à l'axe (ou aux axes) de son chantier via cette map plutôt que de lire
   *  un axe stocké directement sur la ligne. */
  const axisIdsByChantier = useMemo(
    () => Object.fromEntries(chantiers.map((c) => [c.id, c.axisIds])),
    [chantiers]
  );

  /** `ChantierAction.id` → nom, round 26 — colonne "Levier" de `StaffingDetailModal` (modale de
   *  détail exploitable ouverte depuis `StaffingPeriodBreakdown`, voir son doc-comment). */
  const actionNamesById = useMemo(
    () => Object.fromEntries(chantierActions.map((a) => [a.id, a.name])),
    [chantierActions]
  );

  /** Employés RÉELS (noms compris, `useCompanyDepartments`'s `employees`, jusqu'ici totalement
   *  ignorés par cette page qui n'en dérivait que `fteByDept`) derrière le disponible de l'équipe
   *  couramment ouverte (`availableTeam`) — TOUJOURS l'instantané complet d'aujourd'hui
   *  (`Employee` n'a pas de notion de période). */
  const availableDetailRows = useMemo(() => {
    if (!availableTeam) return [];
    return employees
      .filter((e) => e.department === availableTeam)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [availableTeam, employees]);

  const availableModalTitle = availableTeam
    ? t("effectifs.needVsAvailable.availableDetailTitle").replace("{team}", availableTeam)
    : "";

  // ── Budget FINANCIER alloué / consommé ─────────────────────────────────────────────────────
  // SEULE source : `rollupBudgets` (lib/budgetRollup.ts) — règle bottom-up projet → chantier →
  // axe → programme, identique à la puce "Budget alloué" du dashboard stratégique. Un chantier
  // multi-axe est attribué à son SEUL axe primaire (voir lib/budgetRollup.ts), donc la somme des
  // parts par axe (+ la part "sans axe" éventuelle) est EXACTEMENT le total programme affiché au
  // centre du donut. `Chantier.allocatedBudget`/`consumedBudget` (saisies manuelles) ne sont plus
  // lus ici.
  const budgetRollup = useMemo(
    () => rollupBudgets(axes, chantiers, chantierActions),
    [axes, chantiers, chantierActions]
  );
  const totalAllocatedBudget = budgetRollup.programme.allocated;
  const totalConsumedBudget = budgetRollup.programme.consumed;

  /** Parts du donut au niveau 1 (axes) : alloué ET consommé par axe d'attribution, plus une part
   *  "sans axe" si des chantiers n'ont aucun axe connu (pour que la somme des parts = le total). */
  const unifiedBudgetSlices: BudgetDonutSlice[] = useMemo(() => {
    const slices: BudgetDonutSlice[] = axes.map((axis) => {
      const figures = budgetRollup.axes.get(axis.id) ?? EMPTY_BUDGET;
      return { name: axis.name, value: figures.allocated, consumed: figures.consumed };
    });
    const orphan = budgetRollup.unattributed;
    if (orphan.allocated > 0 || orphan.consumed > 0) {
      slices.push({
        name: t("effectifs.moneyBudget.unattributedAxis", "Sans axe"),
        value: orphan.allocated,
        consumed: orphan.consumed,
      });
    }
    return slices;
  }, [axes, budgetRollup, t]);

  /** `BudgetDonutChart.onSliceClick` ne renvoie que le NOM de la part cliquée (contrat du
   *  composant, inchangé) — ce lookup retrouve l'axe correspondant, niveau 1 du drill-down. */
  const axisByName = useMemo(() => new Map(axes.map((a) => [a.name, a] as const)), [axes]);

  /** Axe/chantier actuellement ouverts dans le drill-down EN PLACE (round 26) — dérivés de
   *  `budgetDrillPath`, `null` tant que le niveau correspondant n'est pas atteint. */
  const budgetDrillAxisId = budgetDrillPath[0]?.id ?? null;
  const budgetDrillChantierId = budgetDrillPath[1]?.id ?? null;

  /** Chantiers ATTRIBUÉS (budgétairement) à l'axe ouvert — même règle d'attribution que le niveau
   *  axes, pour que la somme des parts chantier = la part de l'axe cliquée. */
  const drillAxisChantiers = useMemo(
    () =>
      budgetDrillAxisId
        ? chantiers.filter((c) => budgetRollup.chantierAxisId.get(c.id) === budgetDrillAxisId)
        : [],
    [budgetDrillAxisId, chantiers, budgetRollup]
  );

  /** Parts du donut pour le niveau COURANT du drill-down EN PLACE : axes, puis chantiers de l'axe
   *  ouvert, puis projets du chantier ouvert — alloué et consommé à chaque niveau, tous issus de
   *  `budgetRollup`. Les entités sans aucun montant (ni alloué ni consommé) sont omises. */
  const budgetDrillSlices: BudgetDonutSlice[] = useMemo(() => {
    const hasAmount = (f: { allocated: number; consumed: number }) =>
      f.allocated > 0 || f.consumed > 0;
    if (budgetDrillChantierId) {
      return chantierActions
        .filter((a) => a.chantierId === budgetDrillChantierId)
        .map((a) => ({ a, f: budgetRollup.projets.get(a.id) ?? EMPTY_BUDGET }))
        .filter(({ f }) => hasAmount(f))
        .map(({ a, f }) => ({ name: a.name, value: f.allocated, consumed: f.consumed }));
    }
    if (budgetDrillAxisId) {
      return drillAxisChantiers
        .map((c) => ({ c, f: budgetRollup.chantiers.get(c.id) ?? EMPTY_BUDGET }))
        .filter(({ f }) => hasAmount(f))
        .map(({ c, f }) => ({ name: c.name, value: f.allocated, consumed: f.consumed }));
    }
    return unifiedBudgetSlices;
  }, [
    budgetDrillChantierId,
    budgetDrillAxisId,
    chantierActions,
    drillAxisChantiers,
    budgetRollup,
    unifiedBudgetSlices,
  ]);

  /** Total alloué/consommé du niveau COURANT (centre du donut) : programme au niveau 1 (= puce
   *  "Budget alloué" du dashboard), puis axe ou chantier ouvert. */
  const budgetDrillTotals =
    budgetDrillChantierId !== null
      ? (budgetRollup.chantiers.get(budgetDrillChantierId) ?? EMPTY_BUDGET)
      : budgetDrillAxisId !== null
        ? (budgetRollup.axes.get(budgetDrillAxisId) ?? EMPTY_BUDGET)
        : budgetRollup.programme;

  /** `BudgetDonutChart.onSliceClick` du niveau CHANTIER (un axe est sélectionné, niveau projet pas
   *  encore atteint) ne renvoie lui aussi que le NOM de la part cliquée — ce lookup, restreint aux
   *  chantiers de l'axe ouvert, retrouve l'`id` du chantier pour pousser l'entrée suivante du
   *  chemin de drill-down (round 14, porté round 26). */
  const drilldownChantierByName = useMemo(() => {
    if (!budgetDrillAxisId || budgetDrillChantierId) return new Map<string, string>();
    return new Map(drillAxisChantiers.map((c) => [c.name, c.id] as const));
  }, [budgetDrillAxisId, budgetDrillChantierId, drillAxisChantiers]);

  /** `BudgetDonutChart.onSliceClick` du niveau PROJET (un chantier est sélectionné) — retrouve
   *  l'id du projet (`ChantierAction`, alias « levier ») cliqué pour naviguer vers sa fiche. Round
   *  26 : même mécanisme `?chantier=&action=` que `StrategicAxesView.openChantierPanel`/
   *  `StrategicDashboardView.openChantierPanel` (recherché et réutilisé tel quel, cette page n'a
   *  pas son propre panneau chantier) — déclenché ici vers `/levers`, comme le faisait déjà le
   *  clic chantier de round 14 ci-dessous. */
  const drilldownProjetByName = useMemo(() => {
    if (!budgetDrillChantierId) return new Map<string, string>();
    return new Map(
      chantierActions
        .filter((a) => a.chantierId === budgetDrillChantierId)
        .map((a) => [a.name, a.id] as const)
    );
  }, [budgetDrillChantierId, chantierActions]);

  // Bouton d'import Excel + lien base ETP : rendus directement dans l'en-tête (réutilisé par
  // toutes les branches de retour ci-dessous) plutôt que dans une variable de toolbar séparée.
  // L'import n'apparaît que lorsque `chantiers`/`chantierActions`/`staffing` sont effectivement
  // disponibles (programme actif de type stratégique) ; le lien base ETP, lui, ne dépend d'aucun
  // programme (round 13 — la base ETP est scopée entreprise, pas programme).
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Users size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">{t("effectifs.title")}</h1>
        {activeProgram && <span className="text-sm text-text-secondary">{activeProgram.name}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/hr/etp"
          className="flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-primary transition hover:border-black"
        >
          {t("effectifs.viewBaseEtp")} <ArrowUpRight size={13} />
        </Link>
        {activeProgram && programType === "strategic" && (
          <StaffingImportButton
            companyId={user?.companyId}
            programId={activeProgramId}
            chantiers={chantiers}
            chantierActions={chantierActions}
            staffing={staffing}
            knownDepartments={Object.keys(fteByDept)}
            onImport={async (entries) => {
              for (const entry of entries) await saveChantierStaffing(entry);
            }}
          />
        )}
      </div>
    </div>
  );

  if (roleLoading || programLoading || dataLoading || departmentsLoading) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("effectifs.loading")}</p>
      </div>
    );
  }

  if (!activeProgram) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("effectifs.noProgram")}</p>
      </div>
    );
  }

  // Atteinte directe par URL alors que le programme actif est un Plan Performance : la nav ne
  // propose pas cette route dans ce cas, on explique plutôt que d'afficher une page vide.
  if (programType !== "strategic") {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("effectifs.notStrategic")}</p>
      </div>
    );
  }

  // Section budget FINANCIER : même scope PROGRAMME que la section besoin/disponible ci-dessous,
  // mais purement monétaire — rendue AVANT elle (demande PO : le lecteur voit d'abord l'argent,
  // puis le détail ETP), dans les deux branches de retour (staffing vide ou non).
  const formatAllocatedBudget = (value: number) =>
    `${value.toLocaleString()} ${activeProgram.currency}`;
  // Round 14 (PO) : la tuile `KPICard` "Budget total alloué" (simple somme) était redondante avec
  // le total désormais affiché au centre du donut lui-même (round 13) — retirée, le donut seul
  // porte maintenant à la fois la répartition ET le total.
  //
  // Round 16 (PO : "trois éléments visuels séparés pour la même info, c'est répétitif") : la barre
  // `BudgetVsActualBar` programme (consommé vs alloué total) et la liste d'une `BudgetVsActualBar`
  // par axe ont été retirées — le SEUL `BudgetDonutChart` ci-dessous porte maintenant la
  // répartition par axe ET le consommé (anneau intérieur `showConsumedRing`, alimenté par
  // `unifiedBudgetSlices`), avec le même comportement de clic (`onSliceClick`) qu'avant.
  //
  // Round 26 : drill-down EN PLACE à 3 niveaux (axe → chantier → projet), même patron que
  // `CostByHierarchyChart` (module Finance) — remplace le drill-down par MODALE de round 13/25
  // (`budgetDrilldownModal`, retiré). `showConsumedRing`/`total`/`consumedTotal` restent réservés
  // au niveau 1 (axes) : les niveaux chantier/projet reprennent le rendu simple (pas d'anneau
  // consommé) qu'avait déjà la modale de round 13 pour ces mêmes données — aucune information
  // perdue, le bouton retour du `CardHeader` affiche en plus le nom de l'entité qu'on quitte
  // (round 13 l'affichait déjà en tête de la modale via `budgetDrilldownAxis.name`).
  const moneyBudgetSection = (
    <Card className="mb-0">
      <CardHeader
        title={t("effectifs.moneyBudget.title")}
        actions={
          budgetDrillPath.length > 0 ? (
            <button
              type="button"
              onClick={() => setBudgetDrillPath((p) => p.slice(0, -1))}
              className="flex items-center gap-1 text-[11px] font-semibold text-secondary hover:text-primary"
            >
              <ChevronLeft size={14} />
              {budgetDrillPath[budgetDrillPath.length - 1]?.label}
            </button>
          ) : undefined
        }
      />
      <CardBody>
        {totalAllocatedBudget === 0 && totalConsumedBudget === 0 ? (
          <p className="text-sm text-text-secondary">{t("effectifs.moneyBudget.empty")}</p>
        ) : (
          <div>
            <BudgetDrillBreadcrumb currentIndex={budgetDrillPath.length} />
            {budgetDrillSlices.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-tertiary">
                {budgetDrillPath.length >= 2
                  ? t("effectifs.moneyBudget.byProjetEmpty")
                  : t("effectifs.moneyBudget.byChantierEmpty")}
              </p>
            ) : (
              <BudgetDonutChart
                data={budgetDrillSlices}
                formatValue={formatAllocatedBudget}
                // Donut principal de la carte : grande taille (jusqu'à 300px, réduite à la largeur
                // réelle de la carte), montants COMPACTS au centre (ex. "7,7 M €") — les montants
                // complets restent dans la légende et le tooltip.
                size="lg"
                formatCenterValue={(value) =>
                  formatCompactCurrency(value, activeProgram.currency, locale)
                }
                // Niveau 1 : le centre se lit "7,7 M € / sur 23,6 M € alloués / 33 % consommé" —
                // plus de libellé "CONSOMMÉ / ALLOUÉ" en capitales, redondant avec ces lignes.
                // Centre en mode consommé/alloué/% à tous les niveaux : plus de libellé "Total".
                centerTotalLabel={(formattedTotal) =>
                  t("effectifs.moneyBudget.centerOfTotal", "sur {total} alloués").replace(
                    "{total}",
                    formattedTotal
                  )
                }
                centerConsumedPctLabel={(ratio) =>
                  t("effectifs.moneyBudget.centerConsumedPct", "{pct} consommé").replace(
                    "{pct}",
                    formatPercent(ratio, locale)
                  )
                }
                // Anneau extérieur "consommé PAR PART" à TOUS les niveaux (axe, chantier, projet).
                showConsumedRing
                consumedLabel={t("effectifs.moneyBudget.consumedTooltipSuffix")}
                allocatedLabel={t("effectifs.moneyBudget.tooltipAllocated", "Alloué")}
                remainingLabel={t("effectifs.moneyBudget.tooltipRemaining", "Restant")}
                overrunLabel={t("effectifs.moneyBudget.tooltipOverrun", "Dépassement")}
                consumedRingHint={t(
                  "effectifs.moneyBudget.consumedRingHint",
                  "Anneau noir extérieur = budget consommé de chaque élément"
                )}
                // Total/consommé du centre issus de `rollupBudgets` (niveau 1 = total programme,
                // identique à la puce "Budget alloué" du dashboard ; sinon axe/chantier ouvert).
                total={budgetDrillTotals.allocated}
                consumedTotal={budgetDrillTotals.consumed}
                onSliceClick={(name) => {
                  // Niveau 3 (un chantier est déjà ouvert) : la part cliquée est un PROJET — navigue
                  // vers sa fiche (round 14, porté round 26) plutôt que de pousser un 4e niveau.
                  if (budgetDrillChantierId) {
                    const actionId = drilldownProjetByName.get(name);
                    if (actionId) {
                      router.push(`/levers?chantier=${budgetDrillChantierId}&action=${actionId}`);
                    }
                    return;
                  }
                  // Niveau 2 (un axe est déjà ouvert) : la part cliquée est un CHANTIER — descend au
                  // niveau projet (round 13, désormais EN PLACE plutôt que dans une modale).
                  if (budgetDrillAxisId) {
                    const chantierId = drilldownChantierByName.get(name);
                    if (chantierId) {
                      setBudgetDrillPath((p) => [...p, { id: chantierId, label: name }]);
                    }
                    return;
                  }
                  // Niveau 1 (aucun axe ouvert) : la part cliquée est un AXE — descend au niveau
                  // chantier.
                  const axis = axisByName.get(name);
                  if (axis) setBudgetDrillPath([{ id: axis.id, label: axis.name }]);
                }}
              />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );

  // Section mobilisé vs disponible : indépendante de la présence de lignes de staffing (une équipe
  // de la base ETP peut être 100% disponible et n'apparaître ici que pour ça) — construite une
  // seule fois et rendue dans les deux branches ci-dessous (staffing vide ou non), avec la modale
  // « employés disponibles » ouverte au clic sur une équipe de la heatmap.
  const needVsAvailableSection = (
    <>
      <StaffingRateSection
        staffing={staffing}
        axes={axes}
        axisIdsByChantier={axisIdsByChantier}
        fteByDept={fteByDept}
        chantierNamesById={chantierNamesById}
        actionNamesById={actionNamesById}
        onTeamClick={setAvailableTeam}
      />

      {/* Détail "disponible" (round <n>) — modale LOCALE dédiée (pas `StaffingDetailModal`, dont la
          forme de ligne ne colle pas à `Employee`, voir le doc-comment d'`availableDetailRows`) :
          vrai tableau HTML des employés RÉELS de l'équipe cliquée, même parti pris que
          `StaffingDetailModal` (texte nativement sélectionnable plutôt qu'un panneau en prose). */}
      <Modal
        open={availableTeam !== null}
        onOpenChange={(open) => {
          if (!open) setAvailableTeam(null);
        }}
        title={availableModalTitle}
        maxWidth="640px"
      >
        {availableDetailRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-tertiary">
            {t("effectifs.needVsAvailable.availableDetailEmpty")}
          </p>
        ) : (
          <div>
            <p className="mb-3 text-[12px] text-tertiary">
              {t("staffing.total")} :{" "}
              <strong className="text-primary">
                {formatFte(availableDetailRows.reduce((sum, e) => sum + (e.fte || 0), 0))}{" "}
                {t("staffing.fteUnit")}
              </strong>
              {" · "}
              {t("effectifs.needVsAvailable.rowsCount").replace(
                "{n}",
                String(availableDetailRows.length)
              )}
            </p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[520px] text-left text-[12px]">
                <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-secondary">
                  <tr>
                    <th className="px-3 py-2">{t("effectifs.needVsAvailable.columnName")}</th>
                    <th className="px-3 py-2">{t("effectifs.needVsAvailable.columnFunction")}</th>
                    <th className="px-3 py-2">{t("effectifs.needVsAvailable.columnTeam")}</th>
                    <th className="px-3 py-2 text-right">{t("etp.column.fte")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {availableDetailRows.map((emp) => (
                    <tr key={emp.id} className="text-primary">
                      <td className="px-3 py-2 font-medium">{emp.name}</td>
                      <td className="px-3 py-2 text-tertiary">{emp.func}</td>
                      <td className="px-3 py-2 text-tertiary">{emp.team}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatFte(emp.fte)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </>
  );

  if (staffing.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <p className="max-w-3xl text-sm text-text-secondary">{t("effectifs.subtitle")}</p>
        {moneyBudgetSection}
        {needVsAvailableSection}
        <Card>
          <CardBody>
            <p className="text-sm text-text-secondary">{t("effectifs.empty")}</p>
            <p className="mt-1 text-xs text-tertiary">{t("effectifs.emptyHint")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <p className="max-w-3xl text-sm text-text-secondary">{t("effectifs.subtitle")}</p>
      {moneyBudgetSection}
      {needVsAvailableSection}

      {/* ── 1. Répartition des ETP, par période ET par axe (round 7, fusionné round 22 — voir le
          doc-comment de `StaffingPeriodBreakdown.tsx` : le composant porte désormais lui-même tout
          le cross-filtering équipe/chantier/période qui vivait auparavant sur cette page, ainsi que
          l'ex-carte "Répartition par axe" retirée d'ici). ─────────────────────────────────────── */}
      <StaffingPeriodBreakdown
        staffing={staffing}
        fteByDept={fteByDept}
        axes={axes}
        chantierNamesById={chantierNamesById}
        axisIdsByChantier={axisIdsByChantier}
        actionNamesById={actionNamesById}
      />
    </div>
  );
}
