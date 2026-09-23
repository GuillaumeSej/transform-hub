"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronLeft, ChevronRight, Users } from "lucide-react";
import {
  Bar as RBar,
  BarChart as RBarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import {
  BudgetDonutChart,
  type BudgetDonutSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { Modal } from "@/components/shared/Modal";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import {
  StaffingDetailModal,
  type StaffingDetailRow,
} from "@/components/strategic/StaffingDetailModal";
import { StaffingImportButton } from "@/components/strategic/StaffingImportButton";
import { StaffingPeriodBreakdown } from "@/components/strategic/StaffingPeriodBreakdown";
import { colorForDepartment } from "@/lib/axisLogic";
import { needMetrics, needSeries, periodBoundsForDate, todayIso } from "@/lib/staffingNeed";
import { saveChantierStaffing } from "@/lib/firestore/chantierStaffing";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatCompactCurrency, formatPercent } from "@/lib/formatCompactAmount";
import type { ChantierStaffing } from "@/types";

/**
 * Page « Effectifs mobilisés » — lecture transverse du staffing saisi chantier par chantier
 * (`ChantierStaffingEditor`, dans la pop-up de détail d'un chantier), ou importé en lot via
 * `StaffingImportButton` (round 7). Trois niveaux de lecture, dans l'ordre demandé par le PO :
 *
 *  0. BESOIN vs DISPONIBLE (round 13, nouveau) : pour chaque équipe (= `Employee.department` de la
 *     base ETP entreprise, Plan Performance), le volume d'ETP demandé par le Plan Stratégique
 *     (`ChantierStaffing.fte`, sommé) comparé au volume RÉELLEMENT disponible dans cette équipe
 *     (`Employee.fte`, sommé — `useCompanyDepartments`, live). Remplace l'ancienne section
 *     « Budget d'ETP par fonction », où le "disponible" était un chiffre saisi à la main
 *     (`Program.staffingBudgets`, retiré) plutôt que la réalité de la base ETP.
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
 * Comparaison PAR ÉQUIPE (round <n>, remplace l'ancienne barre CSS à ratio unique) : un
 * `BarChart` recharts partagé par toutes les équipes, deux groupes de barres par équipe —
 * `disponible` (seule, à gauche) puis un EMPILEMENT `mobilisé` + `écart au besoin déclaré` (une
 * seule colonne, à droite) — voir `needVsAvailableChartData` plus bas. L'écart mobilisé/déclaré
 * devient ainsi un segment visuellement DISTINCT plutôt qu'un pourcentage à calculer mentalement
 * entre deux barres séparées (demande PO : « je veux voir l'écart directement »). Couleurs
 * SÉMANTIQUES fixes (mêmes teintes que le graphique « Évolution par période » ci-dessus) plutôt
 * que la couleur PROPRE à chaque équipe qu'utilisait l'ancienne barre CSS (`colorForDepartment`) :
 * comparer un même segment (l'écart, en particulier) d'une équipe à l'autre exige une teinte
 * commune, l'identité de l'équipe restant portée par le point de couleur + le libellé dans la
 * liste texte ci-dessous, inchangée.
 *
 * Rien à voir avec les écrans RH du Plan Performance eux-mêmes : `Chantier`/`ChantierStaffing`
 * n'existent que côté stratégique, et la route est fermée aux programmes Performance (voir la
 * garde `programType` en bas de fichier + `programTypes: ["strategic"]` dans `lib/nav-config.ts`).
 * Seule la base ETP (`Employee`, via `useCompanyDepartments`) est PARTAGÉE entre les deux plans.
 */

/** Granularité du sélecteur de période du widget besoin/disponible ci-dessous — round <n>. Même
 *  triplet trimestre/semestre/année que `StaffingPeriodBreakdown.tsx` (`Granularity`, non exporté),
 *  réutilisé ici avec les MÊMES clés i18n (`staffingPeriod.granularity.*`) pour rester visuellement
 *  et sémantiquement cohérent avec l'autre sélecteur de granularité de cette même page. */
type NeedPeriodGranularity = "quarterly" | "semiannual" | "annual";

/** Une ligne de staffing est comptée sur la période courante si sa plage `startDate`/`endDate`
 *  RECOUPE (et pas seulement "démarre dans") les bornes de cette période. Une ligne sans `endDate`
 *  connue est considérée toujours en cours (voir `types/index.ts`, doc-comment de
 *  `ChantierStaffing.endDate` : "optionnelle même quand `startDate` est renseignée, staffing sans
 *  échéance connue"). Une ligne sans `startDate` (« non daté ») est exclue — même convention que
 *  `staffingPeriodBuckets`/`periodLabelForDate` : « compté dans les totaux globaux [existants, hors
 *  de ce widget] mais ignoré par toute vue PAR PÉRIODE ». */
function overlapsPeriod(entry: ChantierStaffing, period: { start: string; end: string }): boolean {
  if (!entry.startDate) return false;
  const entryEnd = entry.endDate ?? "9999-12-31";
  return entry.startDate <= period.end && entryEnd >= period.start;
}

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

  /** Sélecteur de période du widget besoin/disponible (round <n>) — voir `periodBoundsForDate` (lib/staffingNeed.ts)
   *  ci-dessus. Par défaut le trimestre courant, cohérent avec le défaut de
   *  `StaffingPeriodBreakdown.tsx` (`granularity` initialisée à `"quarterly"`). État PUREMENT LOCAL
   *  à ce widget (comme `mode`/`granularity` de `StaffingPeriodBreakdown`) : rien d'autre sur cette
   *  page n'en dépend. */
  const [needPeriodGranularity, setNeedPeriodGranularity] =
    useState<NeedPeriodGranularity>("quarterly");
  const today = useMemo(() => todayIso(new Date()), []);
  const needPeriod = useMemo(
    () => periodBoundsForDate(today, needPeriodGranularity),
    [today, needPeriodGranularity]
  );

  /** Lignes de staffing dont la plage `startDate`/`endDate` recoupe la période courante
   *  (`needPeriod`, voir `overlapsPeriod` ci-dessus) — remplace round <n> l'ancien calcul TOUT-TEMPS
   *  (ancien total tout-temps, tuile désormais fusionnée dans ce bloc) pour le côté "besoin" du widget
   *  besoin/disponible SEUL. */
  const staffingInNeedPeriod = useMemo(
    () => staffing.filter((entry) => overlapsPeriod(entry, needPeriod)),
    [staffing, needPeriod]
  );
  /** ETP MOYENS (pondérés par la durée de recoupement) par équipe sur la période courante. */
  const needTotalsByFunction = useMemo(() => {
    const fns = new Set(staffingInNeedPeriod.map((e) => e.function));
    return Array.from(fns).map((fn) => {
      const m = needMetrics(
        staffingInNeedPeriod.filter((e) => e.function === fn),
        0,
        needPeriod,
        today
      );
      return { fn, fte: m.needed, mobilised: m.mobilised };
    });
  }, [staffingInNeedPeriod, needPeriod, today]);
  const totalAvailableFte = useMemo(
    () => Object.values(fteByDept).reduce((sum, v) => sum + v, 0),
    [fteByDept]
  );
  /** Série par période (même granularité) : besoin, disponible, mobilisé, % de staffing. */
  const needSeriesData = useMemo(
    () => needSeries(staffing, totalAvailableFte, needPeriodGranularity, today),
    [staffing, totalAvailableFte, needPeriodGranularity, today]
  );
  /** Données du graphique besoin/disponible/mobilisé — mémoïsées (auparavant un `.map` inline
   *  dans le JSX) : un tableau recréé à chaque rendu relançait l'animation d'entrée Recharts
   *  (barres + points de la courbe) dès que la page se re-rendait, ex. pendant un survol. */
  const needSeriesChartData = useMemo(
    () =>
      needSeriesData.map((m) => ({
        period: m.label,
        needed: Number(m.needed.toFixed(2)),
        available: Number(m.available.toFixed(2)),
        mobilised: Number(m.mobilised.toFixed(2)),
        staffingPct: m.staffingPct,
      })),
    [needSeriesData]
  );
  const needTotalMetrics = useMemo(
    () => needMetrics(staffingInNeedPeriod, totalAvailableFte, needPeriod, today),
    [staffingInNeedPeriod, totalAvailableFte, needPeriod, today]
  );

  /** Besoin (staffing déclaré, filtré sur `needPeriod` ci-dessus) vs disponible (base ETP réelle,
   *  TOUJOURS "aujourd'hui" — `Employee` n'a structurellement aucune dimension temporelle, voir
   *  `useCompanyDepartments`) par équipe — round 13, remplace la section « Budget d'ETP par
   *  fonction » ; round <n> : le côté besoin devient filtré par période plutôt que cumulatif
   *  tout-temps (l'ancien calcul mélangeait un besoin toutes périodes confondues avec un disponible
   *  instantané, un pourcentage sans grand sens). Une équipe apparaît dès qu'elle a du besoin sur
   *  CETTE période OU du disponible (une équipe entièrement dispo mais non staffée sur la période
   *  reste visible : "cette équipe n'est staffée sur aucun chantier du plan pour cette période").
   *  Triée par besoin décroissant. */
  const needVsAvailable = useMemo(() => {
    const names = new Set<string>([
      ...needTotalsByFunction.map((row) => row.fn),
      ...Object.keys(fteByDept),
    ]);
    return Array.from(names)
      .map((fn) => ({
        fn,
        needed: needTotalsByFunction.find((row) => row.fn === fn)?.fte ?? 0,
        mobilised: needTotalsByFunction.find((row) => row.fn === fn)?.mobilised ?? 0,
        available: fteByDept[fn] ?? 0,
      }))
      .sort((a, b) => b.needed - a.needed);
  }, [needTotalsByFunction, fteByDept]);

  /** Projection de `needVsAvailable` pour le `BarChart` comparatif par équipe (round <n>) —
   *  `mobilisedBase` vaut TOUJOURS `mobilised` (mobilisé est structurellement un sous-ensemble du
   *  besoin déclaré, voir `needMetrics` dans lib/staffingNeed.ts : mêmes lignes, filtrées en plus
   *  sur `startDate <= today` — jamais mobilisé > déclaré en usage normal, `Math.min` par
   *  sécurité), `gapToDeclared` le reste jusqu'au besoin déclaré total. Empilées (`stackId`), ces
   *  deux valeurs forment UNE colonne dont la hauteur totale vaut le besoin déclaré, avec le
   *  segment mobilisé et l'écart visuellement distincts — voir le doc-comment de tête de fichier. */
  const needVsAvailableChartData = useMemo(
    () =>
      needVsAvailable.map(({ fn, needed, mobilised, available }) => ({
        fn,
        available,
        mobilisedBase: Math.min(mobilised, needed),
        gapToDeclared: Math.max(needed - mobilised, 0),
      })),
    [needVsAvailable]
  );

  /** Détail « exploitable » ouvert par clic sur le besoin OU le disponible d'une équipe (round <n>,
   *  même esprit que `StaffingPeriodBreakdown.detailScope`) — `null` = aucune modale ouverte.
   *  "need" ouvre `StaffingDetailModal` (lignes `ChantierStaffing` brutes, même composant/forme que
   *  `StaffingPeriodBreakdown.tsx`) ; "available" ouvre une modale locale dédiée (le composant
   *  partagé `StaffingDetailModal` est typé pour des lignes `ChantierStaffing`, pas pour des
   *  `Employee` — forme différente, voir son doc-comment). */
  const [needDetailScope, setNeedDetailScope] = useState<
    { kind: "need"; fn: string } | { kind: "available"; fn: string } | null
  >(null);

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

  /** `StrategicAxis.id` → nom — pour la colonne "Axe(s)" des lignes de `StaffingDetailModal`
   *  ci-dessous, même besoin que `axisNamesForChantier` de `StaffingPeriodBreakdown.tsx` (non
   *  exportée, donc reconstruite localement ici avec le même résultat). */
  const axisNameById = useMemo(() => new Map(axes.map((a) => [a.id, a.name])), [axes]);

  /** Lignes `ChantierStaffing` BRUTES derrière le besoin de l'équipe couramment ouverte
   *  (`needDetailScope.kind === "need"`), restreintes à `staffingInNeedPeriod` (même période que le
   *  chiffre cliqué) — alimente `StaffingDetailModal`, même forme de ligne que
   *  `StaffingPeriodBreakdown.detailRows`. Libellé de la modale volontairement honnête (« lignes de
   *  besoin déclaré », jamais « personnes ») : `ChantierStaffing` n'a pas de champ nom structuré,
   *  seulement `note`, un texte libre qui PEUT contenir un nom sans que ce soit garanti — voir la
   *  colonne "Précision" déjà affichée telle quelle par `StaffingDetailModal`. */
  const needDetailRows: StaffingDetailRow[] = useMemo(() => {
    if (!needDetailScope || needDetailScope.kind !== "need") return [];
    return staffingInNeedPeriod
      .filter((e) => e.function === needDetailScope.fn)
      .map((e) => ({
        id: e.id,
        chantierName: chantierNames.get(e.chantierId) ?? t("effectifs.chantierUnknown"),
        function: e.function,
        axisNames:
          (axisIdsByChantier[e.chantierId] ?? [])
            .map((id) => axisNameById.get(id) ?? t("effectifs.axisUnknown"))
            .join(", ") || "—",
        fte: e.fte || 0,
        periodLabel: e.startDate
          ? `${e.startDate} → ${e.endDate ?? "…"}`
          : t("staffingPeriod.detailModal.undated"),
        lever: e.actionId ? (actionNamesById[e.actionId] ?? "—") : "—",
        note: e.note ?? "—",
      }))
      .sort((a, b) => b.fte - a.fte);
  }, [
    needDetailScope,
    staffingInNeedPeriod,
    chantierNames,
    axisIdsByChantier,
    axisNameById,
    actionNamesById,
    t,
  ]);
  const needDetailTotalFte = useMemo(
    () => needDetailRows.reduce((sum, row) => sum + row.fte, 0),
    [needDetailRows]
  );

  /** Employés RÉELS (noms compris, `useCompanyDepartments`'s `employees`, jusqu'ici totalement
   *  ignorés par cette page qui n'en dérivait que `fteByDept`) derrière le disponible de l'équipe
   *  couramment ouverte (`needDetailScope.kind === "available"`) — TOUJOURS l'instantané complet
   *  d'aujourd'hui (`Employee` n'a pas de notion de période), jamais restreint à `needPeriod`. */
  const availableDetailRows = useMemo(() => {
    if (!needDetailScope || needDetailScope.kind !== "available") return [];
    return employees
      .filter((e) => e.department === needDetailScope.fn)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [needDetailScope, employees]);

  const needDetailModalTitle = !needDetailScope
    ? ""
    : needDetailScope.kind === "need"
      ? t("effectifs.needVsAvailable.needDetailTitle").replace("{team}", needDetailScope.fn)
      : t("effectifs.needVsAvailable.availableDetailTitle").replace("{team}", needDetailScope.fn);

  // ── Budget FINANCIER alloué (round 12) ─────────────────────────────────────────────────────
  // Nouvelle section monétaire, distincte du besoin/disponible ETP ci-dessus (une question de €,
  // pas d'ETP) : total du budget alloué (`Chantier.allocatedBudget`, round 7) sur tout le
  // programme, même calcul que la puce du dashboard stratégique (`StrategicDashboardView`).
  // Round 16 : la ventilation PAR AXE (ex-`allocatedBudgetByAxis`) est désormais construite plus
  // bas, fusionnée avec le consommé — voir `unifiedBudgetSlices`.
  const totalAllocatedBudget = useMemo(
    () => chantiers.reduce((sum, c) => sum + (c.allocatedBudget ?? 0), 0),
    [chantiers]
  );

  // ── Budget FINANCIER consommé (round 15, fusionné round 16) ────────────────────────────────
  // Le total consommé programme n'est plus recalculé séparément ici : depuis round 16, `data[].consumed`
  // par axe (`budgetByAxisWithConsumed` ci-dessous, réinjecté dans `unifiedBudgetSlices`) alimente
  // directement l'anneau "consommé" du donut unifié, qui somme lui-même son propre total affiché au
  // centre — plus besoin d'un `totalConsumedBudget` séparé au niveau de cette page.
  //
  // PAS d'équivalent ETP (`Chantier.consumedFte`) ajouté sur cette page : le seul total ETP déjà
  // affiché ici (`totalFte`, tuile "ETP mobilisés au total") somme le BESOIN déclaré par équipe
  // (`ChantierStaffing.fte`), pas un objectif d'ETP par chantier — `Chantier.consumedFte` est
  // explicitement documenté (`types/index.ts`) comme une valeur globale déclarative DISTINCTE de ce
  // besoin, sans compteur "planifié" comparable sur `Chantier`. Les comparer produirait un
  // rapprochement trompeur (deux notions différentes), donc volontairement omis ici.

  /** Alloué ET consommé, par axe — même découpage (`axes.map` + filtre par `axisIds`) que
   *  l'ex-`allocatedBudgetByAxis` (round 12, retiré round 16), mais regroupés ensemble : round 12
   *  s'en servait pour une `BudgetVsActualBar` par axe séparée, round 16 le réutilise directement
   *  ci-dessous pour alimenter l'anneau "consommé" du donut unifié.
   *
   *  Round 24 : un chantier peut désormais appartenir à PLUSIEURS axes — décision produit assumée
   *  (visibilité complète par axe) : son `allocatedBudget`/`consumedBudget` COMPLET est compté sous
   *  CHAQUE axe auquel il appartient (pas de répartition au prorata), donc la somme de ces lignes
   *  par axe peut désormais dépasser le vrai total programme — voir `totalAllocatedBudget`/
   *  `totalConsumedBudgetDeduped` ci-dessous pour le total PROGRAMME, qui lui compte chaque
   *  chantier une seule fois. */
  const budgetByAxisWithConsumed = useMemo(
    () =>
      axes.map((axis) => {
        const own = chantiers.filter((c) => c.axisIds.includes(axis.id));
        return {
          id: axis.id,
          name: axis.name,
          allocated: own.reduce((sum, c) => sum + (c.allocatedBudget ?? 0), 0),
          consumed: own.reduce((sum, c) => sum + (c.consumedBudget ?? 0), 0),
        };
      }),
    [axes, chantiers]
  );

  /** Total CONSOMMÉ programme, dédupliqué — pendant de `totalAllocatedBudget` ci-dessus (déjà
   *  correctement dédupliqué : il itère `chantiers`, la liste à plat, une fois chacun) mais pour le
   *  consommé, round 24 : nécessaire pour l'overlay central du donut unifié ci-dessous, qui ne peut
   *  plus dériver son total consommé de la somme des parts par axe (`unifiedBudgetSlices`) depuis
   *  qu'un chantier multi-axe y apparaît dans plusieurs parts à la fois (voir le commentaire de
   *  `budgetByAxisWithConsumed`). */
  const totalConsumedBudgetDeduped = useMemo(
    () => chantiers.reduce((sum, c) => sum + (c.consumedBudget ?? 0), 0),
    [chantiers]
  );

  /** Round 16 (PO : fusion de la carte "Budget financier alloué" en un seul graphique) — parts du
   *  donut UNIFIÉ par axe, alimentant à la fois l'anneau extérieur (répartition, `value`) et
   *  l'anneau intérieur "consommé" (`showConsumedRing`) de `BudgetDonutChart`. Même découpage/ordre
   *  d'axes que `budgetByAxisWithConsumed` ci-dessus, dont ce memo est une simple projection. */
  const unifiedBudgetSlices: BudgetDonutSlice[] = useMemo(
    () =>
      budgetByAxisWithConsumed.map((row) => ({
        name: row.name,
        value: row.allocated,
        consumed: row.consumed,
      })),
    [budgetByAxisWithConsumed]
  );

  /** `BudgetDonutChart.onSliceClick` ne renvoie que le NOM de la part cliquée (contrat du
   *  composant, inchangé) — ce lookup retrouve l'axe correspondant, niveau 1 du drill-down. */
  const axisByName = useMemo(() => new Map(axes.map((a) => [a.name, a] as const)), [axes]);

  /** Axe/chantier actuellement ouverts dans le drill-down EN PLACE (round 26) — dérivés de
   *  `budgetDrillPath`, `null` tant que le niveau correspondant n'est pas atteint. */
  const budgetDrillAxisId = budgetDrillPath[0]?.id ?? null;
  const budgetDrillChantierId = budgetDrillPath[1]?.id ?? null;

  /** Round 26 : parts du donut UNIFIÉ pour le niveau COURANT du drill-down EN PLACE — le même
   *  donut redessine tour à tour les axes (`unifiedBudgetSlices`, niveau 1, ci-dessus), les
   *  chantiers de l'axe ouvert, puis les projets (`ChantierAction`, alias « levier ») du chantier
   *  ouvert. Même convention d'exclusion des entités sans budget renseigné que round 13
   *  (`budgetDrilldownSlices`, retiré). */
  const budgetDrillSlices: BudgetDonutSlice[] = useMemo(() => {
    if (budgetDrillChantierId) {
      return chantierActions
        .filter((a) => a.chantierId === budgetDrillChantierId && a.budget !== undefined)
        .map((a) => ({ name: a.name, value: a.budget ?? 0 }));
    }
    if (budgetDrillAxisId) {
      return chantiers
        .filter((c) => c.axisIds.includes(budgetDrillAxisId) && c.allocatedBudget !== undefined)
        .map((c) => ({ name: c.name, value: c.allocatedBudget ?? 0 }));
    }
    return unifiedBudgetSlices;
  }, [budgetDrillChantierId, budgetDrillAxisId, chantierActions, chantiers, unifiedBudgetSlices]);

  /** `BudgetDonutChart.onSliceClick` du niveau CHANTIER (un axe est sélectionné, niveau projet pas
   *  encore atteint) ne renvoie lui aussi que le NOM de la part cliquée — ce lookup, restreint aux
   *  chantiers de l'axe ouvert, retrouve l'`id` du chantier pour pousser l'entrée suivante du
   *  chemin de drill-down (round 14, porté round 26). */
  const drilldownChantierByName = useMemo(() => {
    if (!budgetDrillAxisId || budgetDrillChantierId) return new Map<string, string>();
    return new Map(
      chantiers
        .filter((c) => c.axisIds.includes(budgetDrillAxisId))
        .map((c) => [c.name, c.id] as const)
    );
  }, [budgetDrillAxisId, budgetDrillChantierId, chantiers]);

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
        {totalAllocatedBudget === 0 ? (
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
                centerLabel={
                  budgetDrillPath.length === 0 ? undefined : t("effectifs.moneyBudget.centerLabel")
                }
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
                showConsumedRing={budgetDrillPath.length === 0}
                consumedLabel={t("effectifs.moneyBudget.consumedTooltipSuffix")}
                // Round 24 : `unifiedBudgetSlices` compte un chantier multi-axe une fois PAR axe
                // auquel il appartient (voir `budgetByAxisWithConsumed`) — le total/consommé affiché
                // au centre doit rester le vrai total PROGRAMME (chaque chantier une seule fois),
                // donc calculé séparément ici plutôt que dérivé de `data.reduce(...)`. Uniquement au
                // niveau 1 (axes) : `BudgetDonutChart` retombe sur `data.reduce(...)` sinon, correct
                // pour les niveaux chantier/projet (pas de double-comptage à ces niveaux).
                total={budgetDrillPath.length === 0 ? totalAllocatedBudget : undefined}
                consumedTotal={
                  budgetDrillPath.length === 0 ? totalConsumedBudgetDeduped : undefined
                }
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

  // Section besoin vs disponible : indépendante de la présence de lignes de staffing (une équipe
  // de la base ETP peut être 100% disponible et n'apparaître ici que pour ça) — construite une
  // seule fois et rendue dans les deux branches ci-dessous (staffing vide ou non). Round <n> :
  // sélecteur de période (besoin uniquement, voir `periodBoundsForDate` (lib/staffingNeed.ts)/`needPeriod` ci-dessus) +
  // les deux chiffres deviennent cliquables (`needDetailScope`), plus les deux modales de détail
  // qui vont avec — embarquées ICI, dans le même JSX partagé par les deux branches de retour
  // ci-dessous, plutôt qu'au niveau racine du composant (une seule des deux branches s'exécute par
  // rendu, mais les modales doivent rester disponibles quelle que soit celle qui rend).
  const needVsAvailableSection = (
    <>
      <Card className="mb-0">
        <CardHeader
          title={t("effectifs.needVsAvailable.title")}
          actions={
            // Même style/convention que le toggle de granularité de `StaffingPeriodBreakdown.tsx`
            // (mêmes clés i18n `staffingPeriod.granularity.*`) — cohérence visuelle voulue entre les
            // deux sélecteurs de période de cette page.
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["quarterly", "semiannual", "annual"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={needPeriodGranularity === g}
                  onClick={() => setNeedPeriodGranularity(g)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition ${
                    needPeriodGranularity === g
                      ? "bg-black text-white"
                      : "bg-white text-secondary hover:text-primary"
                  }`}
                >
                  {t(`staffingPeriod.granularity.${g}`)}
                </button>
              ))}
            </div>
          }
        />
        <CardBody>
          {/* Clarifie explicitement les deux périmètres temporels différents des deux côtés du
              ratio (demande PO — voir le doc-comment de tête de fichier) : le besoin est filtré sur
              la période choisie ci-dessus, le disponible reste structurellement une photo
              instantanée d'aujourd'hui (`Employee` n'a aucune notion de période). */}
          <p className="mb-3 text-[11px] text-tertiary">
            {t("effectifs.needVsAvailable.periodHintAvg").replace("{period}", needPeriod.label)}
          </p>
          {needSeriesData.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12px] font-semibold text-secondary">
                  {t("effectifs.needVsAvailable.seriesTitle")}
                </p>
                <p className="text-[12px] text-secondary">
                  {needPeriod.label} :{" "}
                  {t("effectifs.needVsAvailable.headline")
                    .replace("{mobilised}", formatFte(needTotalMetrics.mobilised))
                    .replace("{needed}", formatFte(needTotalMetrics.needed))
                    .replace(
                      "{pct}",
                      needTotalMetrics.staffingPct !== null
                        ? `${needTotalMetrics.staffingPct} %`
                        : "—"
                    )}
                </p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart
                  data={needSeriesChartData}
                  margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    yAxisId="fte"
                    width={40}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    width={44}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <RTooltip
                    formatter={(value, name) =>
                      name === "staffingPct"
                        ? [
                            value === null ? "—" : `${value}%`,
                            t("effectifs.needVsAvailable.staffingLine"),
                          ]
                        : [
                            `${formatFte(Number(value))} ${t("staffing.fteUnit")}`,
                            t(
                              `effectifs.needVsAvailable.${name === "needed" ? "needed" : name === "available" ? "available" : "mobilised"}`
                            ),
                          ]
                    }
                  />
                  <Legend
                    verticalAlign="top"
                    wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                    formatter={(value) =>
                      value === "staffingPct"
                        ? t("effectifs.needVsAvailable.staffingLine")
                        : t(
                            `effectifs.needVsAvailable.${value === "needed" ? "needed" : value === "available" ? "available" : "mobilised"}`
                          )
                    }
                  />
                  <RBar yAxisId="fte" dataKey="needed" fill="#a99e9a" radius={[3, 3, 0, 0]} />
                  <RBar yAxisId="fte" dataKey="available" fill="#d4d0cd" radius={[3, 3, 0, 0]} />
                  <RBar yAxisId="fte" dataKey="mobilised" fill="#1a1a1a" radius={[3, 3, 0, 0]} />
                  <Line
                    yAxisId="pct"
                    dataKey="staffingPct"
                    stroke="#e8543c"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-[11.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-tertiary">
                      <th className="py-1 pr-3 font-semibold">
                        {t("effectifs.needVsAvailable.periodCol")}
                      </th>
                      <th className="px-2 py-1 text-right font-semibold">
                        {t("effectifs.needVsAvailable.needed")}
                      </th>
                      <th className="px-2 py-1 text-right font-semibold">
                        {t("effectifs.needVsAvailable.available")}
                      </th>
                      <th className="px-2 py-1 text-right font-semibold">
                        {t("effectifs.needVsAvailable.mobilised")}
                      </th>
                      <th className="py-1 pl-2 text-right font-semibold">
                        {t("effectifs.needVsAvailable.staffingLine")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {needSeriesData.map((m) => (
                      <tr
                        key={m.label}
                        className={`border-b border-border/50 ${m.label === needPeriod.label ? "bg-neutral-50 font-semibold" : ""}`}
                      >
                        <td className="py-1 pr-3 text-primary">{m.label}</td>
                        <td className="px-2 py-1 text-right">{formatFte(m.needed)}</td>
                        <td className="px-2 py-1 text-right">{formatFte(m.available)}</td>
                        <td className="px-2 py-1 text-right">{formatFte(m.mobilised)}</td>
                        <td className="py-1 pl-2 text-right">
                          {m.staffingPct !== null ? `${m.staffingPct} %` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {needVsAvailable.length === 0 ? (
            <p className="text-sm text-text-secondary">{t("effectifs.needVsAvailable.empty")}</p>
          ) : (
            <>
              {/* Comparaison par équipe (round <n>) — voir le doc-comment de tête de fichier et
                  celui de `needVsAvailableChartData` : disponible seul à gauche, mobilisé+écart
                  empilés dans UNE colonne à droite, pour rendre l'écart directement lisible.
                  Pas de paragraphe de titre dédié : réutilise volontairement les clés i18n déjà
                  existantes de cette section (`available`/`mobilised`/`needed`/`staffingPct`)
                  plutôt que d'en ajouter de nouvelles pour ce seul libellé. */}
              <div className="mb-5">
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(220, needVsAvailableChartData.length * 60)}
                >
                  <RBarChart
                    data={needVsAvailableChartData}
                    margin={{
                      top: 4,
                      right: 12,
                      left: 4,
                      bottom: needVsAvailableChartData.length > 4 ? 32 : 4,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(0,0,0,0.04)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="fn"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      angle={needVsAvailableChartData.length > 4 ? -20 : 0}
                      textAnchor={needVsAvailableChartData.length > 4 ? "end" : "middle"}
                      height={needVsAvailableChartData.length > 4 ? 56 : 24}
                    />
                    <YAxis width={40} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <RTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as
                          | {
                              fn: string;
                              available: number;
                              mobilisedBase: number;
                              gapToDeclared: number;
                            }
                          | undefined;
                        if (!row) return null;
                        const needed = row.mobilisedBase + row.gapToDeclared;
                        const staffingPct =
                          needed > 0 ? Math.round((row.mobilisedBase / needed) * 100) : null;
                        return (
                          <div className="rounded-md border border-border bg-white px-3 py-2 text-[12px] shadow-sm">
                            <p className="mb-1 font-bold text-primary">{row.fn}</p>
                            <p className="flex items-center justify-between gap-3 text-secondary">
                              <span>{t("effectifs.needVsAvailable.available")}</span>
                              <span className="ml-2 font-semibold text-primary">
                                {formatFte(row.available)} {t("staffing.fteUnit")}
                              </span>
                            </p>
                            <p className="flex items-center justify-between gap-3 text-secondary">
                              <span>{t("effectifs.needVsAvailable.mobilised")}</span>
                              <span className="ml-2 font-semibold text-primary">
                                {formatFte(row.mobilisedBase)} {t("staffing.fteUnit")}
                              </span>
                            </p>
                            <p className="flex items-center justify-between gap-3 text-secondary">
                              <span>{t("effectifs.needVsAvailable.needed")}</span>
                              <span className="ml-2 font-semibold text-primary">
                                {formatFte(needed)} {t("staffing.fteUnit")}
                              </span>
                            </p>
                            <p className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1 font-bold text-primary">
                              <span>{t("effectifs.needVsAvailable.staffingPct")}</span>
                              <span>{staffingPct !== null ? `${staffingPct} %` : "—"}</span>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                      formatter={(value) =>
                        value === "available"
                          ? t("effectifs.needVsAvailable.available")
                          : t("effectifs.needVsAvailable.mobilised")
                      }
                    />
                    <RBar dataKey="available" fill="#d4d0cd" radius={[3, 3, 0, 0]} />
                    <RBar
                      dataKey="mobilisedBase"
                      stackId="combined"
                      fill="#1a1a1a"
                      radius={[0, 0, 3, 3]}
                    />
                    {/* Segment "écart au besoin déclaré" — pas d'entrée de légende dédiée
                        (`legendType="none"`) : réutilise les clés i18n existantes de cette section
                        plutôt que d'en ajouter une nouvelle rien que pour ce libellé (voir
                        `RTooltip` ci-dessus, qui explique déjà l'écart via "Besoin déclaré" +
                        "Staffing %"). La couleur reste visuellement distincte (segment clair
                        au-dessus du segment "Mobilisé" sombre), donc l'écart reste lisible même
                        sans légende propre. */}
                    <RBar
                      dataKey="gapToDeclared"
                      stackId="combined"
                      fill="#a99e9a"
                      radius={[3, 3, 0, 0]}
                      legendType="none"
                    />
                  </RBarChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-3">
                {needVsAvailable.map(({ fn, needed, mobilised, available }) => {
                  const pct = available > 0 ? Math.round((needed / available) * 100) : null;
                  const overAllocated = pct !== null && pct > 100;
                  return (
                    <li key={fn}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                          <span
                            aria-hidden
                            className={`h-2 w-2 rounded-full ${colorForDepartment(fn)}`}
                          />
                          {fn}
                        </span>
                        <span className="text-[12px] text-secondary">
                          <button
                            type="button"
                            onClick={() => setNeedDetailScope({ kind: "need", fn })}
                            title={t("effectifs.needVsAvailable.needDetailTitle").replace(
                              "{team}",
                              fn
                            )}
                            className="font-bold text-primary underline-offset-2 hover:text-bp-coral hover:underline"
                          >
                            {formatFte(needed)}
                          </button>{" "}
                          {t("effectifs.needVsAvailable.neededOf")}{" "}
                          <button
                            type="button"
                            onClick={() => setNeedDetailScope({ kind: "available", fn })}
                            title={t("effectifs.needVsAvailable.availableToday")}
                            className="font-bold text-primary underline-offset-2 hover:text-bp-coral hover:underline"
                          >
                            {formatFte(available)}
                          </button>{" "}
                          {t("staffing.fteUnit")}
                          {" · "}
                          {t("effectifs.needVsAvailable.mobilised").toLowerCase()}{" "}
                          <span className="font-bold text-primary">{formatFte(mobilised)}</span>
                          {needed > 0 && (
                            <span className="ml-1 font-bold text-primary">
                              ({t("effectifs.needVsAvailable.staffingPct").toLowerCase()}{" "}
                              {Math.round((mobilised / needed) * 100)}%)
                            </span>
                          )}
                          {pct !== null && (
                            <span
                              className={`ml-1.5 font-bold ${overAllocated ? "text-bp-coral" : ""}`}
                            >
                              ({pct}%)
                            </span>
                          )}
                        </span>
                      </div>
                      {overAllocated && (
                        <p className="mt-1 text-[11px] font-semibold text-bp-coral">
                          {t("effectifs.needVsAvailable.overAllocated")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      {/* Détail "besoin déclaré" (round <n>) — réutilise `StaffingDetailModal` tel quel (même forme
          de ligne que `StaffingPeriodBreakdown.tsx`) : lignes `ChantierStaffing` brutes de l'équipe
          cliquée, sur la période sélectionnée. Titre volontairement honnête (jamais "personnes") —
          voir le doc-comment de `needDetailRows`. */}
      <StaffingDetailModal
        open={needDetailScope?.kind === "need"}
        onOpenChange={(open) => {
          if (!open) setNeedDetailScope(null);
        }}
        title={needDetailModalTitle}
        rows={needDetailRows}
        totalFte={needDetailTotalFte}
      />

      {/* Détail "disponible" (round <n>) — modale LOCALE dédiée (pas `StaffingDetailModal`, dont la
          forme de ligne ne colle pas à `Employee`, voir le doc-comment d'`availableDetailRows`) :
          vrai tableau HTML des employés RÉELS de l'équipe cliquée, même parti pris que
          `StaffingDetailModal` (texte nativement sélectionnable plutôt qu'un panneau en prose). */}
      <Modal
        open={needDetailScope?.kind === "available"}
        onOpenChange={(open) => {
          if (!open) setNeedDetailScope(null);
        }}
        title={needDetailModalTitle}
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
