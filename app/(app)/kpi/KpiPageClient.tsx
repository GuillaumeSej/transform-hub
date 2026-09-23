"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Lock, LineChart, Pencil, Plus, Table2, Target, X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import type { DropdownGroup, DropdownOption } from "@/components/shared/Dropdown";
import { MultiSelect } from "@/components/shared/MultiSelect";
import { parseFilterValues, serializeFilterValues } from "@/lib/filterUtils";
import { IndicatorDonut } from "@/components/shared/IndicatorDonut";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { IndicatorProgressDetail } from "@/components/strategic/IndicatorProgressDetail";
import {
  BusinessKpiCards,
  IndicatorStatusSummary,
} from "@/components/strategic/IndicatorStatusSummary";
import {
  computeIndicatorDelta,
  latestMeasurement,
  numberIndicators,
  resolveIndicatorOwner,
  resolveIndicatorStatus,
  resolveUserFullName,
} from "@/lib/axisLogic";
import { canFillIndicatorValue, currentPeriod, parseNumber } from "@/lib/kpiHistory";
import { IndicatorMetaLine } from "@/components/strategic/IndicatorMetaLine";
import {
  YearSegmentedControl,
  useYearSelection,
} from "@/components/strategic/YearSegmentedControl";
import { IndicatorHistoryTable } from "@/components/strategic/IndicatorHistoryTable";
import { KpiTableView } from "@/components/strategic/KpiTableView";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData, type StrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { PendingKpiValues } from "@/components/strategic/PendingKpiValues";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import { submitKpiValueFlow } from "@/lib/strategicApprovalFlows";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { roles as roleDefinitions } from "@/lib/nav-config";
import type {
  AuthUser,
  Chantier,
  Indicator,
  IndicatorDirection,
  IndicatorMeasurement,
  IndicatorRiskStatus,
  StrategicAxis,
} from "@/types";

/**
 * Page KPI — surface PRINCIPALE de saisie des indicateurs d'un Plan Stratégique, pas un dashboard
 * en lecture seule : il n'existe aucun connecteur vers un outil tiers, la saisie manuelle par les
 * responsables est le seul mécanisme de suivi. On y trouve donc, pour chaque indicateur, à la fois
 * sa lecture (graphique, dernière valeur, statut) ET ses deux points d'écriture : l'ajout d'une
 * mesure de la période courante, et le réajustement de l'objectif/seuil au fil de l'eau (la valeur
 * initiale étant posée par l'admin à la création de l'indicateur).
 *
 * Contrôle d'accès : `axisLogic.canFillIndicator(indicator, user)` est le SEUL point de vérité —
 * il gate à la fois le formulaire de mesure et l'édition d'objectif. Un utilisateur non autorisé
 * voit exactement les mêmes informations, en lecture seule, avec la liste des rôles habilités.
 *
 * Statut de risque : jamais recalculé ici. `useStrategicData.addMeasurement` et `updateIndicator`
 * recalculent et persistent `Indicator.status` eux-mêmes (une mesure saisie ou un objectif modifié
 * changent mécaniquement le verdict) — la page se contente d'afficher `resolveIndicatorStatus`.
 *
 * Garde d'accès à la route : assurée en amont par `AppShell` (la nav est filtrée par
 * `programType`, voir `lib/nav-config.ts`) ; la page se contente de dégrader proprement si elle
 * est atteinte alors que le programme actif n'est pas stratégique.
 */

/**
 * Période de reporting courante, dérivée de la fréquence de l'indicateur. Format
 * lexicographiquement ordonnable (`IndicatorMeasurement.period` sert de clé de tri chronologique).
 * Simple pré-remplissage : le champ reste libre à la saisie, un responsable pouvant vouloir
 * rattraper une période passée.
 */
export { currentPeriod };

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral disabled:cursor-not-allowed disabled:opacity-60";

// ─── Carte d'un indicateur ───────────────────────────────────────────────────────────────────

