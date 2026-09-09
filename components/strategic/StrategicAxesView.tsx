"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Rows3 } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody } from "@/components/shared/Card";
import { Dropdown, type DropdownOption } from "@/components/shared/Dropdown";
import { Modal } from "@/components/shared/Modal";
import {
  BudgetDonutChart,
  type BudgetDonutSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { AxisKanban } from "@/components/strategic/AxisKanban";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import { StrategicImportButton } from "@/components/strategic/StrategicImportButton";
import { numberIndicators, resolveIndicatorStatus } from "@/lib/axisLogic";
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
import type { Chantier, Indicator, LevierKanbanStatus, MilestoneId } from "@/types";

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
  const [view, setView] = useState<"cards" | "kanban">("cards");

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
          {/* Filtres "Responsable" + "Jalon" + "Statut kanban" réunis dans une même zone (round 10,
              point 3 ; migrés de `FilterBar` vers `Dropdown` round 14, voir doc-comments de
              `selectedOwner`/`selectedMilestone`/`selectedKanbanStatus`) — restent des mécanismes
              TECHNIQUEMENT distincts (entités et persistances différentes), regroupés visuellement
              sous un libellé générique uniquement quand les 3 sont pertinents (vue "Avancement des
              chantiers" — "Jalon"/"Statut kanban" n'ont pas de sens en vue "Cartes", où aucun
              composant ne les consomme). Libellé volontairement générique (round 11) depuis le
              retrait du filtre "Étape de maturité" : énumérer les filtres concrets n'a plus de sens
              avec un seul type par vue. */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            {view === "kanban" && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                {t("strategicAxes.filterStageAndMilestone")}
              </span>
            )}
            <Dropdown
              label={t("strategicAxes.filterOwner")}
              placeholder={t("kpi.filterAll")}
              value={selectedOwner}
              onChange={setOwnerFilter}
              options={ownerOptions}
              allowClear
            />
            {view === "kanban" && (
              <Dropdown
                label={t("strategicAxes.filterMilestone")}
                placeholder={t("kpi.filterAll")}
                value={selectedMilestone}
                onChange={(v) => setSelectedMilestone(v as MilestoneId | null)}
                options={milestoneOptions}
                allowClear
              />
            )}
            {view === "kanban" && (
              <Dropdown
                label={t("strategicAxes.filterKanban")}
                placeholder={t("kpi.filterAll")}
                value={selectedKanbanStatus}
                onChange={(v) => setSelectedKanbanStatus(v as LevierKanbanStatus | null)}
                options={kanbanOptions}
                allowClear
              />
            )}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAxes.map((axis) => {
            const axisIndicators = indicatorsByAxis.get(axis.id) ?? [];
            const shownIndicators = axisIndicators.slice(0, MAX_CARD_INDICATOR_CHIPS);
            const hiddenIndicatorsCount = axisIndicators.length - shownIndicators.length;
            const axisChantiers = chantiersByAxis.get(axis.id) ?? [];
            const axisBudget = axisBudgetByAxis.get(axis.id) ?? 0;
            // Le donut n'a d'intérêt que si au moins un chantier de l'axe a un budget alloué non
            // nul — sinon le montant total reste un simple texte, non cliquable (round 12).
            const axisHasBudgetSlices = axisChantiers.some((c) => (c.allocatedBudget ?? 0) > 0);
            // `div role="button"` plutôt qu'un vrai <button> : la carte imbrique d'autres <button>
            // (puces d'indicateur, lignes de chantier), qui ne peuvent pas être imbriqués dans un
            // <button> parent.
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
                </div>

                {/* Round 14 : bloc TOUJOURS rendu (même sans description) — une hauteur minimale
                    constante (`min-h-[34px]`, deux lignes à `text-[12.5px] leading-snug`) occupe le
                    même emplacement structurel que l'axe ait une description ou non. Avant round 14,
                    ce bloc disparaissait entièrement (`{axis.description && (...)}`) : la marge
                    devant le bloc "indicateurs" puis "CHANTIERS" se retrouvait donc à des hauteurs
                    différentes d'une carte à l'autre de la même ligne de grille — c'est cette
                    variation qui rendait l'alignement "CHANTIERS" imprévisible, pas `mt-auto` en soi
                    (voir doc-comment du bloc CHANTIERS plus bas). */}
                <p className="mt-2.5 line-clamp-2 min-h-[34px] text-[12.5px] leading-snug text-secondary">
                  {axis.description ?? ""}
                </p>

                {/* Puces numérotées d'indicateur (round 10, point 3) — numéro GLOBAL sur toute la
                    plateforme (`numberIndicators`, fondation `lib/axisLogic.ts`), coloré si le
                    statut EFFECTIF de l'indicateur est "à risque". Le clic navigue désormais vers la
                    vraie page KPI (`/kpi?indicator=<id>`) — remplace l'ancien aperçu en modale locale
                    (`IndicatorChart`), changement de comportement délibéré (round 10 : le PO veut
                    atterrir sur la page KPI, pas un aperçu).
                    Round 14 : bloc TOUJOURS rendu (même compte à zéro), même raison que le bloc
                    description ci-dessus — sinon la marge `mt-3.5` de ce bloc disparaissait avec lui
                    et décalait tout ce qui suit (dont "CHANTIERS"). Sans indicateur, un texte discret
                    remplace les puces plutôt que de vider la ligne. */}
                <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-xs text-tertiary">
                    {t("strategicAxes.indicatorsCount")}
                  </span>
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
                              atRisk
                                ? `${indicator.name} — ${t("indicatorStatus.atRisk")}`
                                : indicator.name
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/kpi?indicator=${indicator.id}`);
                            }}
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition hover:bg-black hover:text-white ${
                              atRisk
                                ? "bg-rag-amber-light text-rag-amber"
                                : "bg-neutral-100 text-secondary"
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

                {/* Chantiers de l'axe — nom + sponsor, chacun cliquable (round 10, point 3) —
                    remplace l'ancienne pastille de comptage brut "N chantiers". Complétés par le
                    budget total alloué de l'axe (somme de `Chantier.allocatedBudget`).
                    Round 14 : marge CONSTANTE (`mt-3.5`, même valeur que le bloc indicateurs
                    au-dessus) au lieu de `mt-auto`. `mt-auto` plaquait ce bloc en BAS de la carte
                    (hauteur égalisée par la grille, `h-full` sur le conteneur racine) — mais sa
                    propre hauteur varie selon le nombre de chantiers de l'axe, donc son bord HAUT
                    (là où "CHANTIERS" s'affiche) se déplaçait quand même d'une carte à l'autre.
                    Avec les blocs description/indicateurs ci-dessus désormais à hauteur constante
                    (voir leurs doc-comments), une marge fixe suffit à faire démarrer "CHANTIERS" au
                    même point vertical sur toutes les cartes d'une même ligne. */}
                <div className="mt-3.5 flex flex-col gap-1 border-t border-border pt-2.5 text-[10.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                      {t("strategicAxes.chantiersCount")}
                    </span>
                    {axisChantiers.length > 0 &&
                      (axisHasBudgetSlices ? (
                        // Round 12 : le montant devient cliquable → donut de répartition par
                        // chantier (`budgetDonutSlices`, ouvert via `budgetDonutAxisId`).
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBudgetDonutAxisId(axis.id);
                          }}
                          className="shrink-0 font-semibold text-secondary underline-offset-2 hover:text-primary hover:underline"
                        >
                          {t("strategicChantierDetail.allocatedBudget")} :{" "}
                          {axisBudget.toLocaleString()} {activeProgram?.currency ?? ""}
                        </button>
                      ) : (
                        <span className="shrink-0 font-semibold text-secondary">
                          {t("strategicChantierDetail.allocatedBudget")} :{" "}
                          {axisBudget.toLocaleString()} {activeProgram?.currency ?? ""}
                        </span>
                      ))}
                  </div>
                  {axisChantiers.length === 0 ? (
                    <p className="text-tertiary">{t("strategicAxes.axisNoChantier")}</p>
                  ) : (
                    axisChantiers.map((chantier) => (
                      <button
                        key={chantier.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openChantierPanel(chantier.id);
                        }}
                        className="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left transition hover:bg-neutral-50"
                      >
                        <span className="truncate font-medium text-primary" title={chantier.name}>
                          {chantier.name}
                        </span>
                        <span className="shrink-0 truncate text-tertiary">
                          {chantier.sponsorName ?? t("strategicAxes.sponsorUnassigned")}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
