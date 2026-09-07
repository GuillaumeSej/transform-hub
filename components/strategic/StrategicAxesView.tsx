"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, LayoutList, Plus, Rows3, TriangleAlert } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody } from "@/components/shared/Card";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import { Modal } from "@/components/shared/Modal";
import { Popover } from "@/components/shared/Popover";
import { AtRiskCountPill } from "@/components/strategic/AtRiskCountPill";
import { AtRiskIndicatorPopoverContent } from "@/components/strategic/AtRiskIndicatorPopoverContent";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { AxisKanban } from "@/components/strategic/AxisKanban";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { StrategicImportButton } from "@/components/strategic/StrategicImportButton";
import {
  chantierAtRiskIndicators,
  chantierDependencyAlerts,
  computeIndicatorDelta,
  latestMeasurement,
  milestoneProgressPct,
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
  StrategicAxis,
} from "@/types";

/** Nombre d'actions listées en clair sur une carte chantier avant repli « +N autres ». Au-delà,
 *  la carte cesse d'être lisible d'un coup d'œil — le détail complet est dans la pop-up. */
const CARD_ACTIONS_SHOWN = 4;

/** Nombre de puces numérotées d'indicateur affichées sur une carte d'axe (vue "cartes", round 6,
 *  point 3) avant repli sur une puce "+N" — même principe que `CARD_ACTIONS_SHOWN`. */
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

/** Une ligne par personne référencée (owner OU sponsor) sur une action de chantier — alimente à la
 *  fois les OPTIONS des filtres chantier (round 4, point 8 : Direction/Personne/Sponsor) via
 *  `FilterBar` (qui calcule ses options en mappant CHAQUE ligne through `def.getValue`) et,
 *  indépendamment, l'ensemble de correspondance utilisé pour le filtrage réel (voir
 *  `chantierFacetsById` ci-dessous). Une ligne par (action, rôle) plutôt qu'une par chantier : un
 *  chantier a souvent PLUSIEURS personnes (un owner par action, éventuellement un sponsor
 *  distinct) — un unique champ par chantier perdrait des valeurs de filtre valides. */
