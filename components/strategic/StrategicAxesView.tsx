"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Rows3 } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { BudgetVsActualBar } from "@/components/shared/BudgetVsActualBar";
import { Card, CardBody } from "@/components/shared/Card";
import { Dropdown, type DropdownGroup, type DropdownOption } from "@/components/shared/Dropdown";
import { Modal } from "@/components/shared/Modal";
import {
  BudgetDonutChart,
  type BudgetDonutSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { AxisKanban } from "@/components/strategic/AxisKanban";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import { ProgramRoadmap } from "@/components/strategic/ProgramRoadmap";
import { StrategicImportButton } from "@/components/strategic/StrategicImportButton";
import { numberIndicators, resolveChantierOwner, resolveIndicatorStatus } from "@/lib/axisLogic";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { saveChantierAction } from "@/lib/firestore/chantierActions";
import { saveChantier } from "@/lib/firestore/chantiers";
import { saveIndicator } from "@/lib/firestore/indicators";
import { saveStrategicAxis } from "@/lib/firestore/strategicAxes";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { StrategicImportPreview } from "@/lib/strategicExcelImport";
import type { Chantier, Indicator, LevierKanbanStatus, MilestoneId, StrategicAxis } from "@/types";

/** Nombre de puces numérotées d'indicateur affichées sur une carte d'axe (vue "cartes", round 6,
 *  point 3) avant repli sur une puce "+N". */
const MAX_CARD_INDICATOR_CHIPS = 5;

/**
 * Page « Axes stratégiques » — portefeuille des axes du programme actif, servie sur la MÊME route
 * que la bibliothèque des leviers (`/levers`, voir le routeur `app/(app)/levers/page.tsx`) : c'est
 * l'équivalent stratégique de `LeversPagePerformance`, dont elle reprend la structure (barre de
 * filtres persistés dans l'URL + bascule de vues + modale de création).
 *
 * Elle N'EST PAS un rendu paramétré de la page leviers : un axe n'a ni code, ni montant, ni
 * workstream, ni risque calculé — les colonnes du tableau levier n'auraient presque aucun
 * équivalent. On garde donc une grille de cartes (lecture rapide d'un portefeuille de ~5 axes,
 * volumétrie visée par la méthodologie 3-5-15) plutôt qu'un `EditableTable` à trois colonnes.
 *
 * Deux vues, deux mailles de lecture volontairement distinctes, toutes deux à la maille AXE
 * (portefeuille) :
 *  - « cartes » : lecture large d'un axe (description, indicateurs, comptes) ;
 *  - « kanban » (`AxisKanban`, libellé affiché "Avancement des chantiers", round 9, points 3/9) :
 *    descend d'un cran par CHANTIER, sous forme de compteurs compacts par jalon E0→E4 (+ résumé
 *    kanban classique pour les leviers sans KPI), avec drill-down cliquable listant les leviers de
 *    l'axe à un jalon/statut donné — remplace l'ancien onglet "Chantiers" (round 6-8, cartes par
 *    chantier + filtres Direction/Personne/Sponsor), jugé redondant avec cette vue enrichie.
 *
 * Le clic sur un axe pousse `/levers/detail?id=<axisId>` — même motif d'URL que les leviers, ce
 * qui laisse `LeverDetailClient` aiguiller vers `AxisDetailClient` selon le type de programme. Le
 * clic sur un chantier ouvre le panneau chantier (`ChantierDetailPanel`, round 6, point 0) SUR
 * CETTE MÊME page via `?chantier=<chantierId>` (et `&action=` si ciblé) — remplace l'ancienne
 * navigation vers la route dédiée `/levers/chantier?id=…` (round 4, point 9).
 */
export function StrategicAxesView() {
  const { user } = useRole();
  const { activeProgram, activeProgramId, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const data = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);
  const [newAxisOpen, setNewAxisOpen] = useState(false);

  /** Axe dont le donut de répartition budgétaire (round 12, vue "Cartes") est actuellement ouvert —
   *  `null` = modale fermée. On ne stocke que l'id : les chantiers/le budget de l'axe sont
   *  recalculés depuis `chantiersByAxis` (ci-dessous) plutôt que capturés au clic, pour rester à
   *  jour si les données changent pendant que la modale est ouverte. */
  const [budgetDonutAxisId, setBudgetDonutAxisId] = useState<string | null>(null);

  // Échelle de confidentialité de l'entreprise — pour le sélecteur du formulaire de création d'axe
  // (même pattern que `components/shared/LeverForm.tsx`, voir `AxisForm`).
  const [confidentialityLevels, setConfidentialityLevels] = useState<string[]>([]);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setConfidentialityLevels(company?.confidentialityLevels ?? []);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);
  const [view, setView] = useState<"roadmap" | "kanban">("roadmap");

  /**
   * Numéro global unique par indicateur (round 10, fondation `lib/axisLogic.ts`) — SEUL point de
   * vérité pour la numérotation des puces d'indicateur de la vue « cartes » ci-dessous, partagé
   * avec `KpiPageClient.tsx` pour qu'un même indicateur affiche toujours le même numéro sur toute
   * la plateforme.
   */
  const globalIndicatorNumbers = useMemo(
    () => numberIndicators(data.axes, data.chantiers, data.indicators),
    [data.axes, data.chantiers, data.indicators]
  );

  // Chantiers regroupés par axe, dans l'ordre de `data.chantiers` (déjà trié par le hook) — alimente
  // exclusivement `AxisKanban` (vue "Avancement des chantiers", round 9), qui imbrique les chantiers
  // de chaque axe plutôt que de bucketer les axes eux-mêmes par étape.
  const chantiersByAxis = useMemo(() => {
    const map = new Map<string, Chantier[]>();
    for (const chantier of data.chantiers) {
      const list = map.get(chantier.axisId);
      if (list) list.push(chantier);
      else map.set(chantier.axisId, [chantier]);
    }
    return map;
  }, [data.chantiers]);

  /** Budget alloué total d'un axe (round 10, point 3) — somme de `Chantier.allocatedBudget` sur les
   *  chantiers de l'axe (`chantiersByAxis` ci-dessus), affiché sur la carte d'axe de la vue
   *  « cartes ». Nouveau calcul purement local, aucune donnée supplémentaire à charger. */
  const axisBudgetByAxis = useMemo(() => {
    const map = new Map<string, number>();
    chantiersByAxis.forEach((chantiers, axisId) => {
      map.set(
        axisId,
        chantiers.reduce((sum, chantier) => sum + (chantier.allocatedBudget ?? 0), 0)
      );
    });
    return map;
  }, [chantiersByAxis]);

  /** Budget CONSOMMÉ total d'un axe — pendant de `axisBudgetByAxis` ci-dessus mais sommant
   *  `Chantier.consumedBudget` (déclaratif, saisi manuellement) plutôt que `allocatedBudget`, sur
   *  le MÊME ensemble de chantiers (`chantiersByAxis`), pour alimenter `BudgetVsActualBar` sur la
   *  carte d'axe. */
  const axisConsumedByAxis = useMemo(() => {
    const map = new Map<string, number>();
    chantiersByAxis.forEach((chantiers, axisId) => {
      map.set(
        axisId,
        chantiers.reduce((sum, chantier) => sum + (chantier.consumedBudget ?? 0), 0)
      );
    });
    return map;
  }, [chantiersByAxis]);

  /** Parts du donut budgétaire (round 12) de l'axe actuellement ouvert (`budgetDonutAxisId`) — un
   *  slice par chantier de l'axe AYANT un budget alloué non nul (les chantiers sans budget sont
   *  exclus du donut, ils n'apporteraient qu'une part nulle sans intérêt). `null` tant qu'aucune
   *  modale n'est ouverte. */
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

  // Indicateurs regroupés par axe (macro ET de chantier confondus) — alimente les puces numérotées
  // de la vue « cartes » (round 6, point 3 ; numérotation globalisée round 10).
  const indicatorsByAxis = useMemo(() => {
    const map = new Map<string, Indicator[]>();
    for (const indicator of data.indicators) {
      const list = map.get(indicator.axisId);
      if (list) list.push(indicator);
      else map.set(indicator.axisId, [indicator]);
    }
    return map;
  }, [data.indicators]);

  /**
   * Leviers rattachés à un KPI (`indicatorId` défini) — seuls ceux-là portent un jalon E0-E4
   * significatif (`ChantierAction.milestones.currentMilestone`, round 8). Alimente à la fois les
   * OPTIONS du filtre "Jalon" (round 9, point 9, ci-dessous) et son filtrage réel.
   */
  const milestoneTrackedActions = useMemo(
    () => data.chantierActions.filter((a) => a.indicatorId),
    [data.chantierActions]
  );

  /**
   * Leviers SANS KPI (`indicatorId` absent, round 12) — le pendant "Statut kanban" de
   * `milestoneTrackedActions` ci-dessus. Ces leviers n'ont pas de jalon E0-E4 significatif, seul
   * `kanbanStatus` (todo/in_progress/done) les décrit ; jusqu'ici aucun filtre ne permettait de
   * repérer où ils en sont depuis cette vue "Avancement des chantiers".
   */
  const kanbanTrackedActions = useMemo(
    () => data.chantierActions.filter((a) => !a.indicatorId),
    [data.chantierActions]
  );

  /**
   * Filtre "Jalon" E0-E4 (round 9, points 3/9 ; migré de `FilterBar` vers `Dropdown` round 14) —
   * SCOPÉ à l'onglet "Avancement des chantiers" uniquement, TECHNIQUEMENT indépendant du filtre
   * "Responsable" ci-dessous (entités et persistances différentes). État purement local (pas
   * d'URL) : comme l'ancien filtre chantier qu'il remplace en partie, il ne s'applique qu'à un
   * seul onglet et n'a pas besoin d'être partageable par lien.
   *
   * Filtre les CHANTIERS affichés dans `AxisKanban` : un chantier reste visible si au moins un de
   * ses leviers rattachés à un KPI est actuellement à ce jalon (logique implémentée dans
   * `AxisKanban` lui-même via la prop `milestoneFilter`, ce composant ne fait que porter l'état +
   * le `Dropdown`). `Dropdown` étant à sélection UNIQUE (contrairement à `FilterBar`), l'état est
   * un simple `MilestoneId | null` plutôt qu'un tableau de valeurs cochées.
   */
  const [selectedMilestone, setSelectedMilestone] = useState<MilestoneId | null>(null);

  /**
   * Filtre "Statut kanban" (round 12 ; migré vers `Dropdown` round 14) — même mécanisme que
   * `selectedMilestone` ci-dessus mais pour les leviers SANS KPI (`kanbanTrackedActions`). Filtre
   * les CHANTIERS affichés dans `AxisKanban` : un chantier reste visible si au moins un de ses
   * leviers sans KPI est à ce statut (logique dans `AxisKanban` via la prop `kanbanFilter`).
   */
  const [selectedKanbanStatus, setSelectedKanbanStatus] = useState<LevierKanbanStatus | null>(null);

  /** Nombre de leviers rattachés à un KPI par jalon E0-E4 (round 10, point 3) — précalculé pour
   *  suffixer les options du `Dropdown` "Jalon" du compte (ex. "E0 (6)"), convention déjà en place
   *  avant la migration `FilterBar` → `Dropdown` (round 14). */
  const milestoneCounts = useMemo(() => {
    const map = new Map<MilestoneId, number>();
    for (const action of milestoneTrackedActions) {
      const milestoneId = action.milestones?.currentMilestone ?? "E0";
      map.set(milestoneId, (map.get(milestoneId) ?? 0) + 1);
    }
    return map;
  }, [milestoneTrackedActions]);

  /** Options du `Dropdown` "Jalon" — un jalon par `MilestoneId` (E0→E4, ordre fixe), libellé
   *  suffixé du compte comme avant round 14. La `value` est directement le `MilestoneId` (plus
   *  besoin de le retrouver par découpage de chaîne, contrairement à l'ancien `FilterBar`). */
  const milestoneOptions: DropdownOption[] = useMemo(
    () =>
      (["E0", "E1", "E2", "E3", "E4"] as MilestoneId[]).map((id) => ({
        value: id,
        label: `${id} (${milestoneCounts.get(id) ?? 0})`,
      })),
    [milestoneCounts]
  );

  const activeMilestones = selectedMilestone ? [selectedMilestone] : [];

  /** Nombre de leviers SANS KPI par statut kanban (round 12) — même rôle que `milestoneCounts`,
   *  précalculé pour suffixer les options du `Dropdown` "Statut kanban" (ex. "En cours (3)"). */
  const kanbanCounts = useMemo(() => {
    const map = new Map<LevierKanbanStatus, number>();
    for (const action of kanbanTrackedActions) {
      const status = action.kanbanStatus ?? "todo";
      map.set(status, (map.get(status) ?? 0) + 1);
    }
    return map;
  }, [kanbanTrackedActions]);

  /** Libellé traduit par statut kanban — mêmes clés i18n que `ChantierDetailPanel`/`AxisKanban`
   *  (vocabulaire déjà unifié dans l'app, voir doc-comment d'`AxisKanban.tsx`). */
  const kanbanStatusLabel = useMemo<Record<LevierKanbanStatus, string>>(
    () => ({
      todo: t("strategicChantierDetail.kanban.todo"),
      in_progress: t("strategicChantierDetail.kanban.inProgress"),
      done: t("strategicChantierDetail.kanban.done"),
    }),
    [t]
  );

  /** Options du `Dropdown` "Statut kanban" — la `value` est directement le `LevierKanbanStatus`
   *  (todo/in_progress/done), le libellé traduit + suffixé du compte comme avant round 14. */
  const kanbanOptions: DropdownOption[] = useMemo(
    () =>
      (["todo", "in_progress", "done"] as LevierKanbanStatus[]).map((status) => ({
        value: status,
        label: `${kanbanStatusLabel[status]} (${kanbanCounts.get(status) ?? 0})`,
      })),
    [kanbanCounts, kanbanStatusLabel]
  );

  const activeKanbanStatuses = selectedKanbanStatus ? [selectedKanbanStatus] : [];

  /**
   * Filtre "Responsable" (migré de `FilterBar` vers `Dropdown` round 14) — persisté dans l'URL sous
   * le paramètre `owner`, même convention que `KpiPageClient.tsx` (round 13) : un lien vers une vue
   * filtrée reste partageable et survit à un rafraîchissement. `Dropdown` étant à sélection UNIQUE,
   * une simple valeur `string | null` suffit — plus besoin du méli-mélo `openFilterKeys`/
   * `activeFilters` qu'imposait `FilterBar` (multi-select, préfixe `f_`) pour ce même filtre.
   */
  const selectedOwner = searchParams.get("owner");

  const ownerOptions: DropdownOption[] = useMemo(() => {
    const names = new Set(data.axes.map((a) => a.owner ?? t("strategicAxes.unassigned")));
    return Array.from(names)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [data.axes, t]);

  const setOwnerFilter = (value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("owner", value);
    else params.delete("owner");
    const qs = params.toString();
    router.replace(qs ? `/levers?${qs}` : "/levers");
  };

  const filteredAxes = useMemo(
    () =>
      data.axes.filter((axis) => {
        if (!selectedOwner) return true;
        return (axis.owner ?? t("strategicAxes.unassigned")) === selectedOwner;
      }),
    [data.axes, selectedOwner, t]
  );

  /**
   * Filtres "Axe" / "Chantier" / "Responsable" de l'onglet "Feuille de route" (round 16) — même
   * patron que les 3 dropdowns équivalents de `KpiPageClient.tsx` (URL-persistés, portée en
   * cascade, garde-fou de cohérence après chargement des données), mais SCOPÉS à cet onglet et
   * namespacés `rmAxis`/`rmChantier`/`rmOwner` : cette page utilise déjà `?owner=` pour le filtre
   * Responsable de l'onglet "Cartes" (ci-dessus) et `?chantier=`/`&action=` pour l'état d'ouverture
   * du panneau chantier (`openChantierPanel` plus bas) — réutiliser ces noms corromprait l'un des
   * deux mécanismes en modifiant l'autre.
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
      router.replace(qs ? `/levers?${qs}` : "/levers", { scroll: false });
    },
    [router, searchParams]
  );

  const roadmapAxisOptions: DropdownOption[] = useMemo(
    () => data.axes.map((axis) => ({ value: axis.id, label: axis.name })),
    [data.axes]
  );

  // Portée par `rmAxis` — même logique de scoping que `chantierGroups` de `KpiPageClient.tsx` :
  // quand un axe est sélectionné, ne proposer que SES chantiers.
  const roadmapChantierGroups: DropdownGroup[] = useMemo(
    () =>
      data.axes
        .filter((axis) => !rmAxis || axis.id === rmAxis)
        .map((axis) => ({
          groupLabel: axis.name,
          options: data.chantiers
            .filter((c) => c.axisId === axis.id)
            .map((c) => ({ value: c.id, label: c.name })),
        }))
        .filter((group) => group.options.length > 0),
    [data.axes, data.chantiers, rmAxis]
  );

  // Portée par `rmAxis`/`rmChantier` — même logique que `ownerOptions` de `KpiPageClient.tsx`, mais
  // résolue par CHANTIER (`resolveChantierOwner`) plutôt que par indicateur : ce filtre alimente une
  // vue par levier, sans indicateur à résoudre.
  const roadmapOwnerOptions: DropdownOption[] = useMemo(() => {
    const scoped = data.chantiers.filter((c) => {
      if (rmAxis && c.axisId !== rmAxis) return false;
      if (rmChantier && c.id !== rmChantier) return false;
      return true;
    });
    const names = new Set(
      scoped.map((c) => resolveChantierOwner(c, data.axes, t("strategicAxes.unassigned")))
    );
    return Array.from(names)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [data.chantiers, data.axes, t, rmAxis, rmChantier]);

  // Garde-fou de cohérence (même patron que `KpiPageClient.tsx`) : si le changement d'axe rend le
  // chantier ou le responsable actuellement sélectionné invalide, on le réinitialise — UN seul
  // `router.replace` pour les deux, pour ne pas laisser un effet écraser la suppression de l'autre.
  useEffect(() => {
    if (data.loading) return;

    const chantier = rmChantier ? data.chantiers.find((c) => c.id === rmChantier) : null;
    const chantierInvalid = !!rmChantier && (!chantier || (!!rmAxis && chantier.axisId !== rmAxis));

    const validOwners = new Set(roadmapOwnerOptions.map((o) => o.value));
    const ownerInvalid = !!rmOwner && !validOwners.has(rmOwner);

    if (!chantierInvalid && !ownerInvalid) return;

    const params = new URLSearchParams(searchParams.toString());
    if (chantierInvalid) params.delete("rmChantier");
    if (ownerInvalid) params.delete("rmOwner");
    const qs = params.toString();
    router.replace(qs ? `/levers?${qs}` : "/levers", { scroll: false });
  }, [
    rmAxis,
    rmChantier,
    rmOwner,
    data.chantiers,
    data.loading,
    roadmapOwnerOptions,
    searchParams,
    router,
  ]);

  const roadmapChantiers = useMemo(
    () =>
      data.chantiers.filter((chantier) => {
        if (rmAxis && chantier.axisId !== rmAxis) return false;
        if (rmChantier && chantier.id !== rmChantier) return false;
        if (
          rmOwner &&
          resolveChantierOwner(chantier, data.axes, t("strategicAxes.unassigned")) !== rmOwner
        )
          return false;
        return true;
      }),
    [data.chantiers, data.axes, t, rmAxis, rmChantier, rmOwner]
  );

  const roadmapActions = useMemo(() => {
    const survivingIds = new Set(roadmapChantiers.map((c) => c.id));
    return data.chantierActions.filter((action) => survivingIds.has(action.chantierId));
  }, [data.chantierActions, roadmapChantiers]);

  const openAxis = (axisId: string) => router.push(`/levers/detail?id=${axisId}`);

  /** Panneau chantier (round 6, point 0 — remplace l'ancienne route `/levers/chantier?id=…`) : ouvre
   *  en posant `?chantier=<id>` (et `&action=<id>` si ciblé) sur CETTE MÊME page, `router.push` pour
   *  que l'ouverture reste dans l'historique (le bouton "retour" du navigateur referme le panneau).
   *  Les autres paramètres déjà présents dans l'URL (filtres `f_`/`cf_`, vue active…) sont préservés. */
  const openChantierPanel = (chantierId: string, focusActionId?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("chantier", chantierId);
    if (focusActionId) params.set("action", focusActionId);
    else params.delete("action");
    router.push(`/levers?${params.toString()}`);
  };

  /** Ferme le panneau chantier — `router.replace` (pas `push`) pour ne pas empiler une entrée
   *  d'historique par fermeture, cohérent avec `setFilters` ci-dessus. */
  const closeChantierPanel = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("chantier");
    params.delete("action");
    const qs = params.toString();
    router.replace(qs ? `/levers?${qs}` : "/levers");
  };

  const openChantierId = searchParams.get("chantier");
  const focusActionId = searchParams.get("action") ?? undefined;
  const openChantierEntity = openChantierId
    ? data.chantiers.find((c) => c.id === openChantierId)
    : undefined;

  /**
   * En-tête riche d'axe de l'onglet "Feuille de route" (round 16) — reprend TEL QUEL le contenu
   * informatif de l'ancienne carte d'axe de la vue "Cartes" (pastille couleur + nom + responsable,
   * description, puces d'indicateur numérotées, budget alloué + `BudgetVsActualBar`), SANS la liste
   * plate de chantiers qui suivait : `ProgramRoadmap` liste déjà les chantiers de l'axe lui-même
   * (désormais cliquables via sa prop `onChantierClick`), la dupliquer ici serait redondant.
   *
   * Passé à `ProgramRoadmap` via sa prop `renderAxisHeader` — appelé par `ProgramRoadmap` une fois
   * par axe affiché, jamais directement par ce composant.
   *
   * Le nom de l'axe reste cliquable (`openAxis`) : c'était auparavant le rôle de la carte entière
   * (`role="button"`, retirée avec la liste de chantiers) — sans ce bouton, le point d'entrée "clic
   * sur un axe → sa fiche détail" disparaîtrait silencieusement de cet onglet. Les gestionnaires de
   * clic des puces d'indicateur et du montant de budget n'ont plus besoin de `e.stopPropagation()` :
   * il n'y a plus de wrapper cliquable englobant dont il faudrait bloquer la remontée d'événement.
   */
  const renderAxisRoadmapHeader = (axis: StrategicAxis): ReactNode => {
    // Triés par numéro global ascendant (`globalIndicatorNumbers`) AVANT le slice — même tri que
    // l'ancienne carte, voir son doc-comment historique.
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

  /**
   * Écrit les entités validées par `StrategicImportButton` (round 4, point 3) — la librairie
   * d'import (`lib/strategicExcelImport.ts`) reste pure et n'appelle jamais Firestore, c'est donc
   * ICI, dans l'appelant, qu'on boucle sur les `save*` déjà existants. Les ids sont déjà alloués
   * par l'importeur (voir doc-comment en tête de ce fichier) : un `Promise.all` global suffit,
   * l'ordre d'écriture n'a aucune incidence (Firestore n'impose aucune contrainte d'intégrité
   * référentielle). En cas d'erreur, l'exception remonte telle quelle à `StrategicImportButton`,
   * qui affiche déjà son propre toast d'échec — pas de gestion d'erreur dupliquée ici. Les
   * abonnements `onSnapshot` de `useStrategicData` reprennent la main automatiquement, sans état
   * local à rafraîchir.
   */
  const handleImport = async (toCreate: StrategicImportPreview["toCreate"]) => {
    await Promise.all([
      ...toCreate.axes.map((axis) => saveStrategicAxis(axis)),
      ...toCreate.chantiers.map((chantier) => saveChantier(chantier)),
      ...toCreate.actions.map((action) => saveChantierAction(action)),
      ...toCreate.indicators.map((indicator) => saveIndicator(indicator)),
    ]);
  };

  if (!programsLoading && !activeProgramId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        {t("strategicAxes.noProgram")}
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("strategicAxes.title")}
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {filteredAxes.length} {t("strategicAxes.count")} · {data.chantiers.length}{" "}
            {t("strategicAxes.chantiersCount")} · {data.indicators.length}{" "}
            {t("strategicAxes.indicatorsCount")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StrategicImportButton
            data={{
              axes: data.axes,
              chantiers: data.chantiers,
              actions: data.chantierActions,
              indicators: data.indicators,
            }}
            companyId={user?.companyId}
            programId={activeProgramId}
            maturityStages={stages}
            onImport={handleImport}
          />
          <Button variant="primary" onClick={() => setNewAxisOpen(true)}>
            <Plus size={13} /> {t("strategicAxes.newAxis")}
          </Button>
        </div>
      </div>

      <Modal
        open={newAxisOpen}
        onOpenChange={setNewAxisOpen}
        title={t("strategicAxes.newAxisModalTitle")}
        maxWidth="640px"
      >
        <AxisForm
          stages={stages}
          confidentialityLevels={confidentialityLevels}
          submitLabel={t("strategicAxes.createAxis")}
          onCancel={() => setNewAxisOpen(false)}
          onSubmit={async (values: AxisFormValues) => {
            const created = await data.createAxis(values);
            setNewAxisOpen(false);
            showToast(t("strategicAxes.axisCreated"), created.name, "success");
            openAxis(created.id);
          }}
        />
      </Modal>

      <Card className="overflow-visible">
        <CardBody flush>
          {/* Filtres — DEUX jeux mutuellement exclusifs, jamais affichés ensemble (round 16) :
              "Responsable" + "Jalon" + "Statut kanban" pour l'onglet "Cartes" (ex-"Avancement des
              chantiers", voir doc-comments de `selectedOwner`/`selectedMilestone`/
              `selectedKanbanStatus`) ; "Axe" + "Chantier" + "Responsable" (namespacés `rm*`, voir
              doc-comment de `rmAxis` plus haut) pour l'onglet "Feuille de route". Montrer les deux
              en même temps laisserait deux dropdowns "Responsable" différemment scopés visibles à la
              fois — source de confusion.
              `overflow-visible` (round 14, correctif) : `Card` applique `overflow-hidden` par
              défaut (pour clipper ses propres coins arrondis) — sans cette surcharge, le panneau
              ouvert d'un `Dropdown` (positionné en `absolute`, plus haut que la carte elle-même)
              se retrouvait rogné à quelques pixels par la carte parente, ne laissant apparaître que
              la toute première option ("Tous") du menu déroulant. Sans risque visuel ici : le
              contenu de cette carte (rangée de boutons) n'a pas besoin d'être clippé à son propre
              rayon de bordure. */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            {view === "kanban" && (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                  {t("strategicAxes.filterStageAndMilestone")}
                </span>
                <Dropdown
                  label={t("strategicAxes.filterOwner")}
                  placeholder={t("kpi.filterAll")}
                  value={selectedOwner}
                  onChange={setOwnerFilter}
                  options={ownerOptions}
                  allowClear
                />
                <Dropdown
                  label={t("strategicAxes.filterMilestone")}
                  placeholder={t("kpi.filterAll")}
                  value={selectedMilestone}
                  onChange={(v) => setSelectedMilestone(v as MilestoneId | null)}
                  options={milestoneOptions}
                  allowClear
                />
                <Dropdown
                  label={t("strategicAxes.filterKanban")}
                  placeholder={t("kpi.filterAll")}
                  value={selectedKanbanStatus}
                  onChange={(v) => setSelectedKanbanStatus(v as LevierKanbanStatus | null)}
                  options={kanbanOptions}
                  allowClear
                />
              </>
            )}
            {view === "roadmap" && (
              <>
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
              </>
            )}
            <div className="ml-auto flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => setView("roadmap")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                  view === "roadmap" ? "bg-black text-white" : "bg-white text-secondary"
                }`}
              >
                <Rows3 size={13} /> {t("strategicAxes.roadmapTab")}
              </button>
              <button
                onClick={() => setView("kanban")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                  view === "kanban" ? "bg-black text-white" : "bg-white text-secondary"
                }`}
              >
                <LayoutGrid size={13} /> {t("strategicAxes.cardsTab")}
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {data.loading ? (
        <div className="rounded-lg border border-border bg-white p-10 text-center text-sm text-tertiary">
          {t("strategicAxes.loading")}
        </div>
      ) : filteredAxes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
          <div className="text-sm font-semibold text-primary">{t("strategicAxes.empty")}</div>
          <div className="mt-1 text-[13px]">{t("strategicAxes.emptyHint")}</div>
        </div>
      ) : view === "kanban" ? (
        <AxisKanban
          axes={filteredAxes}
          chantiersByAxis={chantiersByAxis}
          chantierActions={data.chantierActions}
          onCardClick={openAxis}
          onOpenChantier={openChantierPanel}
          milestoneFilter={activeMilestones}
          kanbanFilter={activeKanbanStatuses}
          currency={activeProgram?.currency}
          labels={{
            emptyAxisChantiers: t("strategicAxes.axisNoChantier"),
            filteredEmptyAxisChantiers: t("strategicAxes.kanbanFilteredEmpty"),
            chantiers: t("strategicAxes.chantiersCount"),
            noLeviers: t("strategicAxes.kanbanNoLeviers"),
            kanbanBadgePrefix: t("strategicAxes.kanbanBadgePrefix"),
            kanbanStatusLabels: {
              todo: t("strategicChantierDetail.kanban.todo"),
              in_progress: t("strategicChantierDetail.kanban.inProgress"),
              done: t("strategicChantierDetail.kanban.done"),
            },
            drilldownTitlePrefix: t("strategicAxes.kanbanDrilldownTitle"),
            drilldownEmpty: t("strategicAxes.kanbanDrilldownEmpty"),
            budgetByLevierModalTitle: t("strategicAxes.budgetByLevierModalTitle"),
            budgetUnallocated: t("strategicAxes.budgetUnallocated"),
          }}
        />
      ) : (
        // Onglet "Feuille de route" (round 16) — remplace l'ancienne grille de cartes par axe :
        // `ProgramRoadmap` groupe déjà lui-même ses lignes par axe puis par chantier, l'en-tête
        // riche de chaque axe (dot/nom/owner/description/indicateurs/budget) lui est réinjecté via
        // `renderAxisHeader`, le clic sur un chantier/levier/livrable rouvre le panneau chantier.
        <ProgramRoadmap
          axes={data.axes}
          chantiers={roadmapChantiers}
          actions={roadmapActions}
          onLevierClick={openChantierPanel}
          onChantierClick={(chantierId) => openChantierPanel(chantierId)}
          renderAxisHeader={(axis) => renderAxisRoadmapHeader(axis)}
          labels={{
            empty: t("strategicAxes.roadmap.empty"),
            scale: t("strategicAxes.roadmap.scale"),
            scaleQuarter: t("strategicAxes.roadmap.scaleQuarter"),
            scaleSemester: t("strategicAxes.roadmap.scaleSemester"),
            scaleYear: t("strategicAxes.roadmap.scaleYear"),
            progress: t("strategicAxes.roadmap.progress"),
            today: t("strategicAxes.ganttToday"),
            leviersSuffix: t("strategicAxes.roadmap.leviersSuffix"),
          }}
        />
      )}

      {/* Donut de répartition budgétaire de l'axe par chantier (round 12, vue "Cartes") — un slice
          par chantier de l'axe ayant un budget alloué non nul (`budgetDonutSlices`). Cliquer un
          slice ferme cette modale et ouvre le panneau du chantier correspondant. */}
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

      {/* ── Panneau chantier (round 6, point 0) — remplace l'ancienne route dédiée, monté dans un
          Modal plus large que les modales de formulaire (1100px) pour porter tout le détail chantier
          (jalons, RACI, effort, timeline…) sans rien couper. ────────────────────────────────── */}
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
