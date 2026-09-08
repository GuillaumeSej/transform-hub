"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Rows3 } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody } from "@/components/shared/Card";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import { Modal } from "@/components/shared/Modal";
import { AtRiskCountPill } from "@/components/strategic/AtRiskCountPill";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { AxisKanban } from "@/components/strategic/AxisKanban";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { StrategicImportButton } from "@/components/strategic/StrategicImportButton";
import {
  computeIndicatorDelta,
  latestMeasurement,
  resolveIndicatorStatus,
  type IndicatorDelta,
} from "@/lib/axisLogic";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { saveChantierAction } from "@/lib/firestore/chantierActions";
import { saveChantier } from "@/lib/firestore/chantiers";
import { saveIndicator } from "@/lib/firestore/indicators";
import { saveStrategicAxis } from "@/lib/firestore/strategicAxes";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages, resolveMaturityStageLabel } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { StrategicImportPreview } from "@/lib/strategicExcelImport";
import type {
  Chantier,
  ChantierAction,
  Indicator,
  IndicatorMeasurement,
  MilestoneId,
  StrategicAxis,
} from "@/types";

/** Nombre de puces numérotées d'indicateur affichées sur une carte d'axe (vue "cartes", round 6,
 *  point 3) avant repli sur une puce "+N". */
const MAX_CARD_INDICATOR_CHIPS = 5;

/**
 * Indicateurs à risque D'UN AXE (macro + tous ses chantiers confondus), chacun avec son écart
 * calculé — pendant de `chantierAtRiskIndicators` (lib/axisLogic.ts) mais à la maille AXE, pour le
 * badge "N à risque" des cartes de portefeuille (vues "cartes" et "kanban") plutôt que la maille
 * chantier. Gardée LOCALE à ce fichier (pas dans `lib/axisLogic.ts`) : c'est un simple filtre
 * d'agrégation d'affichage, pas une règle métier partagée entre plusieurs écrans.
 */