type ChantierPersonFacetRow = {
  chantierId: string;
  /** Direction résolue de la personne (vide si le champ owner/sponsor ne correspond à aucun
   *  `AuthUser.username` connu — voir doc-comment de `chantierFacets` plus bas). */
  direction: string;
  /** Nom affiché de la personne (résolu si possible, sinon le texte brut du champ owner/sponsor —
   *  contrairement à `direction`, qui elle reste vide sans correspondance). */
  person: string;
  /** Rempli UNIQUEMENT pour une ligne issue du champ `sponsor` (jamais `owner`) — c'est le filtre
   *  "Sponsor" du plan, distinct de "Personne" qui couvre owner ET sponsor. */
  sponsor: string;
};

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
 * Trois vues, trois mailles de lecture volontairement distinctes :
 *  - « cartes » et « kanban » (`AxisKanban`) portent sur les AXES eux-mêmes (portefeuille) ;
 *  - « chantiers » descend d'un cran : une section par axe, listant SES CHANTIERS — la maille où
 *    l'avancement réel d'un axe se lit (étape de chaque chantier, actions, indicateurs à risque,
 *    alertes de cascade), sans avoir à ouvrir chaque fiche d'axe une par une.
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
  const [view, setView] = useState<"cards" | "kanban" | "chantiers">("cards");

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

  // --- Vue « chantiers » : dérivés à la maille CHANTIER (et non plus axe) -------------------
  // Chantiers regroupés par axe, dans l'ordre de `data.chantiers` (déjà trié par le hook) — sert
  // aussi au Kanban reconstruit (round 6, point 5), qui imbrique désormais les chantiers de chaque
  // axe plutôt que de bucketer les axes eux-mêmes par étape.
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

  // Actions de CHAQUE chantier, triées par date de début : la vue « chantiers » en affiche les
  // NOMS sur la carte (le PO pilote au quotidien sur « ce qu'il y a à faire », pas sur un compte).
  const actionsByChantier = useMemo(() => {
    const map = new Map<string, ChantierAction[]>();
    for (const action of data.chantierActions) {
      const list = map.get(action.chantierId);
      if (list) list.push(action);
      else map.set(action.chantierId, [action]);
    }
    map.forEach((list) => list.sort((a, b) => a.start.localeCompare(b.start)));
    return map;
  }, [data.chantierActions]);

  // Actions + indicateurs à risque rattachés à CHAQUE chantier. Un indicateur sans `chantierId`
  // est « macro » (rattaché directement à l'axe) : il ne compte pour aucun chantier.
  const chantierCounts = useMemo(() => {
    const map = new Map<string, { actions: number; atRisk: number }>();
    const entry = (id: string) => {
      const existing = map.get(id);
      if (existing) return existing;
      const created = { actions: 0, atRisk: 0 };
      map.set(id, created);
      return created;
    };
    for (const chantier of data.chantiers) entry(chantier.id);
    for (const action of data.chantierActions) entry(action.chantierId).actions += 1;
    for (const indicator of data.indicators) {
      if (!indicator.chantierId) continue;
      if (resolveIndicatorStatus(indicator) === "at_risk") entry(indicator.chantierId).atRisk += 1;
    }
    return map;
  }, [data.chantiers, data.chantierActions, data.indicators]);

  /**
   * Facettes Direction/Personne/Sponsor de CHAQUE chantier (round 4, point 8), dérivées des
   * `owner`/`sponsor` de ses actions résolus contre `data.users` (source unique, voir
   * `useStrategicData`). Résolution PAR USERNAME uniquement : `ChantierAction.owner`/`sponsor`
   * peuvent encore être du texte libre saisi avant la conversion `UserPicker` de ce round (la
   * fiche chantier qui bascule `owner`/`sponsor` sur `UserPicker` n'est pas encore construite —
   * prochaine passe d'intégration) — un champ qui ne correspond à AUCUN `AuthUser.username` ne
   * fait simplement matcher aucune valeur de Direction (on ne peut pas deviner une direction sans
   * utilisateur résolu), mais reste filtrable par "Personne"/"Sponsor" via son texte brut.
   *
   * `rows` (une ligne par personne référencée sur une action) alimente les OPTIONS de `FilterBar`
   * (qui les calcule en mappant CHAQUE ligne) ; `byId` (ensembles par chantier) alimente le
   * filtrage réel plus bas — un chantier a souvent plusieurs personnes, un simple
   * `FilterDef<Chantier>.getValue` à valeur unique perdrait des correspondances valides.
   */
  const { chantierFacetRows, chantierFacetsById } = useMemo(() => {
    const usersByUsername = new Map(data.users.map((u) => [u.username, u]));
    const rows: ChantierPersonFacetRow[] = [];
    const byId = new Map<
      string,
      { directions: Set<string>; persons: Set<string>; sponsors: Set<string> }
    >();
    const entry = (chantierId: string) => {
      const existing = byId.get(chantierId);
      if (existing) return existing;
      const created = {
        directions: new Set<string>(),
        persons: new Set<string>(),
        sponsors: new Set<string>(),
      };
      byId.set(chantierId, created);
      return created;
    };
    for (const chantier of data.chantiers) entry(chantier.id);
    for (const action of data.chantierActions) {
      const facets = entry(action.chantierId);
      if (action.owner) {
        const user = usersByUsername.get(action.owner);
        const direction = user?.direction ?? "";
        const person = user?.name ?? action.owner;
        if (direction) facets.directions.add(direction);
        if (person) facets.persons.add(person);
        rows.push({ chantierId: action.chantierId, direction, person, sponsor: "" });
      }
      if (action.sponsor) {
        const user = usersByUsername.get(action.sponsor);
        const direction = user?.direction ?? "";
        const person = user?.name ?? action.sponsor;
        const sponsor = user?.name ?? action.sponsor;
        if (direction) facets.directions.add(direction);
        if (person) facets.persons.add(person);
        if (sponsor) facets.sponsors.add(sponsor);
        rows.push({ chantierId: action.chantierId, direction, person, sponsor });
      }
    }
    return { chantierFacetRows: rows, chantierFacetsById: byId };
  }, [data.chantiers, data.chantierActions, data.users]);

  const chantierFilterDefs: FilterDef<ChantierPersonFacetRow>[] = useMemo(
    () => [
      {
        key: "cf_direction",
        label: t("strategicAxes.filterDirection"),
        getValue: (r) => r.direction,
      },
      { key: "cf_person", label: t("strategicAxes.filterPerson"), getValue: (r) => r.person },
      { key: "cf_sponsor", label: t("strategicAxes.filterSponsor"), getValue: (r) => r.sponsor },
    ],
    [t]
  );

  /** Filtres chantier — état purement LOCAL (pas d'URL, contrairement aux filtres d'axe) : ils ne
   *  s'appliquent qu'à la vue "chantiers" et n'ont pas besoin d'être partageables par lien pour ce
   *  round. Pas besoin du contournement `openFilterKeys` des filtres d'axe (voir plus haut) non
   *  plus : ici l'état EST directement l'objet remonté par `FilterBar.onChange`, sans réécriture
   *  intermédiaire susceptible d'en perdre une partie. */
  const [chantierFilters, setChantierFilters] = useState<ActiveFilters>({});

  const chantierMatchesFilters = (chantier: Chantier): boolean =>
    Object.entries(chantierFilters).every(([key, values]) => {
      if (values.length === 0) return true;
      const facets = chantierFacetsById.get(chantier.id);
      if (!facets) return false;
      const set =
        key === "cf_direction"
          ? facets.directions
          : key === "cf_person"
            ? facets.persons
            : facets.sponsors;
      return values.some((v) => set.has(v));
    });

  // Les dépendances sont évaluées sur TOUT le programme (un chantier peut dépendre du chantier
  // d'un autre axe — cas explicitement prévu par le modèle), exactement comme `AxisDetailClient`.
  const alertedChantierIds = useMemo(() => {
    const alerts = chantierDependencyAlerts(data.chantiers, data.chantierActions);
    return new Set(alerts.flatMap((a) => [a.sourceId, a.targetId]));
  }, [data.chantiers, data.chantierActions]);

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
              <button
                onClick={() => setView("chantiers")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                  view === "chantiers" ? "bg-black text-white" : "bg-white text-secondary"
                }`}
              >
                <LayoutList size={13} /> {t("strategicAxes.chantiersView")}
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
          stages={stages}
          indicators={data.indicators}
          measurements={data.measurements}
          chantiersByAxis={chantiersByAxis}
          onCardClick={openAxis}
          onOpenChantier={openChantierPanel}
          atRiskItemsOf={(axisId) =>
            axisAtRiskIndicators(axisId, data.indicators, data.measurements)
          }
          labels={{
            emptyAxisChantiers: t("strategicAxes.axisNoChantier"),
            chantiers: t("strategicAxes.chantiersCount"),
            atRisk: t("strategicAxes.atRiskCount"),
            atRiskPopoverTitle: t("strategicAxes.atRiskPopoverTitle"),
            atRiskTooltip: t("strategicAxes.atRiskTooltip"),
            progress: t("kpi.chart.progressToTarget"),
          }}
        />
      ) : view === "chantiers" ? (
        <div className="flex flex-col gap-3">
          {/* Filtres CHANTIER (round 4, point 8) — Direction/Personne/Sponsor, indépendants des
              filtres d'axe ci-dessus et scopés à cette vue uniquement (voir doc-comment de
              `chantierFacetRows`). */}
          <Card>
            <CardBody flush>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <FilterBar
                  items={chantierFacetRows}
                  defs={chantierFilterDefs}
                  active={chantierFilters}
                  onChange={setChantierFilters}
                />
              </div>
            </CardBody>
          </Card>
          {filteredAxes.map((axis) => {
            const axisChantiers = (chantiersByAxis.get(axis.id) ?? []).filter(
              chantierMatchesFilters
            );
            return (
              <div key={axis.id} className="rounded-lg border border-border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2.5 border-b border-border pb-2.5">
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
                  />
                  <button
                    onClick={() => openAxis(axis.id)}
                    className="text-sm font-bold text-primary underline-offset-2 hover:underline"
                  >
                    {axis.name}
                  </button>
                  <AxisStageBadge stageId={axis.stage} stages={stages} className="shrink-0" />
                  <span className="ml-auto text-[11px] text-tertiary">
                    {axisChantiers.length} {t("strategicAxes.chantiersCount")}
                  </span>
                </div>

                {axisChantiers.length === 0 ? (
                  <p className="pt-3 text-[12px] text-tertiary">
                    {t("strategicAxes.axisNoChantier")}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 pt-3 sm:grid-cols-2 xl:grid-cols-3">
                    {axisChantiers.map((chantier) => {
                      const c = chantierCounts.get(chantier.id) ?? { actions: 0, atRisk: 0 };
                      const isAlerted = alertedChantierIds.has(chantier.id);
                      const chantierActions = actionsByChantier.get(chantier.id) ?? [];
                      const shownActions = chantierActions.slice(0, CARD_ACTIONS_SHOWN);
                      const hiddenActions = chantierActions.length - shownActions.length;
                      const progressPct = milestoneProgressPct(chantier);
                      // Popover-cliquable (round 4, point 2) : le badge "N à risque" est un vrai
                      // <button>, donc la carte NE PEUT PLUS être elle-même un <button> (imbrication
                      // invalide) — `role="button"` + gestion clavier reproduit le même comportement.
                      return (
                        <div
                          key={chantier.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openChantierPanel(chantier.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openChantierPanel(chantier.id);
                            }
                          }}
                          className={`flex h-full cursor-pointer flex-col rounded-md border bg-white p-3 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm ${
                            isAlerted ? "border-rag-amber bg-rag-amber-light/40" : "border-border"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-primary">
                              {chantier.name}
                            </span>
                            {isAlerted && (
                              <TriangleAlert
                                size={13}
                                className="mt-0.5 shrink-0 text-rag-amber"
                                aria-label={t("strategicAxes.chantierAlerted")}
                              />
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <AxisStageBadge stageId={chantier.stage} stages={stages} />
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-secondary">
                              {c.actions} {t("strategicAxes.actionsSuffix")}
                            </span>
                            {c.atRisk > 0 && (
                              <Popover
                                trigger={({ toggle }) => (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggle();
                                    }}
                                    className="rounded-full bg-rag-amber-light px-2 py-0.5 font-semibold text-rag-amber hover:brightness-95"
                                  >
                                    {c.atRisk} {t("strategicAxes.atRiskCount")}
                                  </button>
                                )}
                              >
                                <AtRiskIndicatorPopoverContent
                                  items={chantierAtRiskIndicators(
                                    chantier.id,
                                    data.indicators,
                                    data.measurements
                                  )}
                                  title={t("strategicAxes.atRiskPopoverTitle")}
                                  progressLabel={t("kpi.chart.progressToTarget")}
                                />
                              </Popover>
                            )}
                          </div>

                          {/* Avancement dérivé des jalons E0→E4 franchis (voir milestoneProgressPct). */}
                          <div className="mt-2 flex items-center gap-1.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${progressPct}%`,
                                  backgroundColor: axis.color ?? "var(--bp-warm-taupe)",
                                }}
                              />
                            </div>
                            <span className="shrink-0 text-[10px] font-bold text-secondary">
                              {progressPct}%
                            </span>
                          </div>

                          {/* Les actions À FAIRE, nommées — la maille de pilotage quotidien. */}
                          {chantierActions.length === 0 ? (
                            <p className="mt-2 text-[11px] text-tertiary">
                              {t("strategicAxes.cardNoActions")}
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-1">
                              {shownActions.map((action) => (
                                <li
                                  key={action.id}
                                  className="flex items-start gap-1.5 text-[11px] leading-snug text-secondary"
                                >
                                  <span
                                    aria-hidden
                                    className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: axis.color ?? "var(--bp-warm-taupe)",
                                    }}
                                  />
                                  <span className="min-w-0 flex-1 truncate" title={action.name}>
                                    {action.name}
                                  </span>
                                </li>
                              ))}
                              {hiddenActions > 0 && (
                                <li className="pl-2.5 text-[10.5px] font-medium text-tertiary">
                                  +{hiddenActions} {t("strategicAxes.moreActionsSuffix")}
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAxes.map((axis) => {
            const c = countsOf(axis.id);
            const axisIndicators = indicatorsByAxis.get(axis.id) ?? [];
            const shownIndicators = axisIndicators.slice(0, MAX_CARD_INDICATOR_CHIPS);
            const hiddenIndicatorsCount = axisIndicators.length - shownIndicators.length;
            // Même conversion bouton -> div que la vue "chantiers" (voir plus haut) : la carte
            // imbrique désormais deux familles de <button> (puces d'indicateur, round 6, point 3 ;
            // et le déclencheur `AtRiskCountPill`), qui ne peuvent pas être imbriquées dans un
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
