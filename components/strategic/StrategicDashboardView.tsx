"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Layers,
  LayoutGrid,
  ListChecks,
  Maximize2,
  Plus,
  RotateCcw,
  Target,
  TriangleAlert,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  chantierDependencyAlerts,
  countOnTrackAtRisk,
  numberIndicators,
  programBlockedActions,
  resolveChantierOwner,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import {
  STRATEGIC_DASHBOARD_WIDGET_REGISTRY,
  SPAN_COL_CLASS,
  addWidget,
  buildDefaultLayout,
  cycleSpan,
  getStrategicWidgetDef,
  loadStrategicDashboardLayout,
  moveWidget,
  removeWidget,
  saveStrategicDashboardLayout,
  setWidgetSpan,
  type StrategicDashboardWidgetInstance,
} from "@/lib/strategicDashboardWidgets";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { DependencyTypeBadge } from "@/components/shared/DependencyTypeBadge";
import { Dropdown, type DropdownGroup, type DropdownOption } from "@/components/shared/Dropdown";
import { BudgetVsActualBar } from "@/components/shared/BudgetVsActualBar";
import {
  BudgetDonutChart,
  type BudgetDonutSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { Modal } from "@/components/shared/Modal";
import { Popover } from "@/components/shared/Popover";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import {
  BusinessKpiCards,
  IndicatorStatusSummary,
} from "@/components/strategic/IndicatorStatusSummary";
import { ProgramRoadmap } from "@/components/strategic/ProgramRoadmap";
import type { StrategicAxis } from "@/types";

/**
 * Dashboard du PLAN STRATÉGIQUE — pendant de `DashboardPagePerformance.tsx` pour un programme de
 * type "strategic" (le routeur `app/(app)/dashboard/page.tsx` branche l'un ou l'autre selon le
 * programme actif).
 *
 * Même MÉCANIQUE de personnalisation que le dashboard exécutif (mode édition, drag & drop,
 * redimensionnement, ajout/suppression, persistance localStorage) — le PO exige que cette
 * fonctionnalité reste disponible pour le Plan Stratégique — mais sur un registre de widgets
 * DISJOINT (`lib/strategicDashboardWidgets.ts`, clé de stockage propre) : aucune métrique
 * financière ici, donc aucun widget de l'exécutif n'est réutilisable. Le code de la mécanique est
 * volontairement re-écrit plutôt que factorisé avec l'exécutif : ce dernier est la zone la plus
 * sensible de l'app (zéro régression tolérée) et porte en plus un builder générique
 * métrique × dimensions qui n'a pas d'équivalent stratégique.
 *
 * Les alertes de cascade de retard entre chantiers sont mises en évidence (bordure d'accent + tri
 * par retard décroissant) : c'est la fonctionnalité explicitement jugée « super importante » par
 * le PO, elle ne doit pas se noyer dans la grille.
 *
 * Round 17 (permutation) : la feuille de route programme (`ProgramRoadmap`, ex-onglet "Feuille de
 * route" de `StrategicAxesView.tsx`) est montée ICI en section FIXE, sous la grille de widgets
 * personnalisable (elle a besoin d'une vue globale du programme entier, pas d'une coquille
 * redimensionnable/retirable) — en échange, l'ancien widget "chantier-health" (vue E0→E4 par
 * levier) quitte ce dashboard pour devenir le contenu fixe de `/levers`, qui perd en retour ses
 * anciens onglets "Feuille de route"/"Cartes".
 */

/** Teinte d'accent PUREMENT catégorielle (round 13, point 3) — distingue les 4 puces d'en-tête
 *  entre elles ("ceci est cliquable, et ce n'est pas la même chose que sa voisine") sans jamais
 *  toucher au vocabulaire RAG (`tone: "amber"` ci-dessous reste le seul signal de statut). Les 4
 *  teintes sont piochées telles quelles dans `CHANTIER_COLOR_PALETTE` (lib/axisLogic.ts) — la
 *  palette catégorielle déjà validée charte pour ce genre de distinction arbitraire — en évitant
 *  volontairement `amber` (déjà réservé au risque) et `rose`/`pink`/`red` (trop proches de
 *  `--red`). Fond de la puce et bordure restent neutres par défaut ; seuls l'icône, son halo et la
 *  bordure au survol portent la teinte. */
const CHIP_ACCENTS = {
  blue: {
    icon: "text-blue-500",
    iconBg: "bg-blue-50",
    hoverBorder: "hover:border-blue-300",
  },
  violet: {
    icon: "text-violet-500",
    iconBg: "bg-violet-50",
    hoverBorder: "hover:border-violet-300",
  },
  teal: {
    icon: "text-teal-500",
    iconBg: "bg-teal-50",
    hoverBorder: "hover:border-teal-300",
  },
  orange: {
    icon: "text-orange-500",
    iconBg: "bg-orange-50",
    hoverBorder: "hover:border-orange-300",
  },
} as const;

/** Puce de statistique d'en-tête (icône + valeur + libellé) — remplace l'ancienne ligne de texte
 *  brute « Programme X · N axes · M chantiers · K indicateurs » par des chips visuellement
 *  distinctes, dans le même esprit que le bandeau d'en-tête du Plan Performance (passe de polish
 *  round 4, point 1). Purement présentationnel, local à ce fichier : ne mérite pas un composant
 *  partagé pour un seul appelant. */
function DashboardStatChip({
  icon: Icon,
  value,
  label,
  tone = "neutral",
  accent,
}: {
  icon: LucideIcon;
  /** Chaîne déjà formatée acceptée en plus d'un nombre brut — round 7, point 2 : la puce budget
   *  affiche une somme suffixée de la devise du programme, pas un simple compteur entier. */
  value: number | string;
  label: string;
  /** "amber" réservé au signal "à risque" — même token que `IndicatorStatusBadge`, jamais un
   *  vert/rouge littéral (charte BearingPoint, voir skill dataviz). */
  tone?: "neutral" | "amber";
  /** Teinte catégorielle (round 13, point 3, voir `CHIP_ACCENTS` ci-dessus) — ignorée si
   *  `tone === "amber"` : le signal risque prime toujours sur la distinction catégorielle. */
  accent?: keyof typeof CHIP_ACCENTS;
}) {
  const accentStyles = tone === "neutral" && accent ? CHIP_ACCENTS[accent] : null;
  return (
    <span
      className={
        tone === "amber"
          ? "inline-flex items-center gap-1.5 rounded-full bg-rag-amber-light px-2.5 py-1 text-[11px] font-semibold text-rag-amber"
          : `inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-secondary transition-colors ${
              accentStyles ? accentStyles.hoverBorder : ""
            }`
      }
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full ${
          accentStyles ? accentStyles.iconBg : ""
        }`}
      >
        <Icon
          size={12}
          className={
            tone === "amber" ? "text-rag-amber" : accentStyles ? accentStyles.icon : "text-tertiary"
          }
          aria-hidden
        />
      </span>
      <span className={tone === "amber" ? "text-rag-amber" : "text-primary"}>{value}</span>
      {label}
    </span>
  );
}

/** Enveloppe une `DashboardStatChip` dans un `Popover` (round 12) pour la rendre cliquable : la
 *  puce déclenche une petite liste (axes/chantiers/indicateurs/lignes de budget), chaque ligne
 *  naviguant ou ouvrant le panneau adapté. `Popover` ne fournit `toggle` qu'au render-prop
 *  `trigger` (pas à `children`) — on le capture donc dans un ref à chaque rendu du déclencheur
 *  pour pouvoir fermer le panneau depuis le clic sur une ligne de la liste, sans dupliquer l'état
 *  d'ouverture ni toucher à `Popover.tsx`. */
function ChipPopover({
  chip,
  title,
  emptyLabel,
  items,
}: {
  chip: ReactNode;
  title: string;
  emptyLabel: string;
  items: { key: string; label: ReactNode; onClick: () => void }[];
}) {
  const toggleRef = useRef<() => void>(() => {});
  return (
    <Popover
      trigger={({ toggle }) => {
        toggleRef.current = toggle;
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            className="cursor-pointer"
          >
            {chip}
          </button>
        );
      }}
      panelClassName="max-h-64 overflow-y-auto"
    >
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-tertiary">{emptyLabel}</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                item.onClick();
                toggleRef.current();
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-primary hover:bg-neutral-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Nombre de puces numérotées d'indicateur affichées dans l'en-tête riche d'axe de la feuille de
 *  route (round 17, porté depuis `StrategicAxesView.tsx` — voir `renderAxisRoadmapHeader`
 *  ci-dessous) avant repli sur une puce "+N". */
const MAX_CARD_INDICATOR_CHIPS = 5;

export function StrategicDashboardView() {
  const { user } = useRole();
  const { activeProgram, activeProgramId, programs, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const strategic = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  // Référentiel d'étapes de maturité du programme actif — nécessaire à `programBlockedActions`
  // (round 9, alimente la sous-section "Prérequis en attente" ci-dessous), même appel que
  // `StrategicAxesView.tsx`.
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);

  const { axes, chantiers, chantierActions, indicators, measurements } = strategic;

  /** Panneau chantier INLINE (round 10, point 1 — remplace l'ancienne vraie navigation vers
   *  `/levers?chantier=…`, qui faisait quitter le dashboard) : même mécanisme que
   *  `StrategicAxesView.tsx`.openChantierPanel — pose `?chantier=`/`&action=` sur CETTE MÊME page
   *  (`router.push`, garde l'historique — le bouton "retour" referme le panneau), monté juste en
   *  dessous via `<ChantierDetailPanel>`. Réutilisé par la feuille de route programme
   *  (`ProgramRoadmap`, round 17) et la ligne "Prérequis en attente" — un levier n'a pas de panneau
   *  propre, cliquer dessus ouvre toujours le panneau de son CHANTIER parent, désormais focalisé
   *  sur ce levier précis. */
  const openChantierPanel = (chantierId: string, focusActionId?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("chantier", chantierId);
    if (focusActionId) params.set("action", focusActionId);
    else params.delete("action");
    router.push(`/dashboard?${params.toString()}`);
  };

  /** Ferme le panneau chantier — `router.replace` (pas `push`) pour ne pas empiler une entrée
   *  d'historique par fermeture, même convention que `StrategicAxesView.tsx`. */
  const closeChantierPanel = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("chantier");
    params.delete("action");
    const qs = params.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard");
  };

  const openChantierId = searchParams.get("chantier");
  const focusActionId = searchParams.get("action") ?? undefined;
  const openChantierEntity = openChantierId
    ? chantiers.find((c) => c.id === openChantierId)
    : undefined;

  /** Navigation vers la fiche détail d'un axe — porté depuis `StrategicAxesView.tsx`, réutilisé par
   *  `renderAxisRoadmapHeader` (nom de l'axe cliquable, feuille de route ci-dessous). */
  const openAxis = (axisId: string) => router.push(`/levers/detail?id=${axisId}`);

  // ─── Agrégats (toute la logique de calcul vient de lib/axisLogic.ts) ──────────────────────
  const counts = useMemo(() => countOnTrackAtRisk(indicators), [indicators]);

  /** Round 7, point 2 : somme du budget alloué (`Chantier.allocatedBudget`, fondation) sur tout le
   *  programme actif — puce supplémentaire du bandeau d'en-tête, même esprit que les compteurs
   *  axes/chantiers/indicateurs juste à côté. Pas de nouveau widget : un chiffre agrégé de plus. */
  const allocatedBudgetTotal = useMemo(
    () => chantiers.reduce((sum, chantier) => sum + (chantier.allocatedBudget ?? 0), 0),
    [chantiers]
  );

  /** Numérotation globale 3-5-15 des indicateurs (`numberIndicators`, lib/axisLogic.ts) — alimente
   *  UNIQUEMENT la liste de la puce "indicateurs" du bandeau d'en-tête (round 12) : chaque ligne
   *  affiche "#N · nom", même convention de numérotation que le reste de l'app. */
  const indicatorNumbers = useMemo(
    () => numberIndicators(axes, chantiers, indicators),
    [axes, chantiers, indicators]
  );

  /** Budget alloué total PAR AXE (round 12) — alimente la liste de la puce "budget" du bandeau
   *  d'en-tête : un simple regroupement/somme, pas de graphique (une répartition en camembert est
   *  ajoutée en parallèle sur la page Axes stratégiques elle-même). */
  const axisBudgets = useMemo(
    () =>
      axes.map((axis) => ({
        axis,
        total: chantiers
          .filter((chantier) => chantier.axisId === axis.id)
          .reduce((sum, chantier) => sum + (chantier.allocatedBudget ?? 0), 0),
      })),
    [axes, chantiers]
  );

  const dependencyAlerts = useMemo(
    () =>
      chantierDependencyAlerts(chantiers, chantierActions).sort(
        (a, b) => b.delayDays - a.delayDays
      ),
    [chantiers, chantierActions]
  );

  /** Round 9, point 1 : leviers dont au moins un prérequis n'est pas satisfait
   *  (`programBlockedActions`, lib/axisLogic.ts) — même parti pris purement informatif que
   *  `dependencyAlerts` ci-dessus, alimente la deuxième sous-section du widget
   *  "chantier-dependency-alerts". */
  const blockedActions = useMemo(
    () => programBlockedActions(chantierActions, stages),
    [chantierActions, stages]
  );

  /** Nom de chantier par id — la sous-section "Prérequis en attente" doit afficher le CHANTIER
   *  parent d'un levier bloqué (le levier seul ne dit pas de quel chantier il relève, contrairement
   *  au message déjà formaté de `dependencyAlerts`). */
  const chantierNameById = useMemo(
    () => new Map(chantiers.map((chantier) => [chantier.id, chantier.name])),
    [chantiers]
  );

  // ─── Feuille de route programme (round 17, permutation) — porté verbatim depuis
  // `StrategicAxesView.tsx` (ex-onglet "Feuille de route", désormais remplacé sur `/levers` par le
  // contenu fixe de l'ex-widget "chantier-health") : `ProgramRoadmap` a besoin d'une vue GLOBALE
  // programme, c'est pourquoi elle rejoint le dashboard exécutif plutôt que le portefeuille d'axes.
  // ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Filtres "Axe" / "Chantier" / "Responsable" de la feuille de route — même patron que les 3
   * dropdowns équivalents de `KpiPageClient.tsx` (URL-persistés, portée en cascade, garde-fou de
   * cohérence après chargement des données). Namespacés `rmAxis`/`rmChantier`/`rmOwner` (inchangé
   * depuis `StrategicAxesView.tsx`) : ce dashboard utilise déjà `?chantier=`/`&action=` pour l'état
   * d'ouverture du panneau chantier (`openChantierPanel` plus haut) — réutiliser ce nom
   * corromprait ce mécanisme.
   */
  const rmAxis = searchParams.get("rmAxis");
  const rmChantier = searchParams.get("rmChantier");
  const rmOwner = searchParams.get("rmOwner");

  const setRoadmapParam = useCallback(
    (key: "rmAxis" | "rmChantier" | "rmOwner", value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
    },
    [router, searchParams]
  );

  const roadmapAxisOptions: DropdownOption[] = useMemo(
    () => axes.map((axis) => ({ value: axis.id, label: axis.name })),
    [axes]
  );

  // Portée par `rmAxis` — même logique de scoping que `chantierGroups` de `KpiPageClient.tsx` :
  // quand un axe est sélectionné, ne proposer que SES chantiers.
  const roadmapChantierGroups: DropdownGroup[] = useMemo(
    () =>
      axes
        .filter((axis) => !rmAxis || axis.id === rmAxis)
        .map((axis) => ({
          groupLabel: axis.name,
          options: chantiers
            .filter((c) => c.axisId === axis.id)
            .map((c) => ({ value: c.id, label: c.name })),
        }))
        .filter((group) => group.options.length > 0),
    [axes, chantiers, rmAxis]
  );

  // Portée par `rmAxis`/`rmChantier` — même logique que `ownerOptions` de `KpiPageClient.tsx`, mais
  // résolue par CHANTIER (`resolveChantierOwner`) plutôt que par indicateur : ce filtre alimente une
  // vue par levier, sans indicateur à résoudre.
  const roadmapOwnerOptions: DropdownOption[] = useMemo(() => {
    const scoped = chantiers.filter((c) => {
      if (rmAxis && c.axisId !== rmAxis) return false;
      if (rmChantier && c.id !== rmChantier) return false;
      return true;
    });
    const names = new Set(
      scoped.map((c) => resolveChantierOwner(c, axes, t("strategicAxes.unassigned")))
    );
    return Array.from(names)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [chantiers, axes, t, rmAxis, rmChantier]);

  // Garde-fou de cohérence (même patron que `KpiPageClient.tsx`) : si le changement d'axe rend le
  // chantier ou le responsable actuellement sélectionné invalide, on le réinitialise — UN seul
  // `router.replace` pour les deux, pour ne pas laisser un effet écraser la suppression de l'autre.
  useEffect(() => {
    if (strategic.loading) return;

    const chantier = rmChantier ? chantiers.find((c) => c.id === rmChantier) : null;
    const chantierInvalid = !!rmChantier && (!chantier || (!!rmAxis && chantier.axisId !== rmAxis));

    const validOwners = new Set(roadmapOwnerOptions.map((o) => o.value));
    const ownerInvalid = !!rmOwner && !validOwners.has(rmOwner);

    if (!chantierInvalid && !ownerInvalid) return;

    const params = new URLSearchParams(searchParams.toString());
    if (chantierInvalid) params.delete("rmChantier");
    if (ownerInvalid) params.delete("rmOwner");
    const qs = params.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
  }, [
    rmAxis,
    rmChantier,
    rmOwner,
    chantiers,
    strategic.loading,
    roadmapOwnerOptions,
    searchParams,
    router,
  ]);

  const roadmapChantiers = useMemo(
    () =>
      chantiers.filter((chantier) => {
        if (rmAxis && chantier.axisId !== rmAxis) return false;
        if (rmChantier && chantier.id !== rmChantier) return false;
        if (
          rmOwner &&
          resolveChantierOwner(chantier, axes, t("strategicAxes.unassigned")) !== rmOwner
        )
          return false;
        return true;
      }),
    [chantiers, axes, t, rmAxis, rmChantier, rmOwner]
  );

  const roadmapActions = useMemo(() => {
    const survivingIds = new Set(roadmapChantiers.map((c) => c.id));
    return chantierActions.filter((action) => survivingIds.has(action.chantierId));
  }, [chantierActions, roadmapChantiers]);

  /** Axe dont le donut de répartition budgétaire (en-tête riche de la feuille de route) est
   *  actuellement ouvert — `null` = modale fermée. Porté depuis `StrategicAxesView.tsx`, même
   *  convention : on ne stocke que l'id, les chantiers/le budget de l'axe sont recalculés depuis
   *  `chantiersByAxis` (ci-dessous) plutôt que capturés au clic. */
  const [budgetDonutAxisId, setBudgetDonutAxisId] = useState<string | null>(null);

  /**
   * Numéro global unique par indicateur — porté depuis `StrategicAxesView.tsx`, alimente
   * exclusivement les puces d'indicateur de `renderAxisRoadmapHeader` ci-dessous.
   */
  const globalIndicatorNumbers = useMemo(
    () => numberIndicators(axes, chantiers, indicators),
    [axes, chantiers, indicators]
  );

  // Chantiers regroupés par axe — porté depuis `StrategicAxesView.tsx`, alimente
  // `renderAxisRoadmapHeader` (légende/liste de chantiers de l'en-tête riche d'axe).
  const chantiersByAxis = useMemo(() => {
    const map = new Map<string, typeof chantiers>();
    for (const chantier of chantiers) {
      const list = map.get(chantier.axisId);
      if (list) list.push(chantier);
      else map.set(chantier.axisId, [chantier]);
    }
    return map;
  }, [chantiers]);

  /** Budget alloué total d'un axe — porté depuis `StrategicAxesView.tsx`, affiché dans l'en-tête
   *  riche d'axe de la feuille de route. */
  const axisBudgetByAxis = useMemo(() => {
    const map = new Map<string, number>();
    chantiersByAxis.forEach((axisChantiers, axisId) => {
      map.set(
        axisId,
        axisChantiers.reduce((sum, chantier) => sum + (chantier.allocatedBudget ?? 0), 0)
      );
    });
    return map;
  }, [chantiersByAxis]);

  /** Budget CONSOMMÉ total d'un axe — pendant de `axisBudgetByAxis` ci-dessus mais sommant
   *  `Chantier.consumedBudget`, sur le MÊME ensemble de chantiers, pour alimenter
   *  `BudgetVsActualBar` dans l'en-tête riche d'axe. */
  const axisConsumedByAxis = useMemo(() => {
    const map = new Map<string, number>();
    chantiersByAxis.forEach((axisChantiers, axisId) => {
      map.set(
        axisId,
        axisChantiers.reduce((sum, chantier) => sum + (chantier.consumedBudget ?? 0), 0)
      );
    });
    return map;
  }, [chantiersByAxis]);

  /** Indicateurs regroupés par axe — porté depuis `StrategicAxesView.tsx`, alimente les puces
   *  numérotées de l'en-tête riche d'axe. */
  const indicatorsByAxis = useMemo(() => {
    const map = new Map<string, typeof indicators>();
    for (const indicator of indicators) {
      const list = map.get(indicator.axisId);
      if (list) list.push(indicator);
      else map.set(indicator.axisId, [indicator]);
    }
    return map;
  }, [indicators]);

  /** Parts du donut budgétaire de l'axe actuellement ouvert (`budgetDonutAxisId`) — porté depuis
   *  `StrategicAxesView.tsx`. */
  const budgetDonutSlices: BudgetDonutSlice[] | null = useMemo(() => {
    if (!budgetDonutAxisId) return null;
    return (chantiersByAxis.get(budgetDonutAxisId) ?? [])
      .filter((chantier) => (chantier.allocatedBudget ?? 0) > 0)
      .map((chantier) => ({ name: chantier.name, value: chantier.allocatedBudget ?? 0 }));
  }, [budgetDonutAxisId, chantiersByAxis]);

  /** Résout le nom d'un chantier vers son id, dans l'axe ouvert — pour le `onSliceClick` du donut
   *  (le donut ne connaît que les NOMS, voir `BudgetDonutChart`). */
  const resolveChantierIdByName = (axisId: string, name: string): string | undefined =>
    (chantiersByAxis.get(axisId) ?? []).find((c) => c.name === name)?.id;

  /**
   * En-tête riche d'axe de la feuille de route — porté verbatim depuis `StrategicAxesView.tsx`
   * (round 16, puis round 17 pour ce déplacement) : pastille couleur + nom + responsable,
   * description, puces d'indicateur numérotées, budget alloué + `BudgetVsActualBar`. Passé à
   * `ProgramRoadmap` via sa prop `renderAxisHeader` — appelé par `ProgramRoadmap` une fois par axe
   * affiché, jamais directement par ce composant.
   */
  const renderAxisRoadmapHeader = (axis: StrategicAxis): ReactNode => {
    // Triés par numéro global ascendant (`globalIndicatorNumbers`) AVANT le slice — même tri que
    // l'ancienne carte, voir son doc-comment historique dans `StrategicAxesView.tsx`.
    const axisIndicators = (indicatorsByAxis.get(axis.id) ?? [])
      .slice()
      .sort(
        (a, b) => (globalIndicatorNumbers.get(a.id) ?? 0) - (globalIndicatorNumbers.get(b.id) ?? 0)
      );
    const shownIndicators = axisIndicators.slice(0, MAX_CARD_INDICATOR_CHIPS);
    const hiddenIndicatorsCount = axisIndicators.length - shownIndicators.length;
    const axisChantiers = chantiersByAxis.get(axis.id) ?? [];
    const axisBudget = axisBudgetByAxis.get(axis.id) ?? 0;
    const axisConsumed = axisConsumedByAxis.get(axis.id) ?? 0;
    const axisHasBudgetSlices = axisChantiers.some((c) => (c.allocatedBudget ?? 0) > 0);

    return (
      <div className="rounded-lg border border-border-strong bg-neutral-50 p-3">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="mt-1 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
          />
          <span className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => openAxis(axis.id)}
              className="block truncate text-left text-sm font-bold text-primary transition hover:text-bp-coral hover:underline"
            >
              {axis.name}
            </button>
            <span className="mt-0.5 block text-[11px] text-tertiary">
              {axis.owner ?? t("strategicAxes.unassigned")}
            </span>
          </span>
        </div>

        <p className="mt-2 line-clamp-2 min-h-[34px] text-[12.5px] leading-snug text-secondary">
          {axis.description ?? ""}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-tertiary">{t("strategicAxes.indicatorsCount")}</span>
          {axisIndicators.length === 0 ? (
            <span className="text-[11px] italic text-tertiary">
              {t("strategicAxes.noIndicatorsShort")}
            </span>
          ) : (
            <>
              {shownIndicators.map((indicator) => {
                const atRisk = resolveIndicatorStatus(indicator) === "at_risk";
                return (
                  <button
                    key={indicator.id}
                    type="button"
                    title={
                      atRisk ? `${indicator.name} — ${t("indicatorStatus.atRisk")}` : indicator.name
                    }
                    onClick={() => router.push(`/kpi?indicator=${indicator.id}`)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition hover:bg-black hover:text-white ${
                      atRisk ? "bg-rag-amber-light text-rag-amber" : "bg-neutral-100 text-secondary"
                    }`}
                  >
                    {globalIndicatorNumbers.get(indicator.id) ?? "?"}
                  </button>
                );
              })}
              {hiddenIndicatorsCount > 0 && (
                <span
                  className="flex h-5 shrink-0 items-center rounded-full bg-neutral-100 px-1.5 text-[10px] font-semibold text-secondary"
                  title={`+${hiddenIndicatorsCount} ${t("strategicAxes.indicatorsCount")}`}
                >
                  +{hiddenIndicatorsCount}
                </span>
              )}
            </>
          )}
        </div>

        {axisChantiers.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1 border-t border-border pt-2 text-[10.5px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                {t("strategicChantierDetail.allocatedBudget")}
              </span>
              {axisHasBudgetSlices ? (
                <button
                  type="button"
                  onClick={() => setBudgetDonutAxisId(axis.id)}
                  className="shrink-0 font-semibold text-secondary underline-offset-2 hover:text-primary hover:underline"
                >
                  {axisBudget.toLocaleString()} {activeProgram?.currency ?? ""}
                </button>
              ) : (
                <span className="shrink-0 font-semibold text-secondary">
                  {axisBudget.toLocaleString()} {activeProgram?.currency ?? ""}
                </span>
              )}
            </div>
            <BudgetVsActualBar
              planned={axisBudget}
              consumed={axisConsumed}
              formatValue={(value) => `${value.toLocaleString()} ${activeProgram?.currency ?? ""}`}
            />
          </div>
        )}
      </div>
    );
  };

  const summaryLabels = {
    tracked: t("strategicDashboard.tracked"),
    onTrack: t("strategicDashboard.onTrack"),
    atRisk: t("strategicDashboard.atRisk"),
    indicatorsSuffix: t("strategicDashboard.indicatorsSuffix"),
  };

  const businessKpiLabels = {
    empty: t("businessKpis.empty"),
    noValue: t("businessKpis.noValue"),
    objective: t("kpi.objectiveValue"),
    onTrack: t("indicatorStatus.onTrack"),
    atRisk: t("indicatorStatus.atRisk"),
    atRiskTooltip: t("strategicAxes.atRiskTooltip"),
    fullHistory: t("kpi.chart.fullHistory"),
    progressToTarget: t("kpi.chart.progressToTarget"),
  };

  // Libellés de `ProgramRoadmap` — porté depuis `StrategicAxesView.tsx` (mêmes clés i18n
  // `strategicAxes.roadmap.*`/`strategicAxes.ganttToday`, réutilisées telles quelles : ce
  // vocabulaire reste conceptuellement "celui de la feuille de route", seul le fichier qui le
  // consomme change avec ce déplacement round 17).
  const roadmapLabels = {
    empty: t("strategicAxes.roadmap.empty"),
    scale: t("strategicAxes.roadmap.scale"),
    scaleQuarter: t("strategicAxes.roadmap.scaleQuarter"),
    scaleSemester: t("strategicAxes.roadmap.scaleSemester"),
    scaleYear: t("strategicAxes.roadmap.scaleYear"),
    progress: t("strategicAxes.roadmap.progress"),
    today: t("strategicAxes.ganttToday"),
    leviersSuffix: t("strategicAxes.roadmap.leviersSuffix"),
  };

  // ─── Layout personnalisable (même mécanique que le dashboard exécutif) ────────────────────
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<StrategicDashboardWidgetInstance[]>(buildDefaultLayout);
  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [dragOverInstanceId, setDragOverInstanceId] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  // Chargement APRÈS le premier rendu : `localStorage` n'existe pas au prerender statique
  // (output: "export"), l'état initial doit donc rester le layout par défaut.
  useEffect(() => {
    setLayout(loadStrategicDashboardLayout());
  }, []);

  const updateLayout = (next: StrategicDashboardWidgetInstance[]) => {
    setLayout(next);
    saveStrategicDashboardLayout(next);
  };

  const moveWidgetBy = (instanceId: string, direction: "up" | "down") => {
    const fromIndex = layout.findIndex((w) => w.instanceId === instanceId);
    if (fromIndex === -1) return;
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= layout.length) return;
    updateLayout(moveWidget(layout, fromIndex, toIndex));
  };

  const handleDrop = (targetInstanceId: string) => {
    if (dragInstanceId && dragInstanceId !== targetInstanceId) {
      const fromIndex = layout.findIndex((w) => w.instanceId === dragInstanceId);
      const toIndex = layout.findIndex((w) => w.instanceId === targetInstanceId);
      if (fromIndex !== -1 && toIndex !== -1) {
        updateLayout(moveWidget(layout, fromIndex, toIndex));
      }
    }
    setDragInstanceId(null);
    setDragOverInstanceId(null);
  };

  /** Coquille commune : largeur de colonne + barre d'outils du mode édition, sans toucher au
   *  contenu métier du widget. Identique en comportement à celle du dashboard exécutif (poignée
   *  de glisser sur desktop, boutons haut/bas au doigt). */
  const renderWidgetShell = (instance: StrategicDashboardWidgetInstance, children: ReactNode) => {
    const def = getStrategicWidgetDef(instance.type);
    if (!def) return null;
    const isDragOver = editMode && dragOverInstanceId === instance.instanceId;
    return (
      <div
        key={instance.instanceId}
        data-widget-id={instance.instanceId}
        data-widget-title={t(def.label)}
        className={`relative ${SPAN_COL_CLASS[instance.span]} ${
          isDragOver ? "outline outline-2 outline-offset-2 outline-bp-coral" : ""
        }`}
        draggable={editMode}
        onDragStart={() => setDragInstanceId(instance.instanceId)}
        onDragOver={(e) => {
          if (!editMode) return;
          e.preventDefault();
          setDragOverInstanceId(instance.instanceId);
        }}
        onDragLeave={() => {
          if (dragOverInstanceId === instance.instanceId) setDragOverInstanceId(null);
        }}
        onDrop={(e) => {
          if (!editMode) return;
          e.preventDefault();
          handleDrop(instance.instanceId);
        }}
      >
        {editMode && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border-strong bg-white/95 px-1.5 py-1 text-[11px] font-semibold text-secondary shadow-sm">
            <span
              className="hidden cursor-grab px-0.5 text-tertiary active:cursor-grabbing sm:inline-flex"
              title={t("strategicDashboard.dragToReorder")}
            >
              <GripVertical size={14} />
            </span>
            <div className="flex items-center sm:hidden">
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "up")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("strategicDashboard.moveUp")}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "down")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("strategicDashboard.moveDown")}
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                updateLayout(
                  setWidgetSpan(
                    layout,
                    instance.instanceId,
                    cycleSpan(instance.span, def.allowedSpans)
                  )
                )
              }
              className="hidden items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-100 hover:text-primary sm:flex"
              title={t("strategicDashboard.resizeWidget")}
            >
              <Maximize2 size={12} />
              {instance.span}
            </button>
            <button
              type="button"
              onClick={() => updateLayout(removeWidget(layout, instance.instanceId))}
              className="flex items-center rounded px-1 py-0.5 text-tertiary hover:bg-neutral-100 hover:text-bp-coral"
              title={t("strategicDashboard.removeWidget")}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className={editMode ? "pointer-events-none select-none" : ""}>{children}</div>
      </div>
    );
  };

  const emptyLine = (label: string) => (
    <p className="py-6 text-center text-xs text-tertiary">{label}</p>
  );

  const renderWidget = (instance: StrategicDashboardWidgetInstance): ReactNode => {
    switch (instance.type) {
      // ── Compteur global on-track / à risque (carte héro) ──────────────────────────────────
      case "indicator-status":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.indicatorStatus")} />
            <CardBody>
              {indicators.length === 0 ? (
                emptyLine(t("strategicDashboard.noIndicators"))
              ) : (
                <IndicatorStatusSummary
                  indicators={indicators}
                  measurements={measurements}
                  showTotal={false}
                  labels={summaryLabels}
                  // Round 6, point 1 : le widget passe en XL (largeur pleine) mais cette grille
                  // interne restait plafonnée à 2 colonnes quelle que soit la coquille — seulement
                  // 2 cartes ici (sur la trajectoire / à risque), `lg:grid-cols-3` laisse une
                  // marge inoffensive plutôt que d'étirer les cartes elles-mêmes.
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  radialHero
                />
              )}
            </CardBody>
          </Card>
        );

      // ── KPI business : indicateurs de niveau axe (remplace l'ancien widget « cumul des
      //    indicateurs », retiré — sommer des indicateurs hétérogènes n'a pas de sens sur un plan
      //    stratégique, contrairement aux économies d'un Plan Performance) ─────────────────────
      case "business-kpis":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.businessKpis")} />
            <CardBody>
              <BusinessKpiCards
                indicators={indicators}
                measurements={measurements}
                labels={businessKpiLabels}
                // Round 6, point 1 : idem `IndicatorStatusSummary` ci-dessus. Le jeu de démo
                // (`scripts/seed-strategic-demo.js`) compte 5 KPI business (un macro-indicateur par
                // axe) — `xl:grid-cols-4` remplit une coquille XL sans jamais forcer plus de 4
                // cartes par ligne (elles restent lisibles, sparkline comprise).
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              />
            </CardBody>
          </Card>
        );

      // ── Alertes de cascade de retard entre chantiers (mise en évidence) ───────────────────
      case "chantier-dependency-alerts":
        return renderWidgetShell(
          instance,
          <Card
            className={`mb-0 h-full ${
              dependencyAlerts.length > 0 ? "border-bp-coral/60 shadow-md" : ""
            }`}
          >
            <CardHeader
              title={
                <>
                  {dependencyAlerts.length > 0 && (
                    <TriangleAlert size={14} className="flex-shrink-0 text-bp-coral" />
                  )}
                  {t("strategicDashboard.widget.chantierDependencyAlerts")}
                </>
              }
              actions={
                dependencyAlerts.length > 0 ? (
                  <span className="rounded-full bg-bp-coral px-2 py-0.5 text-[10.5px] font-bold text-white">
                    {dependencyAlerts.length}
                  </span>
                ) : undefined
              }
            />
            <CardBody>
              {/* Sous-section 1 : dépendances entre chantiers (inchangée, round 6). */}
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                  {t("strategicDashboard.dependencyAlertsHeading")}
                </span>
              </div>
              {dependencyAlerts.length === 0
                ? emptyLine(t("strategicDashboard.noDependencyAlerts"))
                : dependencyAlerts.map((alert) => (
                    <div
                      key={`${alert.sourceId}-${alert.targetId}-${alert.type}`}
                      className="border-b border-border py-2.5 last:border-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <DependencyTypeBadge type={alert.type} />
                        <span className="text-[11px] font-semibold text-bp-coral">
                          {alert.delayDays} {t("strategicDashboard.delayDays")}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-secondary">
                        {alert.message}
                      </p>
                    </div>
                  ))}

              {/* Sous-section 2 (round 9, point 1) : prérequis non satisfaits (`programBlockedActions`,
                  lib/axisLogic.ts) — même carte que les alertes de dépendance pour rester un seul
                  repère visuel "alertes" sur le dashboard, mais visuellement DISTINCTE (séparateur
                  renforcé + teinte amber plutôt que corail) pour ne pas fusionner deux types
                  d'alerte différents en une liste indifférenciée. */}
              <div className="mt-4 border-t-2 border-border pt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                    {t("strategicDashboard.pendingPrerequisitesHeading")}
                  </span>
                  {blockedActions.length > 0 && (
                    <span className="rounded-full bg-rag-amber px-2 py-0.5 text-[10.5px] font-bold text-white">
                      {blockedActions.length}
                    </span>
                  )}
                </div>
                {blockedActions.length === 0
                  ? emptyLine(t("strategicDashboard.noPrerequisiteAlerts"))
                  : blockedActions.map(({ action, reasons }) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => openChantierPanel(action.chantierId, action.id)}
                        className="block w-full border-b border-border py-2.5 text-left transition last:border-0 first:pt-0 hover:bg-neutral-50"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold text-rag-amber">
                            {action.name}
                          </span>
                          <span className="text-[10.5px] text-tertiary">
                            {chantierNameById.get(action.chantierId) ?? action.chantierId}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-snug text-secondary">
                          {reasons.join(", ")}
                        </p>
                      </button>
                    ))}
              </div>
            </CardBody>
          </Card>
        );

      default:
        return null;
    }
  };

  // ─── Écrans d'attente / vides ─────────────────────────────────────────────────────────────
  if (programsLoading || strategic.loading) {
    return (
      <div className="animate-fade-up p-6 text-sm text-secondary">
        {t("strategicDashboard.loading")}
      </div>
    );
  }

  if (programs.length === 0 || !activeProgram) {
    return (
      <div className="animate-fade-up">
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">{t("strategicDashboard.noProgram")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("strategicDashboard.title")}
          </h1>
          <div className="mt-2 text-[13px] text-secondary">
            {t("dashboard.program")} <strong className="text-primary">{activeProgram.name}</strong>
          </div>
          {/* Bandeau "ambition" (round 12) — rappel permanent du programme, réglé une fois par un
              admin (ProgramsPanel.tsx) et affiché à quiconque ouvre ce dashboard. Volontairement
              DISTINCT des puces de stats juste en dessous (barre bordée pleine largeur plutôt
              qu'une pastille) pour se lire comme un rappel plutôt qu'une métrique — masqué quand le
              champ n'est pas encore renseigné (pas de placeholder). */}
          {activeProgram.ambition && activeProgram.ambition.trim() !== "" && (
            <div className="mt-3 max-w-2xl rounded-lg border-l-4 border-bp-coral bg-bp-coral/5 px-4 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-bp-coral">
                {t("strategicDashboard.ambitionLabel")}
              </div>
              <div className="mt-0.5 text-[13px] font-medium leading-snug text-primary">
                {activeProgram.ambition}
              </div>
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={Target}
                  value={axes.length}
                  label={t("strategicDashboard.axesSuffix")}
                  accent="blue"
                />
              }
              title={t("strategicDashboard.popover.axesTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyAxes")}
              items={axes.map((axis) => ({
                key: axis.id,
                label: axis.name,
                onClick: () => router.push("/levers"),
              }))}
            />
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={Layers}
                  value={chantiers.length}
                  label={t("strategicDashboard.chantiersSuffix")}
                  accent="violet"
                />
              }
              title={t("strategicDashboard.popover.chantiersTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyChantiers")}
              items={chantiers.map((chantier) => ({
                key: chantier.id,
                label: chantier.name,
                onClick: () => openChantierPanel(chantier.id),
              }))}
            />
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={ListChecks}
                  value={counts.total}
                  label={t("strategicDashboard.indicatorsSuffix")}
                  accent="teal"
                />
              }
              title={t("strategicDashboard.popover.indicatorsTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyIndicators")}
              items={[...indicators]
                .sort(
                  (a, b) => (indicatorNumbers.get(a.id) ?? 0) - (indicatorNumbers.get(b.id) ?? 0)
                )
                .map((indicator) => ({
                  key: indicator.id,
                  label: `#${indicatorNumbers.get(indicator.id) ?? "?"} · ${indicator.name}`,
                  onClick: () => router.push(`/kpi?indicator=${indicator.id}`),
                }))}
            />
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={Wallet}
                  value={`${allocatedBudgetTotal.toLocaleString()} ${activeProgram.currency}`}
                  label={t("strategicDashboard.allocatedBudget")}
                  accent="orange"
                />
              }
              title={t("strategicDashboard.popover.budgetTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyBudget")}
              items={axisBudgets.map(({ axis, total }) => ({
                key: axis.id,
                // Round 13, point 2 : deux segments (nom d'axe / montant) en JSX plutôt qu'une
                // seule chaîne interpolée — le montant reste sur la même ligne, aligné à droite,
                // quelle que soit la longueur du nom d'axe (qui tronque plutôt que de wrapper).
                label: (
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate">{axis.name}</span>
                    <span className="shrink-0 whitespace-nowrap font-semibold text-primary">
                      {total.toLocaleString()} {activeProgram.currency}
                    </span>
                  </span>
                ),
                onClick: () => router.push("/levers"),
              }))}
            />
          </div>
        </div>
        {/* Personnalisation : desktop uniquement, comme sur le dashboard exécutif (le
            glisser-déposer n'a pas de sens au doigt). */}
        <div className="hidden items-center gap-2 lg:flex">
          <Button
            variant={editMode ? "dark" : "outline"}
            size="md"
            onClick={() => setEditMode((v) => !v)}
          >
            <LayoutGrid size={14} />
            {editMode ? t("dashboard.done") : t("dashboard.customize")}
          </Button>
        </div>
      </div>

      {editMode && (
        <div className="mb-4 rounded-lg border-2 border-bp-coral/30 bg-bp-coral/[0.04]">
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-bp-coral/20 bg-white/95 p-4 shadow-sm backdrop-blur">
            <div>
              <div className="text-[13px] font-bold text-primary">
                {t("dashboard.editModeTitle")}
              </div>
              <div className="text-[11.5px] text-secondary">{t("dashboard.editModeHint")}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={addPanelOpen ? "dark" : "primary"}
                size="sm"
                onClick={() => setAddPanelOpen((v) => !v)}
              >
                <Plus size={13} />
                {t("dashboard.addWidget")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateLayout(buildDefaultLayout())}
              >
                <RotateCcw size={13} />
                {t("dashboard.reset")}
              </Button>
              <Button variant="dark" size="sm" onClick={() => setEditMode(false)}>
                <LayoutGrid size={13} />
                {t("dashboard.done")}
              </Button>
            </div>
          </div>

          {addPanelOpen && (
            <div className="grid grid-cols-2 gap-2 p-4 pt-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {STRATEGIC_DASHBOARD_WIDGET_REGISTRY.map((def) => {
                // `Sigma` n'est pas dans ICON_REGISTRY (registre partagé avec la nav, que ce
                // workstream ne modifie pas) — repli neutre plutôt qu'un widget sans icône.
                const Icon = ICON_REGISTRY[def.icon] ?? LayoutGrid;
                const alreadyPresent = layout.some((w) => w.type === def.type);
                return (
                  <button
                    key={def.type}
                    type="button"
                    onClick={() => {
                      updateLayout(addWidget(layout, def.type));
                      setAddPanelOpen(false);
                    }}
                    className="flex flex-col items-start gap-2 rounded-md border border-border-strong bg-white p-3 text-left transition hover:border-bp-coral hover:shadow-sm"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-primary">
                      <Icon size={16} />
                    </span>
                    <span className="text-[12px] font-semibold leading-tight text-primary">
                      {t(def.label)}
                    </span>
                    {alreadyPresent && (
                      <span className="text-[10px] font-medium text-tertiary">
                        {t("dashboard.alreadyOnBoard")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {axes.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">{t("strategicDashboard.noAxesHint")}</p>
          </CardBody>
        </Card>
      )}

      <div
        data-dashboard-widget-grid
        className="grid grid-cols-1 grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {layout.map((instance) => renderWidget(instance))}
      </div>

      {/* ── Feuille de route programme (round 17, permutation) — section FIXE, hors grille de
          widgets personnalisable : `ProgramRoadmap` a besoin d'une vue globale du programme entier,
          elle ne se prête pas à une coquille redimensionnable/retirable comme les autres widgets
          ci-dessus. Porté depuis l'ex-onglet "Feuille de route" de `StrategicAxesView.tsx`. ───── */}
      <div className="mt-4">
        <Card className="overflow-visible">
          <CardBody flush>
            {/* `overflow-visible` (voir doc-comment historique de `StrategicAxesView.tsx`) :
                `Card` applique `overflow-hidden` par défaut (pour clipper ses propres coins
                arrondis) — sans cette surcharge, le panneau ouvert d'un `Dropdown` (positionné en
                `absolute`, plus haut que la carte elle-même) se retrouverait rogné par la carte
                parente. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <Dropdown
                label={t("kpi.filterAxis")}
                placeholder={t("kpi.filterAll")}
                value={rmAxis}
                onChange={(v) => setRoadmapParam("rmAxis", v)}
                options={roadmapAxisOptions}
                allowClear
              />
              <Dropdown
                label={t("kpi.filterChantier")}
                placeholder={t("kpi.filterAll")}
                value={rmChantier}
                onChange={(v) => setRoadmapParam("rmChantier", v)}
                groups={roadmapChantierGroups}
                allowClear
              />
              <Dropdown
                label={t("kpi.filterOwner")}
                placeholder={t("kpi.filterAll")}
                value={rmOwner}
                onChange={(v) => setRoadmapParam("rmOwner", v)}
                options={roadmapOwnerOptions}
                allowClear
              />
            </div>
          </CardBody>
        </Card>

        <div className="mt-4">
          <ProgramRoadmap
            axes={axes}
            chantiers={roadmapChantiers}
            actions={roadmapActions}
            onLevierClick={openChantierPanel}
            onChantierClick={(chantierId) => openChantierPanel(chantierId)}
            renderAxisHeader={(axis) => renderAxisRoadmapHeader(axis)}
            labels={roadmapLabels}
          />
        </div>
      </div>

      {/* Donut de répartition budgétaire de l'axe par chantier (en-tête riche de la feuille de
          route) — un slice par chantier de l'axe ayant un budget alloué non nul
          (`budgetDonutSlices`). Cliquer un slice ferme cette modale et ouvre le panneau du
          chantier correspondant. */}
      <Modal
        open={!!budgetDonutAxisId}
        onOpenChange={(open) => {
          if (!open) setBudgetDonutAxisId(null);
        }}
        title={t("strategicAxes.budgetByChantierModalTitle")}
        maxWidth="560px"
      >
        {budgetDonutAxisId && budgetDonutSlices && budgetDonutSlices.length > 0 && (
          <BudgetDonutChart
            data={budgetDonutSlices}
            formatValue={(value) => `${value.toLocaleString()} ${activeProgram?.currency ?? ""}`}
            onSliceClick={(name) => {
              const chantierId = resolveChantierIdByName(budgetDonutAxisId, name);
              setBudgetDonutAxisId(null);
              if (chantierId) openChantierPanel(chantierId);
            }}
          />
        )}
      </Modal>

      {/* ── Panneau chantier inline (round 10, point 1) — même Modal que `StrategicAxesView.tsx`
          (1100px), pour rester sur le dashboard au lieu de naviguer vers `/levers`. ─────────── */}
      <Modal
        open={!!openChantierId}
        onOpenChange={(open) => {
          if (!open) closeChantierPanel();
        }}
        title={openChantierEntity?.name ?? t("strategicChantierDetail.title")}
        maxWidth="1100px"
      >
        {openChantierId && (
          <ChantierDetailPanel
            chantierId={openChantierId}
            focusActionId={focusActionId}
            onClose={closeChantierPanel}
          />
        )}
      </Modal>
    </div>
  );
}