function axisAtRiskIndicators(
  axisId: string,
  indicators: Indicator[],
  measurements: IndicatorMeasurement[]
): { indicator: Indicator; delta: IndicatorDelta | undefined }[] {
  return indicators
    .filter((indicator) => indicator.axisId === axisId)
    .filter((indicator) => resolveIndicatorStatus(indicator) === "at_risk")
    .map((indicator) => ({
      indicator,
      delta: computeIndicatorDelta(indicator, latestMeasurement(indicator.id, measurements)),
    }));
}

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
  const { activeProgramId, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const data = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);
  const [newAxisOpen, setNewAxisOpen] = useState(false);

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
  const [view, setView] = useState<"cards" | "kanban">("cards");

  // Compteurs par axe — chantiers, indicateurs, indicateurs à risque (statut EFFECTIF, surcharge
  // manuelle comprise, via resolveIndicatorStatus).
  const countsByAxis = useMemo(() => {
    const map = new Map<string, { chantiers: number; indicators: number; atRisk: number }>();
    for (const axis of data.axes) map.set(axis.id, { chantiers: 0, indicators: 0, atRisk: 0 });
    for (const chantier of data.chantiers) {
      const entry = map.get(chantier.axisId);
      if (entry) entry.chantiers += 1;
    }
    for (const indicator of data.indicators) {
      const entry = map.get(indicator.axisId);
      if (!entry) continue;
      entry.indicators += 1;
      if (resolveIndicatorStatus(indicator) === "at_risk") entry.atRisk += 1;
    }
    return map;
  }, [data.axes, data.chantiers, data.indicators]);

  const countsOf = (axisId: string) =>
    countsByAxis.get(axisId) ?? { chantiers: 0, indicators: 0, atRisk: 0 };

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

  // Indicateurs regroupés par axe (même maille que `countsByAxis.indicators`, macro ET de chantier
  // confondus) — alimente les puces numérotées de la vue « cartes » (round 6, point 3).
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
   * Filtre "Jalon" E0-E4 (round 9, points 3/9) — SCOPÉ à l'onglet "Avancement des chantiers"
   * uniquement, indépendant du filtre "Étape de maturité" ci-dessous (qui opère sur
   * `StrategicAxis.stage`, une entité différente des jalons de LEVIER). État purement local (pas
   * d'URL) : comme l'ancien filtre chantier qu'il remplace en partie, il ne s'applique qu'à un seul
   * onglet et n'a pas besoin d'être partageable par lien pour ce round.
   *
   * Filtre les CHANTIERS affichés dans `AxisKanban` : un chantier reste visible si au moins un de
   * ses leviers rattachés à un KPI est actuellement à l'un des jalons cochés (logique implémentée
   * dans `AxisKanban` lui-même via la prop `milestoneFilter`, ce composant ne fait que porter
   * l'état + le `FilterBar`).
   */
  const [milestoneFilters, setMilestoneFilters] = useState<ActiveFilters>({});

  const milestoneFilterDefs: FilterDef<ChantierAction>[] = useMemo(
    () => [
      {
        key: "jalon",
        label: t("strategicAxes.filterMilestone"),
        getValue: (a) => a.milestones?.currentMilestone ?? "E0",
      },
    ],
    [t]
  );

  const activeMilestones = (milestoneFilters["jalon"] ?? []) as MilestoneId[];

  // Filtres persistés dans l'URL sous le préfixe `f_`, exactement comme la page leviers — un lien
  // vers une vue filtrée reste partageable et survit à un rafraîchissement.
  const filterDefs: FilterDef<StrategicAxis>[] = useMemo(
    () => [
      {
        key: "f_stage",
        label: t("strategicAxes.filterStage"),
        getValue: (a) => resolveMaturityStageLabel(a.stage, stages),
      },
      {
        key: "f_owner",
        label: t("strategicAxes.filterOwner"),
        getValue: (a) => a.owner ?? t("strategicAxes.unassigned"),
      },
    ],
    [stages, t]
  );

  /**
   * Filtres OUVERTS mais encore sans valeur cochée — état purement local, indispensable au
   * fonctionnement des boutons « Étape de maturité » / « Responsable ».
   *
   * Bug corrigé : `FilterBar` signale l'ouverture d'un filtre en remontant `{ f_stage: [] }`, or
   * `setFilters` n'écrit dans l'URL que les clés AYANT des valeurs (`v.length > 0`) et
   * `activeFilters` était dérivé EXCLUSIVEMENT de l'URL. Un filtre ouvert-mais-vide n'avait donc
   * aucune représentation persistante : le clic était annulé au rendu suivant et le panneau de
   * valeurs ne s'affichait jamais — d'où l'impression que le bouton ne faisait rien.
   *
   * Les valeurs cochées, elles, restent dans l'URL (lien partageable, survit au rafraîchissement) :
   * seule l'ouverture — qui n'a pas à être partagée — vit en mémoire.
   */
  const [openFilterKeys, setOpenFilterKeys] = useState<string[]>([]);

  const activeFilters: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    for (const key of openFilterKeys) {
      if (filterDefs.some((def) => def.key === key)) result[key] = [];
    }
    // L'URL prime : un filtre porté par l'URL est ouvert ET pré-coché, même après un partage de lien.
    searchParams.forEach((value, key) => {
      if (filterDefs.some((def) => def.key === key)) result[key] = value.split(",").filter(Boolean);
    });
    return result;
  }, [searchParams, filterDefs, openFilterKeys]);

  const setFilters = (next: ActiveFilters) => {
    setOpenFilterKeys(Object.keys(next));
    const params = new URLSearchParams(searchParams.toString());
    Array.from(params.keys())
      .filter((k) => k.startsWith("f_"))
      .forEach((k) => params.delete(k));
    Object.entries(next).forEach(([k, v]) => {
      if (v.length > 0) params.set(k, v.join(","));
    });
    const qs = params.toString();
    router.replace(qs ? `/levers?${qs}` : "/levers");
  };

  const filteredAxes = useMemo(
    () =>
      data.axes.filter((axis) =>
        Object.entries(activeFilters).every(([key, values]) => {
          const def = filterDefs.find((d) => d.key === key);
          return !def || values.length === 0 || values.includes(def.getValue(axis));
        })
      ),
    [data.axes, activeFilters, filterDefs]
  );

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
   * Aperçu d'UN indicateur (round 6, point 3) — puces numérotées de la vue « cartes ». État
   * purement local (pas d'URL, contrairement au panneau chantier ci-dessus) : c'est un aperçu
   * rapide, pas une destination qu'on souhaite partager par lien. Même schéma que
   * `BusinessKpiCard` (`IndicatorStatusSummary.tsx`) — modale contenant `IndicatorChart` en vue
   * complète — mais l'état vit ICI (une seule modale partagée par toute la grille) plutôt que dans
   * chaque carte : les cartes d'axe sont produites par un simple `.map()`, pas des composants à
   * part entière, donc pas d'endroit pour un `useState` par carte.
   */
  const [openIndicatorId, setOpenIndicatorId] = useState<string | null>(null);
  const openIndicator = openIndicatorId
    ? data.indicators.find((i) => i.id === openIndicatorId)
    : undefined;
  const openIndicatorMeasurements = useMemo(
    () => data.measurements.filter((m) => m.indicatorId === openIndicatorId),
    [data.measurements, openIndicatorId]
  );

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

      <Card>
        <CardBody flush>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <FilterBar
              items={data.axes}
              defs={filterDefs}
              active={activeFilters}
              onChange={setFilters}
            />
            <div className="ml-auto flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => setView("cards")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                  view === "cards" ? "bg-black text-white" : "bg-white text-secondary"
                }`}
              >
                <Rows3 size={13} /> {t("strategicAxes.cards")}
              </button>
              <button
                onClick={() => setView("kanban")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                  view === "kanban" ? "bg-black text-white" : "bg-white text-secondary"
                }`}
              >
                <LayoutGrid size={13} /> {t("strategicAxes.kanban")}
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
        <div className="flex flex-col gap-3">
          {/* Filtre "Jalon" E0-E4 (round 9, points 3/9) — scopé à cet onglet, indépendant du filtre
              "Étape de maturité" ci-dessus (voir doc-comment de `milestoneFilters`). */}
          <Card>
            <CardBody flush>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <FilterBar
                  items={milestoneTrackedActions}
                  defs={milestoneFilterDefs}
                  active={milestoneFilters}
                  onChange={setMilestoneFilters}
                />
              </div>
            </CardBody>
          </Card>
          <AxisKanban
            axes={filteredAxes}
            stages={stages}
            chantiersByAxis={chantiersByAxis}
            chantierActions={data.chantierActions}
            onCardClick={openAxis}
            onOpenChantier={openChantierPanel}
            atRiskItemsOf={(axisId) =>
              axisAtRiskIndicators(axisId, data.indicators, data.measurements)
            }
            milestoneFilter={activeMilestones}
            labels={{
              emptyAxisChantiers: t("strategicAxes.axisNoChantier"),
              filteredEmptyAxisChantiers: t("strategicAxes.kanbanFilteredEmpty"),
              chantiers: t("strategicAxes.chantiersCount"),
              atRisk: t("strategicAxes.atRiskCount"),
              atRiskPopoverTitle: t("strategicAxes.atRiskPopoverTitle"),
              atRiskTooltip: t("strategicAxes.atRiskTooltip"),
              progress: t("kpi.chart.progressToTarget"),
              noLeviers: t("strategicAxes.kanbanNoLeviers"),
              kanbanBadgePrefix: t("strategicAxes.kanbanBadgePrefix"),
              kanbanStatusLabels: {
                todo: t("strategicChantierDetail.kanban.todo"),
                in_progress: t("strategicChantierDetail.kanban.inProgress"),
                done: t("strategicChantierDetail.kanban.done"),
              },
              drilldownTitlePrefix: t("strategicAxes.kanbanDrilldownTitle"),
              drilldownEmpty: t("strategicAxes.kanbanDrilldownEmpty"),
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAxes.map((axis) => {
            const c = countsOf(axis.id);
            const axisIndicators = indicatorsByAxis.get(axis.id) ?? [];
            const shownIndicators = axisIndicators.slice(0, MAX_CARD_INDICATOR_CHIPS);
            const hiddenIndicatorsCount = axisIndicators.length - shownIndicators.length;
            // `div role="button"` plutôt qu'un vrai <button> : la carte imbrique deux familles de
            // <button> (puces d'indicateur, round 6, point 3 ; et le déclencheur `AtRiskCountPill`),
            // qui ne peuvent pas être imbriquées dans un <button> parent.
            return (
              <div
                key={axis.id}
                role="button"
                tabIndex={0}
                onClick={() => openAxis(axis.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openAxis(axis.id);
                  }
                }}
                className="flex h-full cursor-pointer flex-col rounded-lg border border-border bg-white p-4 text-left shadow-sm transition hover:-translate-y-px hover:border-black hover:shadow-md"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-primary">{axis.name}</span>
                    <span className="mt-0.5 block text-[11px] text-tertiary">
                      {axis.owner ?? t("strategicAxes.unassigned")}
                    </span>
                  </span>
                  <AxisStageBadge stageId={axis.stage} stages={stages} className="shrink-0" />
                </div>

                {axis.description && (
                  <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-snug text-secondary">
                    {axis.description}
                  </p>
                )}

                {/* Puces numérotées d'indicateur (round 6, point 3) — un aperçu d'un clic, sans
                    quitter le portefeuille : chaque puce ouvre `IndicatorChart` de CET indicateur
                    seul dans la modale partagée définie plus bas (`openIndicatorId`). Le nombre de
                    puces + la puce "+N" remplacent le pastille de comptage brut d'avant ce round. */}
                {axisIndicators.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 text-[10px] text-tertiary">
                      {t("strategicAxes.indicatorsCount")}
                    </span>
                    {shownIndicators.map((indicator, idx) => (
                      <button
                        key={indicator.id}
                        type="button"
                        title={indicator.name}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenIndicatorId(indicator.id);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-secondary transition hover:bg-black hover:text-white"
                      >
                        {idx + 1}
                      </button>
                    ))}
                    {hiddenIndicatorsCount > 0 && (
                      <span
                        className="flex h-5 shrink-0 items-center rounded-full bg-neutral-100 px-1.5 text-[10px] font-semibold text-secondary"
                        title={`+${hiddenIndicatorsCount} ${t("strategicAxes.indicatorsCount")}`}
                      >
                        +{hiddenIndicatorsCount}
                      </span>
                    )}
                  </div>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-[10.5px]">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-secondary">
                    {c.chantiers} {t("strategicAxes.chantiersCount")}
                  </span>
                  <AtRiskCountPill
                    count={c.atRisk}
                    items={axisAtRiskIndicators(axis.id, data.indicators, data.measurements)}
                    title={t("strategicAxes.atRiskPopoverTitle")}
                    label={t("strategicAxes.atRiskCount")}
                    progressLabel={t("kpi.chart.progressToTarget")}
                    tooltip={t("strategicAxes.atRiskTooltip")}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Aperçu d'un indicateur (round 6, point 3) — même modale, quel que soit l'axe ; voir
          doc-comment de `openIndicatorId` plus haut. ─────────────────────────────────────────── */}
      <Modal
        open={!!openIndicatorId}
        onOpenChange={(open) => {
          if (!open) setOpenIndicatorId(null);
        }}
        title={openIndicator?.name ?? t("strategicAxes.indicatorsSection")}
        maxWidth="820px"
      >
        {openIndicator && (
          <IndicatorChart
            measurements={openIndicatorMeasurements}
            objectiveValue={openIndicator.objectiveValue}
            direction={openIndicator.direction}
            unit={openIndicator.unit}
            qualitative={openIndicator.kind === "qualitative"}
            height={300}
            windowMeasurements="all"
            frequency={openIndicator.frequency}
            labelValue={t("strategicAxes.chartValue")}
            labelObjective={t("strategicAxes.chartObjective")}
            emptyLabel={t("strategicAxes.chartEmpty")}
            labelProgress={t("kpi.chart.progressToTarget")}
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