function IndicatorCard({
  indicator,
  measurements,
  user,
  addMeasurement,
  updateIndicator,
  number,
  highlighted,
  linkedChantiers,
}: {
  indicator: Indicator;
  /** Mesures DE CET indicateur uniquement (déjà filtrées par l'appelant). */
  measurements: IndicatorMeasurement[];
  user: AuthUser | null;
  addMeasurement: StrategicData["addMeasurement"];
  updateIndicator: StrategicData["updateIndicator"];
  /** Numéro global (round 10, `axisLogic.numberIndicators`) — `undefined` si l'axe de cet
   *  indicateur n'existe pas dans `axes` (indicateur "orphelin", voir `orphans` plus bas) : la
   *  fonction ne lui attribue alors aucun numéro, on omet simplement le badge plutôt que de planter. */
  number?: number;
  /** Mise en évidence brève à l'arrivée via `/kpi?indicator=<id>` (round 10, contrat de navigation
   *  KPI — voir le `useEffect` de `KpiPageClient`). */
  highlighted?: boolean;
  /** Chantiers dont un LEVIER déclare cet indicateur comme son KPI lié (`ChantierAction.indicatorId`)
   *  — voir `chantierIdsByIndicatorId`, `KpiPageClient`. Round 23 : remplace l'ancien chip row
   *  "chantiers de l'axe" (informatif, jamais cliquable, listait TOUS les chantiers de l'axe sans
   *  rapport avec l'indicateur affiché) par une liste précise et navigable. Vide la plupart du
   *  temps (peu de leviers lient un KPI) — la rangée ne s'affiche alors pas du tout. */
  linkedChantiers: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const router = useRouter();
  const sa = useStrategicApprovalsApi();

  const canFill = canFillIndicatorValue(indicator, user);
  const quantitative = indicator.kind === "quantitative";
  const latest = latestMeasurement(indicator.id, measurements);

  // ── Année affichée — round "cible évolutive" : PER-INDICATEUR (plus un sélecteur global de
  // page) suite à la demande explicite du PO ("je ne veux pas regarder l'historique global pour
  // tout, je veux choisir l'année sur chaque indicateur spécifiquement"). Même défaut (année
  // courante) et même logique de bornes (`availableYears`) que l'ancien sélecteur de page, mais
  // calculée sur les mesures DE CET indicateur uniquement plutôt que sur tout le programme.
  // Sélecteur partagé (`YearSegmentedControl`) : années issues des mesures + « Historique
  // complet », visible seulement si plusieurs années ont des données.
  const {
    year,
    setYear,
    options: yearOptions,
    visible: showYearPicker,
    filtered: yearMeasurements,
  } = useYearSelection(measurements, () => new Date().getFullYear());
  // Écart signé + progression vers la cible (round 6, point 6) : `undefined` sans objectif chiffré
  // ou sans mesure numérique exploitable — même garde-fou que `BusinessKpiCard`, rien à afficher
  // plutôt qu'un écart inventé.
  // Avancement mesuré depuis la valeur initiale (baseline = 1re mesure de TOUT l'historique de
  // l'indicateur, jamais la sélection d'année) — voir `computeIndicatorDelta`.
  const delta = computeIndicatorDelta(indicator, latest, measurements);

  // ── Brouillon de mesure ────────────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState(() => currentPeriod(indicator.frequency));
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [savingMeasurement, setSavingMeasurement] = useState(false);

  // ── Brouillon d'objectif ───────────────────────────────────────────────────────────────────
  const [editingObjective, setEditingObjective] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState(indicator.objective);
  const [objectiveValueDraft, setObjectiveValueDraft] = useState(
    indicator.objectiveValue !== undefined ? String(indicator.objectiveValue) : ""
  );
  const [directionDraft, setDirectionDraft] = useState<IndicatorDirection>(
    indicator.direction ?? "up"
  );
  // Cible FIXE (historique, défaut) vs PROGRESSIVE (`targetSchedule`, round "cible évolutive") —
  // le mode initial suit la donnée existante : un `targetSchedule` non vide démarre l'édition en
  // mode progressif, pré-rempli. `stepDraft.value` est une CHAÎNE (même convention que
  // `objectiveValueDraft`) : la saisie reste libre tant que l'utilisateur n'a pas soumis, parsée
  // seulement à la validation (`submitObjective`).
  const [targetMode, setTargetMode] = useState<"fixed" | "progressive">(
    indicator.targetSchedule && indicator.targetSchedule.length > 0 ? "progressive" : "fixed"
  );
  const [targetSteps, setTargetSteps] = useState<{ period: string; value: string }[]>(
    (indicator.targetSchedule ?? []).map((step) => ({
      period: step.period,
      value: String(step.value),
    }))
  );
  const [savingObjective, setSavingObjective] = useState(false);

  // Une saisie en cours (mesure OU objectif) est une modification non enregistrée : la garde de
  // navigation doit la protéger comme n'importe quel formulaire de l'app.
  const measurementDirty = value.trim() !== "" || note.trim() !== "";
  useRegisterUnsavedChanges(
    `kpi:indicator:${indicator.id}`,
    canFill && (measurementDirty || editingObjective)
  );

  const submitMeasurement = async () => {
    if (!user) return;
    const trimmedPeriod = period.trim();
    if (!trimmedPeriod) {
      showToast(t("kpi.periodRequired"), "", "error");
      return;
    }
    const parsedValue = quantitative ? parseNumber(value) : undefined;
    if (parsedValue === null) {
      showToast(t("kpi.valueInvalid"), "", "error");
      return;
    }
    const trimmedNote = note.trim();
    if (parsedValue === undefined && trimmedNote === "") {
      showToast(t("kpi.valueRequired"), "", "error");
      return;
    }
    setSavingMeasurement(true);
    try {
      // Les champs optionnels sont OMIS plutôt que passés à `undefined` : Firestore rejette une
      // valeur `undefined` à l'écriture (pas d'`ignoreUndefinedProperties` sur cette instance).
      const outcome = await submitKpiValueFlow(
        sa,
        indicator,
        {
          indicatorId: indicator.id,
          period: trimmedPeriod,
          reportedBy: user.username,
          value: parsedValue,
          note: trimmedNote,
        },
        addMeasurement
      );
      setValue("");
      setNote("");
      setPeriod(currentPeriod(indicator.frequency));
      if (outcome === "pending") {
        showToast(
          t("kpi.valueSubmittedForApproval", "Valeur soumise à validation du responsable du plan"),
          indicator.name,
          "success"
        );
      } else {
        showToast(t("kpi.measurementSaved"), indicator.name, "success");
      }
    } catch {
      showToast(t("kpi.saveError"), indicator.name, "error");
    } finally {
      setSavingMeasurement(false);
    }
  };

  const startEditObjective = () => {
    setObjectiveDraft(indicator.objective);
    setObjectiveValueDraft(
      indicator.objectiveValue !== undefined ? String(indicator.objectiveValue) : ""
    );
    setDirectionDraft(indicator.direction ?? "up");
    setTargetMode(
      indicator.targetSchedule && indicator.targetSchedule.length > 0 ? "progressive" : "fixed"
    );
    setTargetSteps(
      (indicator.targetSchedule ?? []).map((step) => ({
        period: step.period,
        value: String(step.value),
      }))
    );
    setEditingObjective(true);
  };

  const addTargetStep = () => {
    setTargetSteps((steps) => [
      ...steps,
      { period: currentPeriod(indicator.frequency), value: "" },
    ]);
  };
  const updateTargetStep = (index: number, patch: Partial<{ period: string; value: string }>) => {
    setTargetSteps((steps) => steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };
  const removeTargetStep = (index: number) => {
    setTargetSteps((steps) => steps.filter((_, i) => i !== index));
  };

  const submitObjective = async () => {
    const trimmedObjective = objectiveDraft.trim();
    if (!trimmedObjective) {
      showToast(t("kpi.objectiveRequired"), "", "error");
      return;
    }
    const parsedTarget = quantitative ? parseNumber(objectiveValueDraft) : undefined;
    if (parsedTarget === null) {
      showToast(t("kpi.valueInvalid"), "", "error");
      return;
    }
    // Paliers valides uniquement (période ET valeur numérique renseignées) — un palier
    // partiellement saisi (période seule, ou valeur seule) est silencieusement ignoré plutôt que
    // de bloquer la soumission : l'utilisateur peut avoir ajouté une ligne vide par erreur.
    const parsedSchedule: { period: string; value: number }[] =
      quantitative && targetMode === "progressive"
        ? targetSteps.reduce<{ period: string; value: number }[]>((acc, step) => {
            const trimmedPeriod = step.period.trim();
            const parsedValue = parseNumber(step.value);
            if (trimmedPeriod && parsedValue !== undefined && parsedValue !== null) {
              acc.push({ period: trimmedPeriod, value: parsedValue });
            }
            return acc;
          }, [])
        : [];
    setSavingObjective(true);
    try {
      // Même contrainte Firestore que ci-dessus : une cible chiffrée laissée vide n'est pas
      // effacée (elle ne peut pas l'être depuis ici), elle est simplement laissée telle quelle —
      // la suppression d'une cible relève de l'écran Admin des indicateurs. Même convention pour
      // `targetSchedule` : omis (jamais écrit vide) dès que le mode n'est pas progressif ou
      // qu'aucun palier valide n'a été saisi — revenir en mode "fixe" depuis ce formulaire ne
      // supprime donc pas une trajectoire déjà enregistrée (même garde-fou que pour `objectiveValue`).
      await updateIndicator(indicator.id, {
        objective: trimmedObjective,
        ...(quantitative && parsedTarget !== undefined
          ? { objectiveValue: parsedTarget, direction: directionDraft }
          : {}),
        ...(parsedSchedule.length > 0 ? { targetSchedule: parsedSchedule } : {}),
      });
      setEditingObjective(false);
      showToast(t("kpi.objectiveSaved"), indicator.name, "success");
    } catch {
      showToast(t("kpi.saveError"), indicator.name, "error");
    } finally {
      setSavingObjective(false);
    }
  };

  const authorizedRoles = indicator.responsibleRoles
    .map((role) => t(roleDefinitions[role].short))
    .join(", ");
  const additionalUsers = (indicator.additionalAuthorizedUserIds ?? []).join(", ");

  return (
    // Ancre DOM stable (round 10) : cible de `document.getElementById` pour le défilement/
    // surlignage déclenché par `?indicator=<id>` (voir le `useEffect` de `KpiPageClient`). Wrapper
    // plutôt qu'un `id` direct sur `Card` (composant partagé par 13 appelants, on évite d'y toucher)
    // — même raisonnement pour le surlignage : anneau posé sur ce wrapper, pas sur `Card` lui-même.
    <div
      id={`indicator-${indicator.id}`}
      className={`rounded-lg transition-shadow duration-700 ${
        highlighted ? "ring-2 ring-bp-coral/40" : ""
      }`}
    >
      <Card className="mb-0">
        <CardHeader
          title={
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-baseline gap-2">
                {number !== undefined && (
                  <span
                    className="shrink-0 font-mono text-xs font-semibold tabular-nums text-bp-coral"
                    aria-label={`${t("kpi.indicatorNumber")} ${number}`}
                  >
                    #{number}
                  </span>
                )}
                <span className="text-sm">{indicator.name}</span>
              </span>
              <IndicatorMetaLine indicator={indicator} />
            </span>
          }
          actions={
            // Round 7, point 3 : un seul camembert remplace le badge de statut + la barre de
            // delta dupliquée plus bas dans le bloc objectif — le pourcentage vient de
            // `computeIndicatorDelta` (`delta`, déjà calculé ci-dessus), aucune nouvelle formule.
            <IndicatorDonut
              delta={delta}
              labels={{
                onTrack: t("indicatorStatus.onTrack"),
                atRisk: t("indicatorStatus.atRisk"),
                noData: t("kpi.noMeasurement"),
              }}
            />
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* ── Lecture : graphique + dernière valeur ─────────────────────────────────────── */}
            <div className="space-y-3">
              {/* Sélecteur d'année PAR INDICATEUR (round "cible évolutive" — voir `year`/
                  `showYearPicker` ci-dessus) : posé juste au-dessus du graphique qu'il pilote,
                  plutôt qu'un sélecteur unique en tête de page qui affectait auparavant TOUTES les
                  cartes simultanément. */}
              {showYearPicker && (
                <YearSegmentedControl years={yearOptions} value={year} onChange={setYear} />
              )}
              {/* Fenêtré par défaut sur les dernières périodes (calibré par `frequency`, voir
                `axisLogic.recentMeasurementWindow`) : sur un plan pluriannuel, empiler tout
                l'historique écrase la tendance récente. Le bouton d'agrandissement du graphique
                ouvre l'historique complet depuis le lancement du plan. */}
              <IndicatorChart
                measurements={yearMeasurements}
                objectiveValue={indicator.objectiveValue}
                targetSchedule={indicator.targetSchedule}
                direction={indicator.direction}
                unit={indicator.unit}
                qualitative={!quantitative}
                frequency={indicator.frequency}
                windowMeasurements={year === "all" ? "recent" : "all"}
                labelValue={t("kpi.chart.value")}
                labelObjective={t("kpi.chart.objective")}
                emptyLabel={t("kpi.chart.empty")}
                labelViewFull={t("kpi.chart.viewFull")}
                fullHistoryTitle={`${t("kpi.chart.fullHistory")} — ${indicator.name}`}
                labelProgress={t("kpi.chart.progressToTarget")}
                labelToday={t("kpi.chart.today")}
                baselineMeasurements={measurements}
                // Round 7, point 3 : le camembert d'en-tête (`IndicatorDonut`) porte déjà le signal
                // "trajectoire" — sans ce flag, `IndicatorChart` superposerait son propre
                // `IndicatorDeltaStat` par-dessus la courbe, un 2ᵉ signal identique en double.
                hideDeltaStat
              />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-text-secondary">
                <span className="font-semibold uppercase tracking-wide">
                  {t("kpi.latestValue")}
                </span>
                {latest ? (
                  <>
                    <span className="text-sm font-semibold text-text-primary">
                      {latest.value !== undefined
                        ? `${latest.value}${indicator.unit ? ` ${indicator.unit}` : ""}`
                        : (latest.note ?? "—")}
                    </span>
                    <span className="font-mono">{latest.period}</span>
                    <span>
                      {t("kpi.reportedBy")} {latest.reportedBy}
                    </span>
                  </>
                ) : (
                  <span>{t("kpi.noMeasurement")}</span>
                )}
              </div>
              {/* Avancement vers la cible finale (chiffre principal) + palier courant — voir
                  `IndicatorProgressDetail`. */}
              <IndicatorProgressDetail delta={delta} unit={indicator.unit} />
              <IndicatorHistoryTable indicator={indicator} measurements={yearMeasurements} />
            </div>

            {/* ── Écriture : objectif + saisie de mesure ───────────────────────────────────── */}
            <div className="space-y-4">
              {/* Chantiers dont un levier lie cet indicateur comme son KPI (round 23) — voir
                  `linkedChantiers` ci-dessus. Absent la plupart du temps, d'où le garde-fou de
                  longueur plutôt qu'une rangée vide. */}
              {linkedChantiers.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
                  <span className="font-medium">{t("kpi.linkedChantiersLabel")} :</span>
                  {linkedChantiers.map((chantier) => (
                    <button
                      key={chantier.id}
                      type="button"
                      onClick={() => router.push(`/levers?chantier=${chantier.id}`)}
                      className="cursor-pointer rounded-full bg-bg-surface px-2 py-0.5 text-[10px] font-medium text-text-secondary transition-colors hover:bg-bp-coral/10 hover:text-bp-coral"
                    >
                      {chantier.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Objectif / seuil — toujours visible, éditable seulement si autorisé. */}
              <div className="rounded-lg border border-border bg-bg-surface/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    <Target size={13} /> {t("kpi.objective")}
                  </span>
                  {canFill && !editingObjective && (
                    <Button variant="ghost" size="sm" onClick={startEditObjective}>
                      <Pencil size={12} /> {t("kpi.editObjective")}
                    </Button>
                  )}
                </div>

                {editingObjective ? (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-medium text-text-secondary">
                      {t("kpi.objectiveText")}
                      <input
                        value={objectiveDraft}
                        onChange={(e) => setObjectiveDraft(e.target.value)}
                        className={`mt-1 ${FIELD_CLASS}`}
                      />
                    </label>
                    {quantitative && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="block text-[11px] font-medium text-text-secondary">
                          {targetMode === "progressive"
                            ? t("kpi.objective.finalTarget")
                            : t("kpi.objectiveValue")}
                          {indicator.unit ? ` (${indicator.unit})` : ""}
                          <input
                            value={objectiveValueDraft}
                            onChange={(e) => setObjectiveValueDraft(e.target.value)}
                            inputMode="decimal"
                            className={`mt-1 ${FIELD_CLASS}`}
                          />
                        </label>
                        <label className="block text-[11px] font-medium text-text-secondary">
                          {t("kpi.direction")}
                          <select
                            value={directionDraft}
                            onChange={(e) =>
                              setDirectionDraft(e.target.value as IndicatorDirection)
                            }
                            className={`mt-1 ${FIELD_CLASS}`}
                          >
                            <option value="up">{t("kpi.direction.up")}</option>
                            <option value="down">{t("kpi.direction.down")}</option>
                          </select>
                        </label>
                      </div>
                    )}
                    {/* Cible FIXE vs PROGRESSIVE (round "cible évolutive") : uniquement pour un
                        indicateur quantitatif — une cible chiffrée n'a pas de sens sur un
                        indicateur qualitatif. */}
                    {quantitative && (
                      <div className="space-y-2 rounded-md border border-border bg-bg-surface/40 p-2">
                        <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-text-secondary">
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name={`target-mode-${indicator.id}`}
                              checked={targetMode === "fixed"}
                              onChange={() => setTargetMode("fixed")}
                            />
                            {t("kpi.objective.targetModeFixed")}
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name={`target-mode-${indicator.id}`}
                              checked={targetMode === "progressive"}
                              onChange={() => setTargetMode("progressive")}
                            />
                            {t("kpi.objective.targetModeProgressive")}
                          </label>
                        </div>

                        {targetMode === "progressive" && (
                          <div className="space-y-1.5">
                            {targetSteps.map((step, index) => (
                              <div key={index} className="flex items-center gap-1.5">
                                <input
                                  value={step.period}
                                  onChange={(e) =>
                                    updateTargetStep(index, { period: e.target.value })
                                  }
                                  placeholder={t("kpi.objective.stepPeriod")}
                                  aria-label={t("kpi.objective.stepPeriod")}
                                  className={`${FIELD_CLASS} flex-1`}
                                />
                                <input
                                  value={step.value}
                                  onChange={(e) =>
                                    updateTargetStep(index, { value: e.target.value })
                                  }
                                  inputMode="decimal"
                                  placeholder={t("kpi.objective.stepValue")}
                                  aria-label={t("kpi.objective.stepValue")}
                                  className={`${FIELD_CLASS} flex-1`}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeTargetStep(index)}
                                  aria-label={t("kpi.objective.removeStep")}
                                  title={t("kpi.objective.removeStep")}
                                  className="shrink-0 cursor-pointer rounded p-1 text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                            <Button variant="ghost" size="sm" onClick={addTargetStep}>
                              <Plus size={12} /> {t("kpi.objective.addStep")}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={submitObjective}
                        disabled={savingObjective}
                      >
                        {t("common.save")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingObjective(false)}
                        disabled={savingObjective}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-sm text-text-primary">
                    <p>{indicator.objective}</p>
                    {quantitative && indicator.objectiveValue !== undefined && (
                      <p className="text-xs text-text-secondary">
                        {indicator.targetSchedule && indicator.targetSchedule.length > 0
                          ? t("kpi.objective.finalTarget")
                          : t("kpi.objectiveValue")}{" "}
                        : {indicator.objectiveValue}
                        {indicator.unit ? ` ${indicator.unit}` : ""} ·{" "}
                        {t(`kpi.direction.${indicator.direction ?? "up"}`)}
                      </p>
                    )}
                    {/* Trajectoire de cible évolutive — lecture seule, listant les paliers déjà
                        déclarés (`indicator.targetSchedule`, trié par période) : sans ça, une
                        trajectoire éditée resterait invisible hors mode édition. */}
                    {quantitative &&
                      indicator.targetSchedule &&
                      indicator.targetSchedule.length > 0 && (
                        <p className="text-xs text-text-secondary">
                          {t("kpi.objective.targetModeProgressive")} :{" "}
                          {[...indicator.targetSchedule]
                            .sort((a, b) => a.period.localeCompare(b.period))
                            .map(
                              (step) =>
                                `${step.period} → ${step.value}${indicator.unit ? ` ${indicator.unit}` : ""}`
                            )
                            .join(" · ")}
                        </p>
                      )}
                  </div>
                )}
              </div>

              <PendingKpiValues indicatorId={indicator.id} unit={indicator.unit} />

              {/* Saisie d'une mesure — le cœur de la page. */}
              <div className="rounded-lg border border-border p-3">
                <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  <Plus size={13} /> {t("kpi.addMeasurement")}
                </span>

                {canFill ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="block text-[11px] font-medium text-text-secondary">
                        {t("kpi.period")}
                        <input
                          value={period}
                          onChange={(e) => setPeriod(e.target.value)}
                          placeholder={currentPeriod(indicator.frequency)}
                          className={`mt-1 ${FIELD_CLASS}`}
                        />
                      </label>
                      {quantitative && (
                        <label className="block text-[11px] font-medium text-text-secondary">
                          {t("kpi.value")}
                          {indicator.unit ? ` (${indicator.unit})` : ""}
                          <input
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            inputMode="decimal"
                            className={`mt-1 ${FIELD_CLASS}`}
                          />
                        </label>
                      )}
                    </div>
                    <label className="block text-[11px] font-medium text-text-secondary">
                      {quantitative ? t("kpi.noteOptional") : t("kpi.qualitativeNote")}
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        className={`mt-1 ${FIELD_CLASS}`}
                      />
                    </label>
                    <p className="text-[11px] text-tertiary">{t("kpi.periodHint")}</p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={submitMeasurement}
                      disabled={savingMeasurement}
                    >
                      {t("common.save")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5 rounded-md bg-bg-surface/60 p-2.5 text-xs text-text-secondary">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Lock size={12} /> {t("kpi.readOnly")}
                    </p>
                    <p>
                      {t("kpi.authorizedRoles")} : {authorizedRoles || "—"}
                    </p>
                    {additionalUsers && (
                      <p>
                        {t("kpi.authorizedUsers")} : {additionalUsers}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────────────────

export function KpiPageClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: roleLoading } = useRole();
  const {
    activeProgram,
    activeProgramId,
    programType,
    loading: programLoading,
  } = useActiveProgram();
  const {
    axes,
    users: companyUsers,
    chantiers,
    chantierActions,
    indicators,
    measurements,
    loading: dataLoading,
    addMeasurement,
    updateIndicator,
  } = useStrategicData(user?.companyId ?? null, activeProgramId, user);

  // ─── Filtres Axe / Chantier / Responsable (round 13) — 3 dropdowns à sélection UNIQUE
  // (`components/shared/Dropdown.tsx`), persistés dans l'URL sous des paramètres dédiés
  // (`axis` / `chantier` / `owner`) plutôt que le préfixe `f_` multi-valeurs du round précédent
  // (`FilterBar`, abandonné sur cette page — une seule valeur par filtre se sérialise directement,
  // pas besoin d'un `Array.join(",")`). Le contrat `?indicator=<id>` (plus bas) n'est jamais touché.
  // Round multi-sélection : chaque paramètre porte 0..n valeurs (`?axis=a,b`, encodées — voir
  // `lib/filterUtils.ts` ; une ancienne URL `?axis=a` reste valide). Vide = pas de filtre.
  const axisParam = searchParams.get("axis");
  const chantierParam = searchParams.get("chantier");
  const ownerParam = searchParams.get("owner");
  const selectedAxisIds = useMemo(() => parseFilterValues(axisParam), [axisParam]);
  const selectedChantierIds = useMemo(() => parseFilterValues(chantierParam), [chantierParam]);
  const selectedOwners = useMemo(() => parseFilterValues(ownerParam), [ownerParam]);

  // `{ scroll: false }` est OBLIGATOIRE ici : le comportement par défaut du router App Router
  // (`router.push`/`replace`) est de ramener le scroll en haut de page à CHAQUE navigation, y
  // compris une simple mise à jour de query string sur la page courante — un changement de filtre
  // faisait donc perdre sa position à l'utilisateur en pleine liste d'indicateurs. Le contrat
  // `?indicator=<id>` (plus bas) n'est pas concerné : il défile lui-même explicitement via
  // `scrollIntoView` une fois la page prête, indépendamment de ce réglage.
  const setParam = useCallback(
    (key: "axis" | "chantier" | "owner", values: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (values.length > 0) params.set(key, serializeFilterValues(values));
      else params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/kpi?${qs}` : "/kpi", { scroll: false });
    },
    [router, searchParams]
  );

  // Filtre de statut (sur la trajectoire / à risque) — piloté uniquement depuis la synthèse « Santé
  // des indicateurs » (légende du bloc héros, compteur à risque d'une ligne « Par axe ») et retiré
  // via sa puce au-dessus de la liste. Valeur unique ; toute autre valeur d'URL est ignorée.
  const statusParam = searchParams.get("status");
  const selectedStatus: IndicatorRiskStatus | null =
    statusParam === "on_track" || statusParam === "at_risk" ? statusParam : null;

  /** Plusieurs paramètres en UN seul `router.replace` (même raison que le garde-fou de cohérence
   *  plus bas : deux `setParam` successifs s'écraseraient mutuellement). `null`/[] = retirer. */
  const setParams = useCallback(
    (updates: Partial<Record<"axis" | "status", string[] | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, values] of Object.entries(updates)) {
        if (values && values.length > 0) params.set(key, serializeFilterValues(values));
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(qs ? `/kpi?${qs}` : "/kpi", { scroll: false });
    },
    [router, searchParams]
  );

  /** Ancre de la liste filtrée : un clic dans la synthèse y fait défiler en douceur. */
  const listRef = useRef<HTMLDivElement>(null);
  const scrollToList = useCallback(() => {
    // Après le rendu du nouveau filtre (la hauteur de la page change avec le périmètre).
    requestAnimationFrame(() =>
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, []);

  /** Axe unique actuellement filtré (mis en avant dans la synthèse) — `null` si 0 ou plusieurs. */
  const singleSelectedAxisId = selectedAxisIds.length === 1 ? selectedAxisIds[0] : null;

  const handleOverviewAxisClick = useCallback(
    (axisId: string) => {
      if (singleSelectedAxisId === axisId) {
        setParams({ axis: null });
        return;
      }
      setParams({ axis: [axisId] });
      scrollToList();
    },
    [singleSelectedAxisId, setParams, scrollToList]
  );

  const handleOverviewAxisAtRiskClick = useCallback(
    (axisId: string) => {
      if (singleSelectedAxisId === axisId && selectedStatus === "at_risk") {
        setParams({ axis: null, status: null });
        return;
      }
      setParams({ axis: [axisId], status: ["at_risk"] });
      scrollToList();
    },
    [singleSelectedAxisId, selectedStatus, setParams, scrollToList]
  );

  const handleOverviewStatusClick = useCallback(
    (status: IndicatorRiskStatus) => {
      if (selectedStatus === status) {
        setParams({ status: null });
        return;
      }
      setParams({ status: [status] });
      scrollToList();
    },
    [selectedStatus, setParams, scrollToList]
  );

  const axisOptions: DropdownOption[] = useMemo(
    () => axes.map((a) => ({ value: a.id, label: a.name })),
    [axes]
  );

  // Portée par `selectedAxisId` (round 15) : quand un axe est sélectionné, ne proposer que SES
  // chantiers plutôt que tous les chantiers de tous les axes — même logique de scoping que
  // `filteredIndicators` plus bas, appliquée ici à la liste d'options plutôt qu'aux indicateurs.
  const chantierGroups: DropdownGroup[] = useMemo(
    () =>
      axes
        .filter((axis) => selectedAxisIds.length === 0 || selectedAxisIds.includes(axis.id))
        .map((axis) => ({
          groupLabel: axis.name,
          options: chantiers
            .filter((c) => c.axisIds.includes(axis.id))
            .map((c) => ({ value: c.id, label: c.name })),
        }))
        .filter((group) => group.options.length > 0),
    [axes, chantiers, selectedAxisIds]
  );

  // Portée par `selectedAxisId`/`selectedChantierId` (round 15) : ne proposer que les responsables
  // d'indicateurs cohérents avec les filtres Axe/Chantier déjà actifs — mêmes deux conditions que
  // `filteredIndicators` plus bas (le filtre `owner` lui-même n'est volontairement pas appliqué
  // ici, sous peine de ne plus jamais pouvoir changer de responsable une fois un premier choisi).
  const ownerOptions: DropdownOption[] = useMemo(() => {
    const scoped = indicators.filter((i) => {
      if (selectedAxisIds.length > 0 && !selectedAxisIds.includes(i.axisId)) return false;
      if (selectedChantierIds.length > 0 && !selectedChantierIds.includes(i.chantierId ?? ""))
        return false;
      return true;
    });
    const names = new Set(
      scoped.map((i) => resolveIndicatorOwner(i, axes, chantiers, t("strategicAxes.unassigned")))
    );
    return Array.from(names)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [indicators, axes, chantiers, t, selectedAxisIds, selectedChantierIds]);

  // Garde-fou de cohérence (round 15) : si le changement d'axe rend le chantier ou le responsable
  // actuellement sélectionné invalide (option qui a disparu de `chantierGroups`/`ownerOptions`
  // ci-dessus), on le réinitialise plutôt que de laisser une sélection périmée filtrer
  // silencieusement `filteredIndicators` vers un résultat vide. Les deux clés sont retirées en UN
  // seul `router.replace` (plutôt que deux effets séparés appelant chacun `setParam`) : deux appels
  // successifs construiraient chacun leurs `URLSearchParams` à partir du même `searchParams` de ce
  // rendu, le second écrasant alors la suppression faite par le premier.
  useEffect(() => {
    // Tant que `useStrategicData` charge encore, `axes`/`chantiers`/`indicators` sont des tableaux
    // vides temporaires (voir `useStrategicData.ts`) — évaluer la validité maintenant prendrait
    // n'importe quel `chantier`/`owner` déjà présent dans l'URL (ex. lien profond partagé) pour
    // invalide et l'effacerait avant même que les données réelles n'arrivent.
    if (dataLoading) return;

    // Multi-sélection : on ne retire que les valeurs devenues invalides (et la clé si plus rien).
    const validChantiers = selectedChantierIds.filter((id) => {
      const chantier = chantiers.find((c) => c.id === id);
      return (
        !!chantier &&
        (selectedAxisIds.length === 0 || chantier.axisIds.some((a) => selectedAxisIds.includes(a)))
      );
    });
    const chantierInvalid = validChantiers.length !== selectedChantierIds.length;

    const validOwnerSet = new Set(ownerOptions.map((o) => o.value));
    const validOwners = selectedOwners.filter((o) => validOwnerSet.has(o));
    const ownerInvalid = validOwners.length !== selectedOwners.length;

    if (!chantierInvalid && !ownerInvalid) return;

    const params = new URLSearchParams(searchParams.toString());
    if (chantierInvalid) {
      if (validChantiers.length > 0) params.set("chantier", serializeFilterValues(validChantiers));
      else params.delete("chantier");
    }
    if (ownerInvalid) {
      if (validOwners.length > 0) params.set("owner", serializeFilterValues(validOwners));
      else params.delete("owner");
    }
    const qs = params.toString();
    router.replace(qs ? `/kpi?${qs}` : "/kpi", { scroll: false });
  }, [
    selectedAxisIds,
    selectedChantierIds,
    selectedOwners,
    chantiers,
    ownerOptions,
    searchParams,
    router,
    dataLoading,
  ]);

  const filteredIndicators = useMemo(
    () =>
      indicators.filter((i) => {
        if (selectedAxisIds.length > 0 && !selectedAxisIds.includes(i.axisId)) return false;
        if (selectedChantierIds.length > 0 && !selectedChantierIds.includes(i.chantierId ?? ""))
          return false;
        if (
          selectedOwners.length > 0 &&
          !selectedOwners.includes(
            resolveIndicatorOwner(i, axes, chantiers, t("strategicAxes.unassigned"))
          )
        )
          return false;
        if (selectedStatus && resolveIndicatorStatus(i) !== selectedStatus) return false;
        return true;
      }),
    [
      indicators,
      axes,
      chantiers,
      t,
      selectedAxisIds,
      selectedChantierIds,
      selectedOwners,
      selectedStatus,
    ]
  );

  /** Regroupement d'affichage : par axe, puis par chantier. Les indicateurs "macro" (sans
   *  `chantierId`) ouvrent la section de leur axe ; un indicateur pointant un chantier disparu est
   *  rabattu sur le bloc macro plutôt que d'être silencieusement masqué. */
  const grouped = useMemo(() => {
    const knownChantierIds = new Set(chantiers.map((c) => c.id));
    return axes
      .map((axis) => {
        const axisIndicators = filteredIndicators.filter((i) => i.axisId === axis.id);
        const macro = axisIndicators.filter(
          (i) => !i.chantierId || !knownChantierIds.has(i.chantierId)
        );
        const byChantier = chantiers
          .filter((c) => c.axisIds.includes(axis.id))
          .map((chantier) => ({
            chantier,
            indicators: axisIndicators.filter((i) => i.chantierId === chantier.id),
          }))
          .filter((group) => group.indicators.length > 0);
        return { axis, macro, byChantier };
      })
      .filter((group) => group.macro.length > 0 || group.byChantier.length > 0);
  }, [axes, chantiers, filteredIndicators]);

  /** Indicateurs dont l'axe n'existe plus (ou n'est pas encore chargé) — affichés à part plutôt
   *  que perdus : ce sont des indicateurs à renseigner comme les autres. */
  const orphans = useMemo(() => {
    const knownAxisIds = new Set(axes.map((a) => a.id));
    return filteredIndicators.filter((i) => !knownAxisIds.has(i.axisId));
  }, [axes, filteredIndicators]);

  const measurementsByIndicator = useMemo(() => {
    const map = new Map<string, IndicatorMeasurement[]>();
    for (const m of measurements) {
      const bucket = map.get(m.indicatorId);
      if (bucket) bucket.push(m);
      else map.set(m.indicatorId, [m]);
    }
    return map;
  }, [measurements]);

  /** Numérotation globale des KPI (round 10) — seul point de vérité `axisLogic.numberIndicators`,
   *  répliqué nulle part ailleurs. Un indicateur "orphelin" (voir `orphans` ci-dessus) n'a pas de
   *  numéro : `IndicatorCard` omet alors simplement son badge. */
  const indicatorNumbers = useMemo(
    () => numberIndicators(axes, chantiers, indicators),
    [axes, chantiers, indicators]
  );

  /** Réponse à "quels chantiers ont un LEVIER qui déclare cet indicateur comme son KPI lié"
   *  (round 23, remplace l'ancien `chantierNamesByAxisId` — qui listait TOUS les chantiers de
   *  l'axe sans rapport avec l'indicateur affiché). Construit depuis `chantierActions` (déjà
   *  souscrit par `useStrategicData`, aucun aller-retour Firestore supplémentaire) plutôt que
   *  depuis un champ inverse sur `Indicator`, qui n'existe pas : le lien est porté par le levier
   *  (`ChantierAction.indicatorId`), jamais par l'indicateur lui-même. */
  const chantiersByIndicatorId = useMemo(() => {
    const idsByIndicator = new Map<string, Set<string>>();
    for (const action of chantierActions) {
      if (!action.indicatorId) continue;
      const bucket = idsByIndicator.get(action.indicatorId);
      if (bucket) bucket.add(action.chantierId);
      else idsByIndicator.set(action.indicatorId, new Set([action.chantierId]));
    }
    const chantierById = new Map<string, Chantier>(chantiers.map((c) => [c.id, c]));
    const map = new Map<string, { id: string; name: string }[]>();
    idsByIndicator.forEach((chantierIds, indicatorId) => {
      const resolved = Array.from(chantierIds)
        .map((id) => chantierById.get(id))
        .filter((c): c is Chantier => !!c)
        .map((c) => ({ id: c.id, name: c.name }));
      if (resolved.length > 0) map.set(indicatorId, resolved);
    });
    return map;
  }, [chantierActions, chantiers]);

  // ── Contrat de navigation KPI (round 10) : `/kpi?indicator=<id>` défile jusqu'à la carte visée
  // et la met brièvement en évidence — même esprit que le surlignage `focusActionId` de
  // `ChantierDetailPanel.tsx` (bordure/anneau `bp-coral` temporaire), à ceci près que là-bas la
  // cible est un prop qui reste posé tant que le panneau reste ouvert dessus, alors qu'ici on
  // n'a qu'un paramètre d'URL ponctuel : la mise en évidence est donc bornée dans le temps (elle
  // s'efface d'elle-même) plutôt que liée à la présence du paramètre.
  //
  // `pageReady` couvre TOUTES les gardes qui déterminent si l'arbre de cartes est effectivement
  // monté (voir les branches `if (...) return <skeleton/>` plus bas) : `dataLoading` seul ne
  // suffit pas — il peut retomber à `false` avant `roleLoading`/`programLoading`, l'effet se
  // déclencherait alors une fois pour rien (page encore en squelette, `getElementById` bredouille)
  // et ne serait jamais rejoué ensuite puisque ses dépendances n'auraient plus changé.
  const [highlightedIndicatorId, setHighlightedIndicatorId] = useState<string | null>(null);
  const targetIndicatorId = searchParams.get("indicator");
  const pageReady =
    !roleLoading &&
    !programLoading &&
    !dataLoading &&
    !!activeProgram &&
    programType === "strategic";
  useEffect(() => {
    if (!targetIndicatorId || !pageReady) return;
    const el = document.getElementById(`indicator-${targetIndicatorId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedIndicatorId(targetIndicatorId);
    const timeout = setTimeout(() => setHighlightedIndicatorId(null), 2500);
    return () => clearTimeout(timeout);
  }, [targetIndicatorId, pageReady]);

  // Vue Cartes (défaut, comportement historique) vs Tableau (nouvelle vue plate, sans graphique,
  // groupée par axe — voir `KpiTableView`) : les deux vues lisent EXACTEMENT le même périmètre déjà
  // filtré (`grouped`/`orphans`/`measurements`), aucune donnée séparée n'est chargée pour la vue
  // Tableau.
  const [kpiView, setKpiView] = useState<"cards" | "table">("cards");
  // Année de la vue Tableau (sélecteur partagé `YearSegmentedControl`) : « Actuel »/« Cible » y
  // sont lus sur la dernière mesure DE L'ANNÉE choisie. Défaut = historique complet, soit la
  // dernière mesure connue (comportement historique de la vue).
  const tableYear = useYearSelection(measurements, "all");

  const renderCard = (indicator: Indicator) => (
    <IndicatorCard
      key={indicator.id}
      indicator={indicator}
      measurements={measurementsByIndicator.get(indicator.id) ?? []}
      user={user}
      addMeasurement={addMeasurement}
      updateIndicator={updateIndicator}
      number={indicatorNumbers.get(indicator.id)}
      highlighted={indicator.id === highlightedIndicatorId}
      linkedChantiers={chantiersByIndicatorId.get(indicator.id) ?? []}
    />
  );

  const businessKpiLabels = {
    empty: t("businessKpis.empty"),
    noValue: t("businessKpis.noValue"),
    objective: t("kpi.objectiveValue"),
    onTrack: t("indicatorStatus.onTrack"),
    atRisk: t("indicatorStatus.atRisk"),
    fullHistory: t("kpi.chart.fullHistory"),
    chartValue: t("kpi.chart.value"),
    chartObjective: t("kpi.chart.objective"),
    progressToTarget: t("kpi.chart.progressToTarget"),
  };

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <LineChart size={22} className="text-bp-coral" />
      <h1 className="text-xl font-bold text-text-primary">{t("kpi.title")}</h1>
      {activeProgram && <span className="text-sm text-text-secondary">{activeProgram.name}</span>}
    </div>
  );

  if (roleLoading || programLoading || dataLoading) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("kpi.loading")}</p>
      </div>
    );
  }

  if (!activeProgram) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("kpi.noProgram")}</p>
      </div>
    );
  }

  // Atteinte directe par URL alors que le programme actif est un Plan Performance : la nav ne
  // propose pas cette route dans ce cas, on explique plutôt que d'afficher une page vide.
  if (programType !== "strategic") {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("kpi.notStrategic")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <p className="max-w-3xl text-sm text-text-secondary">{t("kpi.subtitle")}</p>

      {/* Pas de « cumul des indicateurs » ici : sommer des indicateurs hétérogènes n'a de sens que
          sur un Plan Performance (tout y est en euros économisés). Le haut de page porte donc le
          compteur on-track/à risque, puis les KPI business (indicateurs de niveau axe). */}
      <IndicatorStatusSummary
        indicators={indicators}
        measurements={measurements}
        showTotal={false}
        labels={{
          tracked: t("kpi.summary.tracked"),
          onTrack: t("kpi.summary.onTrack"),
          atRisk: t("kpi.summary.atRisk"),
          indicatorsSuffix: t("kpi.summary.indicatorsSuffix"),
          title: t("kpi.summary.title", "Santé des indicateurs"),
          byAxis: t("kpi.summary.byAxis", "Par axe"),
          ofIndicators: t("kpi.summary.ofIndicators", "des indicateurs"),
        }}
        axes={axes}
        interaction={{
          selectedAxisId: singleSelectedAxisId,
          selectedStatus,
          onAxisClick: handleOverviewAxisClick,
          onAxisAtRiskClick: handleOverviewAxisAtRiskClick,
          onStatusClick: handleOverviewStatusClick,
          labels: {
            filterAxis: t("kpi.summary.filterAxis", "Filtrer les indicateurs sur l'axe {name}"),
            filterAxisAtRisk: t(
              "kpi.summary.filterAxisAtRisk",
              "Afficher les indicateurs à risque de l'axe {name}"
            ),
            filterStatus: t("kpi.summary.filterStatus", "Filtrer les indicateurs : {status}"),
          },
        }}
      />

      {/* Bascule Cartes / Tableau (nouvelle vue tabulaire, sans graphique, round "cible évolutive")
          — les deux vues lisent le même périmètre déjà filtré, voir `kpiView` ci-dessus. Segmenté
          noir/blanc (round "KPI pro") plutôt que deux puces séparées : même composant visuel que
          la bascule Avancement/Arborescence de `StrategicAxesView.tsx`, pour une seule convention
          de bascule d'onglet dans tout le Plan Stratégique. */}
      <div
        className="flex w-fit overflow-hidden rounded-md border border-border"
        role="group"
        aria-label={t("kpi.view.label", "Vue")}
      >
        <button
          type="button"
          onClick={() => setKpiView("cards")}
          aria-pressed={kpiView === "cards"}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
            kpiView === "cards"
              ? "bg-black text-white"
              : "bg-white text-secondary hover:bg-bg-surface"
          }`}
        >
          <LayoutGrid size={13} /> {t("kpi.view.cards", "Cartes")}
        </button>
        <button
          type="button"
          onClick={() => setKpiView("table")}
          aria-pressed={kpiView === "table"}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
            kpiView === "table"
              ? "bg-black text-white"
              : "bg-white text-secondary hover:bg-bg-surface"
          }`}
        >
          <Table2 size={13} /> {t("kpi.view.table", "Tableau")}
        </button>
      </div>

      {/* Les KPI business (indicateurs macro) apparaissent déjà comme des lignes de la vue Tableau
          (groupe `macro` de chaque axe, voir `grouped` plus haut) — cette carte dédiée aux
          sparklines reste donc réservée à la vue Cartes, pour ne pas doubler le même indicateur. */}
      {kpiView === "cards" && (
        <Card className="mb-0">
          <CardHeader title={t("businessKpis.title")} />
          <CardBody>
            <BusinessKpiCards
              indicators={indicators}
              measurements={measurements}
              labels={businessKpiLabels}
              user={user}
              addMeasurement={addMeasurement}
            />
          </CardBody>
        </Card>
      )}

      {indicators.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-text-secondary">{t("kpi.empty")}</p>
            <p className="mt-1 text-xs text-tertiary">{t("kpi.emptyHint")}</p>
          </CardBody>
        </Card>
      ) : (
        <div ref={listRef} className="scroll-mt-4 space-y-4">
          <h2 className="relative w-fit pb-1.5 text-lg font-bold tracking-tight text-text-primary after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-7 after:bg-bp-coral">
            {t("kpi.axesSectionTitle")}
          </h2>

          {/* Filtres Axe / Chantier / Responsable (round 13) — dropdowns à sélection unique,
              placés ICI (juste au-dessus des sections qu'ils affectent) plutôt qu'en haut de page :
              le hero "sur la trajectoire" et les KPI business ci-dessus sont portfolio-wide et ne
              changent jamais avec ces filtres, les y exposer laissait croire qu'ils étaient inertes. */}
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelect
              label={t("kpi.filterAxis")}
              placeholder={t("kpi.filterAll")}
              values={selectedAxisIds}
              onChange={(v) => setParam("axis", v)}
              options={axisOptions}
            />
            <MultiSelect
              label={t("kpi.filterChantier")}
              placeholder={t("kpi.filterAll")}
              values={selectedChantierIds}
              onChange={(v) => setParam("chantier", v)}
              groups={chantierGroups}
            />
            <MultiSelect
              label={t("kpi.filterOwner")}
              placeholder={t("kpi.filterAll")}
              values={selectedOwners}
              onChange={(v) => setParam("owner", v)}
              options={ownerOptions}
            />
          </div>

          {/* Puces de filtre actif (axe / statut) — posées notamment par un clic dans la synthèse
              « Santé des indicateurs » ; chaque ✕ retire uniquement son critère. */}
          {(selectedAxisIds.length > 0 || selectedStatus) && (
            <div className="flex flex-wrap items-center gap-2">
              {selectedAxisIds.map((axisId) => {
                const axis = axes.find((a) => a.id === axisId);
                if (!axis) return null;
                return (
                  <FilterChip
                    key={axisId}
                    color={axis.color ?? "var(--bp-warm-taupe)"}
                    label={`${t("kpi.filterAxis", "Axe")} : ${axis.name}`}
                    removeLabel={t("kpi.filterChip.remove", "Retirer le filtre {label}").replace(
                      "{label}",
                      axis.name
                    )}
                    onRemove={() =>
                      setParams({ axis: selectedAxisIds.filter((id) => id !== axisId) })
                    }
                  />
                );
              })}
              {selectedStatus && (
                <FilterChip
                  label={`${t("kpi.filterChip.status", "Statut")} : ${
                    selectedStatus === "at_risk"
                      ? t("kpi.summary.atRisk", "À risque")
                      : t("kpi.summary.onTrack", "Sur la trajectoire")
                  }`}
                  removeLabel={t("kpi.filterChip.remove", "Retirer le filtre {label}").replace(
                    "{label}",
                    selectedStatus === "at_risk"
                      ? t("kpi.summary.atRisk", "À risque")
                      : t("kpi.summary.onTrack", "Sur la trajectoire")
                  )}
                  onRemove={() => setParams({ status: null })}
                />
              )}
            </div>
          )}

          {filteredIndicators.length === 0 && (
            <p className="text-sm text-text-secondary">
              {t("kpi.filterChip.noMatch", "Aucun indicateur ne correspond aux filtres actifs.")}
            </p>
          )}

          {kpiView === "table" && tableYear.visible && (
            <YearSegmentedControl
              years={tableYear.options}
              value={tableYear.year}
              onChange={tableYear.setYear}
            />
          )}

          {kpiView === "table" ? (
            <KpiTableView
              grouped={grouped}
              orphans={orphans}
              measurements={tableYear.filtered}
              baselineMeasurements={measurements}
              labels={{
                axisUnknown: t("kpi.axisUnknown"),
                indicator: t("kpi.table.indicator"),
                current: t("kpi.table.current"),
                target: t("kpi.table.target"),
                finalTarget: t("kpi.table.finalTarget"),
                status: t("kpi.table.status"),
                onTrack: t("indicatorStatus.onTrack"),
                atRisk: t("indicatorStatus.atRisk"),
                noValue: t("kpi.noMeasurement"),
              }}
            />
          ) : (
            <div className="space-y-8">
              {grouped.map(({ axis, macro, byChantier }) => (
                <AxisSection
                  key={axis.id}
                  axis={axis}
                  macro={macro}
                  byChantier={byChantier}
                  renderCard={renderCard}
                  users={companyUsers}
                />
              ))}
              {orphans.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">
                    {t("kpi.axisUnknown")}
                  </h2>
                  <div className="space-y-4">{orphans.map(renderCard)}</div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AxisSection({
  axis,
  macro,
  byChantier,
  renderCard,
  users,
}: {
  users?: AuthUser[];
  axis: StrategicAxis;
  macro: Indicator[];
  byChantier: { chantier: Chantier; indicators: Indicator[] }[];
  renderCard: (indicator: Indicator) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-1.5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">{axis.name}</h2>
        {axis.owner && (
          <span className="text-xs text-text-secondary">
            {t("strategicAxes.sponsorShort", "Commanditaire")} :{" "}
            {resolveUserFullName(axis.owner, users)}
          </span>
        )}
      </div>

      {macro.length > 0 && (
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
            {t("kpi.macroIndicators")}
          </p>
          {macro.map(renderCard)}
        </div>
      )}

      {byChantier.map(({ chantier, indicators: chantierIndicators }) => (
        <div key={chantier.id} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border border-l-4 border-l-bp-coral bg-bg-surface px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("kpi.chantier")}
            </span>
            <button
              type="button"
              onClick={() => router.push(`/levers?chantier=${chantier.id}`)}
              title={t("kpi.section.openChantier", "Ouvrir le chantier")}
              className="min-w-0 cursor-pointer break-words text-left text-base font-bold text-text-primary hover:text-bp-coral hover:underline"
            >
              {chantier.name}
            </button>
            <span className="ml-auto rounded-full bg-bp-coral/10 px-2 py-0.5 text-[11px] font-semibold text-bp-coral">
              {chantierIndicators.length} {t("kpi.section.kpis", "KPI")}
            </span>
          </div>
          {chantierIndicators.map(renderCard)}
        </div>
      ))}
    </section>
  );
}

/** Puce de filtre actif, retirable (✕) — pastille de la couleur de l'axe si fournie. */
function FilterChip({
  label,
  removeLabel,
  onRemove,
  color,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
  color?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white py-0.5 pl-2.5 pr-1 text-xs font-semibold text-text-primary shadow-sm">
      {color && (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-text-secondary transition hover:bg-neutral-100 hover:text-bp-coral focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <X size={12} />
      </button>
    </span>
  );
}
