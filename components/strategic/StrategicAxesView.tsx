"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, LayoutList, Plus, Rows3, TriangleAlert } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody } from "@/components/shared/Card";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import { Modal } from "@/components/shared/Modal";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { AxisKanban } from "@/components/strategic/AxisKanban";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import {
  chantierDependencyAlerts,
  chantierProgress,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages, resolveMaturityStageLabel } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Chantier, ChantierAction, StrategicAxis } from "@/types";

/** Nombre d'actions listées en clair sur une carte chantier avant repli « +N autres ». Au-delà,
 *  la carte cesse d'être lisible d'un coup d'œil — le détail complet est dans la pop-up. */
const CARD_ACTIONS_SHOWN = 4;

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
 * clic sur un chantier y ajoute `&chantier=<chantierId>`, que `AxisDetailClient` interprète pour
 * ouvrir directement la pop-up de ce chantier (paramètre ignoré si inconnu : la fiche d'axe
 * s'ouvre alors simplement sans pop-up).
 */
export function StrategicAxesView() {
  const { user } = useRole();
  const { activeProgramId, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const data = useStrategicData(user?.companyId ?? null, activeProgramId);
  const stages = useMaturityStages(activeProgramId);
  const [newAxisOpen, setNewAxisOpen] = useState(false);
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
  // Chantiers regroupés par axe, dans l'ordre de `data.chantiers` (déjà trié par le hook).
  const chantiersByAxis = useMemo(() => {
    const map = new Map<string, Chantier[]>();
    for (const chantier of data.chantiers) {
      const list = map.get(chantier.axisId);
      if (list) list.push(chantier);
      else map.set(chantier.axisId, [chantier]);
    }
    return map;
  }, [data.chantiers]);

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

  /** Même destination que `openAxis`, plus le chantier à ouvrir en pop-up sur la fiche d'axe. */
  const openChantier = (axisId: string, chantierId: string) =>
    router.push(`/levers/detail?id=${axisId}&chantier=${chantierId}`);

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
        <Button variant="primary" onClick={() => setNewAxisOpen(true)}>
          <Plus size={13} /> {t("strategicAxes.newAxis")}
        </Button>
      </div>

      <Modal
        open={newAxisOpen}
        onOpenChange={setNewAxisOpen}
        title={t("strategicAxes.newAxisModalTitle")}
        maxWidth="640px"
      >
        <AxisForm
          stages={stages}
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
          onCardClick={openAxis}
          counts={countsOf}
          labels={{
            emptyColumn: t("strategicAxes.kanbanEmptyColumn"),
            chantiers: t("strategicAxes.chantiersCount"),
            indicators: t("strategicAxes.indicatorsCount"),
            atRisk: t("strategicAxes.atRiskCount"),
            noStage: t("strategicAxes.noStage"),
          }}
        />
      ) : view === "chantiers" ? (
        <div className="flex flex-col gap-3">
          {filteredAxes.map((axis) => {
            const axisChantiers = chantiersByAxis.get(axis.id) ?? [];
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
                      const progress = chantierProgress(chantier.id, data.chantierActions, stages);
                      return (
                        <button
                          key={chantier.id}
                          onClick={() => openChantier(axis.id, chantier.id)}
                          className={`flex h-full flex-col rounded-md border bg-white p-3 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm ${
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
                              <span className="rounded-full bg-rag-amber-light px-2 py-0.5 font-semibold text-rag-amber">
                                {c.atRisk} {t("strategicAxes.atRiskCount")}
                              </span>
                            )}
                          </div>

                          {/* Avancement pondéré par la durée des actions (voir chantierProgress). */}
                          <div className="mt-2 flex items-center gap-1.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${progress.pct}%`,
                                  backgroundColor: axis.color ?? "var(--bp-warm-taupe)",
                                }}
                              />
                            </div>
                            <span className="shrink-0 text-[10px] font-bold text-secondary">
                              {progress.pct}%
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
                        </button>
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
            return (
              <button
                key={axis.id}
                onClick={() => openAxis(axis.id)}
                className="flex h-full flex-col rounded-lg border border-border bg-white p-4 text-left shadow-sm transition hover:-translate-y-px hover:border-black hover:shadow-md"
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

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-[10.5px]">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-secondary">
                    {c.chantiers} {t("strategicAxes.chantiersCount")}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-secondary">
                    {c.indicators} {t("strategicAxes.indicatorsCount")}
                  </span>
                  {c.atRisk > 0 && (
                    <span className="rounded-full bg-rag-amber-light px-2 py-0.5 font-semibold text-rag-amber">
                      {c.atRisk} {t("strategicAxes.atRiskCount")}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
