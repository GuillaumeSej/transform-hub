"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Modal } from "@/components/shared/Modal";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { ChantierForm, type ChantierFormValues } from "@/components/strategic/ChantierForm";
import { ChantierGantt } from "@/components/strategic/ChantierGantt";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import { IndicatorStatusSummary } from "@/components/strategic/IndicatorStatusSummary";
import {
  chantierDependencyAlerts,
  latestMeasurement,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import { addDays } from "@/lib/dateUtils";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { resolveMaturityStageLabel, useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type {
  ChantierAction,
  Deliverable,
  DeliverablePhase,
  Indicator,
  MaturityStageConfig,
} from "@/types";

/**
 * Fiche d'identité d'un axe stratégique — servie sur la même route que la fiche levier
 * (`/levers/detail?id=…`, voir le routeur `LeverDetailClient`), l'id étant résolu parmi les axes
 * du programme actif plutôt que parmi les leviers.
 *
 * Trois blocs, dans cet ordre :
 *  1. compteur d'ensemble des indicateurs de l'axe (`IndicatorStatusSummary`) + alertes de cascade
 *     de dépendance entre chantiers ;
 *  2. Gantt des chantiers (`ChantierGantt`) avec la pop-up de détail chantier/actions/livrables ;
 *  3. indicateurs de l'axe EN LECTURE SEULE — macro d'abord, puis groupés par chantier.
 *
 * La lecture seule des indicateurs est une décision de conception explicite (voir plan, section
 * « Page KPI ») : la saisie d'une mesure et la ré-édition de l'objectif/seuil vivent à UN SEUL
 * endroit, la page KPI, pour éviter deux flux de saisie divergents sur la même donnée. Cette page
 * reste une fiche d'identité, comme la fiche levier côté Performance.
 */

type ChantierActionFormValues = Pick<
  ChantierAction,
  "name" | "description" | "owner" | "start" | "end" | "status" | "deliverables"
>;

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

/** Variante compacte, sans `w-full` : les deux dates d'une sous-étape de livrable tiennent sur une
 *  même ligne. */
const SMALL_INPUT_CLASS =
  "mt-0.5 rounded-md border border-border bg-white px-2 py-1 text-[12px] text-primary outline-none focus:border-bp-coral";

/** Ids générés côté client pour les livrables et leurs sous-étapes, sur le modèle de `makeActionId`
 *  (lib/leverExcelImport.ts) : jamais affichés, seulement des clés stables de liste et de patch. Le
 *  compteur de module évite la collision de deux créations dans la même milliseconde. */
let deliverableSeq = 0;
function makeDeliverableId(): string {
  deliverableSeq += 1;
  return `deliverable-${Date.now()}-${deliverableSeq}`;
}
function makePhaseId(): string {
  deliverableSeq += 1;
  return `phase-${Date.now()}-${deliverableSeq}`;
}

/** Normalise `ChantierAction.deliverables` en `Deliverable[]`. Défensif à l'égard des actions
 *  écrites AVANT ce modèle, où un livrable était une simple chaîne (`string[]`) : ces documents
 *  Firestore existent déjà et feraient planter la lecture de `.phases`. */
function normalizeDeliverables(raw: ChantierAction["deliverables"]): Deliverable[] {
  return (raw ?? []).map((d, i) =>
    typeof d === "string"
      ? { id: `legacy-${i}`, label: d, phases: [] }
      : { ...d, phases: d.phases ?? [] }
  );
}

/** Formulaire d'action de chantier, rendu INLINE dans la pop-up du chantier (et non dans une
 *  seconde `Modal`) : deux dialogues Radix superposés piègent le focus et ferment le mauvais
 *  niveau à l'Échap. Volontairement distinct de `components/shared/ActionForm.tsx`, entièrement
 *  bâti autour des lignes d'impact financières (CAPEX/gains/centre de coût) qui n'existent pas
 *  ici — les seuls champs communs sont le nom et les deux dates. */
function ChantierActionForm({
  initial,
  stages,
  onSubmit,
  onCancel,
  labels,
}: {
  initial?: Partial<ChantierActionFormValues>;
  stages: MaturityStageConfig[];
  onSubmit: (values: ChantierActionFormValues) => void | Promise<void>;
  onCancel: () => void;
  labels: {
    name: string;
    owner: string;
    start: string;
    end: string;
    stage: string;
    description: string;
    deliverables: string;
    deliverablesHint: string;
    noDeliverables: string;
    deliverableLabel: string;
    addDeliverable: string;
    removeDeliverable: string;
    noPhases: string;
    phaseStart: string;
    phaseEnd: string;
    addPhase: string;
    removePhase: string;
    submit: string;
    cancel: string;
  };
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(initial?.name ?? "");
  const [owner, setOwner] = useState(initial?.owner ?? "");
  const [start, setStart] = useState(initial?.start ?? today);
  const [end, setEnd] = useState(initial?.end ?? addDays(today, 30));
  const [status, setStatus] = useState(initial?.status ?? stages[0]?.id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Un champ de saisie PAR livrable (plus de convention « une ligne = un livrable »), chacun
  // portant ses propres sous-étapes temporelles.
  const [deliverables, setDeliverables] = useState<Deliverable[]>(() =>
    normalizeDeliverables(initial?.deliverables)
  );
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && start.length > 0 && end.length > 0 && !submitting;

  const patchDeliverable = (id: string, patch: Partial<Deliverable>) =>
    setDeliverables((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const patchPhase = (deliverableId: string, phaseId: string, patch: Partial<DeliverablePhase>) =>
    setDeliverables((list) =>
      list.map((d) =>
        d.id === deliverableId
          ? { ...d, phases: d.phases.map((p) => (p.id === phaseId ? { ...p, ...patch } : p)) }
          : d
      )
    );

  const addDeliverable = () =>
    setDeliverables((list) => [...list, { id: makeDeliverableId(), label: "", phases: [] }]);

  const removeDeliverable = (id: string) =>
    setDeliverables((list) => list.filter((d) => d.id !== id));

  /** Une nouvelle sous-étape reprend par défaut les bornes de l'action : c'est la plage la plus
   *  probable, et cela évite deux champs date vides que l'on filtrerait au submit. */
  const addPhase = (deliverableId: string) =>
    setDeliverables((list) =>
      list.map((d) =>
        d.id === deliverableId
          ? { ...d, phases: [...d.phases, { id: makePhaseId(), start, end }] }
          : d
      )
    );

  const removePhase = (deliverableId: string, phaseId: string) =>
    setDeliverables((list) =>
      list.map((d) =>
        d.id === deliverableId ? { ...d, phases: d.phases.filter((p) => p.id !== phaseId) } : d
      )
    );

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Même esprit que l'ancien `.filter(Boolean)` sur les lignes : un livrable sans intitulé
      // n'est pas écrit, et une sous-étape dont une borne a été vidée est ignorée.
      const parsed = deliverables
        .map((d) => ({
          ...d,
          label: d.label.trim(),
          phases: d.phases.filter((p) => p.start.length > 0 && p.end.length > 0),
        }))
        .filter((d) => d.label.length > 0);
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        owner: owner.trim() || undefined,
        start,
        end,
        status,
        deliverables: parsed.length > 0 ? parsed : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-neutral-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-secondary" htmlFor="ca-name">
            {labels.name}
          </label>
          <input
            id="ca-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-owner">
            {labels.owner}
          </label>
          <input
            id="ca-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-stage">
            {labels.stage}
          </label>
          <select
            id="ca-stage"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={INPUT_CLASS}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-start">
            {labels.start}
          </label>
          <input
            id="ca-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-end">
            {labels.end}
          </label>
          <input
            id="ca-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-secondary" htmlFor="ca-description">
          {labels.description}
        </label>
        <textarea
          id="ca-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <span className="text-xs font-medium text-secondary">{labels.deliverables}</span>
        <p className="mt-0.5 text-[11px] text-tertiary">{labels.deliverablesHint}</p>

        {deliverables.length === 0 ? (
          <p className="mt-2 text-[12px] text-tertiary">{labels.noDeliverables}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {deliverables.map((d, i) => (
              <li key={d.id} className="rounded-md border border-border bg-white p-2.5">
                <div className="flex items-start gap-2">
                  <input
                    aria-label={`${labels.deliverableLabel} ${i + 1}`}
                    value={d.label}
                    onChange={(e) => patchDeliverable(d.id, { label: e.target.value })}
                    placeholder={labels.deliverableLabel}
                    className="w-full min-w-0 rounded-md border border-border bg-white px-2 py-1.5 text-[13px] text-primary outline-none focus:border-bp-coral"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={labels.removeDeliverable}
                    title={labels.removeDeliverable}
                    onClick={() => removeDeliverable(d.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>

                <div className="mt-2 space-y-1.5 border-l border-border pl-2.5">
                  {d.phases.length === 0 && (
                    <p className="text-[11px] text-tertiary">{labels.noPhases}</p>
                  )}
                  {d.phases.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-end gap-2">
                      <div>
                        <label
                          className="text-[10.5px] font-medium text-tertiary"
                          htmlFor={`ca-phase-${p.id}-start`}
                        >
                          {labels.phaseStart}
                        </label>
                        <input
                          id={`ca-phase-${p.id}-start`}
                          type="date"
                          value={p.start}
                          onChange={(e) => patchPhase(d.id, p.id, { start: e.target.value })}
                          className={`block ${SMALL_INPUT_CLASS}`}
                        />
                      </div>
                      <div>
                        <label
                          className="text-[10.5px] font-medium text-tertiary"
                          htmlFor={`ca-phase-${p.id}-end`}
                        >
                          {labels.phaseEnd}
                        </label>
                        <input
                          id={`ca-phase-${p.id}-end`}
                          type="date"
                          value={p.end}
                          onChange={(e) => patchPhase(d.id, p.id, { end: e.target.value })}
                          className={`block ${SMALL_INPUT_CLASS}`}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={labels.removePhase}
                        title={labels.removePhase}
                        onClick={() => removePhase(d.id, p.id)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => addPhase(d.id)}>
                    <Plus size={12} /> {labels.addPhase}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={addDeliverable}>
            <Plus size={12} /> {labels.addDeliverable}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>
          {labels.submit}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {labels.cancel}
        </Button>
      </div>
    </div>
  );
}

export function AxisDetailClient() {
  const { user } = useRole();
  const { activeProgramId } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const id = searchParams.get("id") ?? "";
  /** Chantier à ouvrir d'emblée, passé par la vue portefeuille (voir le `useEffect` plus bas). */
  const requestedChantierId = searchParams.get("chantier") ?? "";

  const data = useStrategicData(user?.companyId ?? null, activeProgramId);
  const stages = useMaturityStages(activeProgramId);

  const [editAxisOpen, setEditAxisOpen] = useState(false);
  const [newChantierOpen, setNewChantierOpen] = useState(false);
  const [chantierModal, setChantierModal] = useState<{
    chantierId: string;
    focusActionId?: string;
  } | null>(null);
  const [actionForm, setActionForm] = useState<{
    mode: "create" | "edit";
    actionId?: string;
  } | null>(null);
  /** Suppression en deux temps (clic → « Confirmer »), plutôt qu'un `window.confirm()` natif —
   *  aucun autre écran de l'app n'utilise de dialogue natif. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const axis = useMemo(() => data.axes.find((a) => a.id === id), [data.axes, id]);
  const axisChantiers = useMemo(
    () => (axis ? data.chantiers.filter((c) => c.axisId === axis.id) : []),
    [data.chantiers, axis]
  );
  const chantierIds = useMemo(() => new Set(axisChantiers.map((c) => c.id)), [axisChantiers]);
  const axisActions = useMemo(
    () => data.chantierActions.filter((a) => chantierIds.has(a.chantierId)),
    [data.chantierActions, chantierIds]
  );
  const axisIndicators = useMemo(
    () => (axis ? data.indicators.filter((i) => i.axisId === axis.id) : []),
    [data.indicators, axis]
  );

  // Les dépendances sont évaluées sur TOUT le programme (un chantier de cet axe peut dépendre du
  // chantier d'un autre axe — cas explicitement prévu par le modèle), puis restreintes aux
  // alertes qui touchent un chantier de cet axe, dans un sens ou dans l'autre.
  const alerts = useMemo(() => {
    const all = chantierDependencyAlerts(data.chantiers, data.chantierActions);
    return all.filter((a) => chantierIds.has(a.sourceId) || chantierIds.has(a.targetId));
  }, [data.chantiers, data.chantierActions, chantierIds]);
  const alertedChantierIds = useMemo(
    () => new Set(alerts.flatMap((a) => [a.sourceId, a.targetId])),
    [alerts]
  );

  const openChantier = useCallback((chantierId: string, focusActionId?: string) => {
    setChantierModal({ chantierId, focusActionId });
    setActionForm(null);
    setPendingDelete(null);
  }, []);

  /** Ouverture directe d'un chantier depuis l'URL (`/levers/detail?id=…&chantier=…`), utilisée par
   *  la vue « chantiers groupés par axe » du portefeuille. UNE seule fois : le garde-fou `ref`
   *  évite de rouvrir la pop-up si l'utilisateur la referme alors que le paramètre est toujours
   *  dans l'URL. Le chantier doit appartenir à cet axe — sinon on ignore silencieusement. */
  const autoOpenedChantierRef = useRef(false);
  useEffect(() => {
    if (autoOpenedChantierRef.current || !requestedChantierId) return;
    if (!axisChantiers.some((c) => c.id === requestedChantierId)) return;
    autoOpenedChantierRef.current = true;
    openChantier(requestedChantierId);
  }, [requestedChantierId, axisChantiers, openChantier]);

  if (data.loading) {
    return (
      <div className="rounded-lg border border-border bg-white p-10 text-center text-sm text-tertiary">
        {t("strategicAxes.loading")}
      </div>
    );
  }

  if (!axis) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        {t("strategicAxes.notFound")}{" "}
        <button
          onClick={() => router.push("/levers")}
          className="font-medium text-bp-coral hover:underline"
        >
          {t("strategicAxes.back")}
        </button>
      </div>
    );
  }

  const cycle = stages.filter((s) => !s.isTerminal);
  const terminals = stages.filter((s) => s.isTerminal);
  const currentIndex = cycle.findIndex((s) => s.id === axis.stage);

  const setStage = async (stageId: string) => {
    if (stageId === axis.stage) return;
    await data.updateAxis(axis.id, { stage: stageId });
    showToast(
      t("strategicAxes.stageUpdated"),
      `${axis.name} : ${resolveMaturityStageLabel(stageId, stages)}`,
      "success"
    );
  };

  const activeChantier = chantierModal
    ? axisChantiers.find((c) => c.id === chantierModal.chantierId)
    : undefined;
  const activeChantierActions = activeChantier
    ? axisActions
        .filter((a) => a.chantierId === activeChantier.id)
        .sort((a, b) => a.start.localeCompare(b.start))
    : [];
  const editedAction =
    actionForm?.mode === "edit"
      ? activeChantierActions.find((a) => a.id === actionForm.actionId)
      : undefined;

  const actionFormLabels = {
    name: t("strategicAxes.actionName"),
    owner: t("strategicAxes.actionOwner"),
    start: t("strategicAxes.actionStart"),
    end: t("strategicAxes.actionEnd"),
    stage: t("strategicAxes.actionStage"),
    description: t("strategicAxes.actionDescription"),
    deliverables: t("strategicAxes.deliverables"),
    deliverablesHint: t("strategicAxes.deliverablesHint"),
    noDeliverables: t("strategicAxes.noDeliverables"),
    deliverableLabel: t("strategicAxes.deliverableLabel"),
    addDeliverable: t("strategicAxes.addDeliverable"),
    removeDeliverable: t("strategicAxes.removeDeliverable"),
    noPhases: t("strategicAxes.noPhases"),
    phaseStart: t("strategicAxes.phaseStart"),
    phaseEnd: t("strategicAxes.phaseEnd"),
    addPhase: t("strategicAxes.addPhase"),
    removePhase: t("strategicAxes.removePhase"),
    submit: t("common.save"),
    cancel: t("common.cancel"),
  };

  /** Carte d'un indicateur — LECTURE SEULE (voir en-tête de fichier) : graphique, dernière valeur,
   *  badge de statut effectif. Aucun contrôle de saisie ni d'édition d'objectif. */
  const renderIndicator = (indicator: Indicator) => {
    const measures = data.measurements.filter((m) => m.indicatorId === indicator.id);
    const latest = latestMeasurement(indicator.id, data.measurements);
    return (
      <div key={indicator.id} className="rounded-lg border border-border bg-white p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-primary">{indicator.name}</div>
            <div className="mt-0.5 text-[11px] text-tertiary">
              {t("strategicAxes.objective")} : {indicator.objective} ·{" "}
              {t(`strategicAxes.freq.${indicator.frequency}`)}
            </div>
          </div>
          <IndicatorStatusBadge
            status={resolveIndicatorStatus(indicator)}
            label={t(
              resolveIndicatorStatus(indicator) === "at_risk"
                ? "indicatorStatus.atRisk"
                : "indicatorStatus.onTrack"
            )}
          />
        </div>

        <div className="mt-2 text-[11px] text-secondary">
          {t("strategicAxes.latestValue")} :{" "}
          <strong className="text-primary">
            {latest?.value !== undefined
              ? `${latest.value}${indicator.unit ? ` ${indicator.unit}` : ""}`
              : (latest?.note ?? t("strategicAxes.noMeasurement"))}
          </strong>
          {latest && <span className="text-tertiary"> · {latest.period}</span>}
        </div>

        <div className="mt-2">
          <IndicatorChart
            measurements={measures}
            objectiveValue={indicator.objectiveValue}
            unit={indicator.unit}
            qualitative={indicator.kind === "qualitative"}
            height={160}
            labelValue={t("strategicAxes.chartValue")}
            labelObjective={t("strategicAxes.chartObjective")}
            emptyLabel={t("strategicAxes.chartEmpty")}
          />
        </div>
      </div>
    );
  };

  const macroIndicators = axisIndicators.filter((i) => !i.chantierId);

  return (
    <div className="animate-fade-up">
      <button
        onClick={() => router.push("/levers")}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary hover:underline"
      >
        <ArrowLeft size={13} /> {t("strategicAxes.back")}
      </button>

      {/* ── En-tête ────────────────────────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
            />
            <h1 className="text-xl font-bold text-primary">{axis.name}</h1>
            <AxisStageBadge stageId={axis.stage} stages={stages} />
          </div>
          {axis.description && (
            <p className="mt-1.5 max-w-2xl text-[13px] text-secondary">{axis.description}</p>
          )}
          <div className="mt-1 text-[11px] text-tertiary">
            {t("strategicAxes.owner")} : {axis.owner ?? t("strategicAxes.unassigned")}
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditAxisOpen(true)}>
          <Pencil size={13} /> {t("strategicAxes.editAxis")}
        </Button>
      </div>

      <Modal
        open={editAxisOpen}
        onOpenChange={setEditAxisOpen}
        title={t("strategicAxes.editAxisModalTitle")}
        maxWidth="640px"
      >
        <AxisForm
          initial={axis}
          stages={stages}
          submitLabel={t("common.save")}
          onCancel={() => setEditAxisOpen(false)}
          onSubmit={async (values: AxisFormValues) => {
            await data.updateAxis(axis.id, values);
            setEditAxisOpen(false);
            showToast(t("strategicAxes.axisUpdated"), values.name, "success");
          }}
        />
      </Modal>

      {/* ── Stepper d'étape de maturité ────────────────────────────────────────────────────── */}
      <div className="mb-4 rounded-lg border border-border bg-white px-4 py-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
          {t("axisStage.label")}
        </div>
        {stages.length === 0 ? (
          <p className="text-xs text-tertiary">{t("axisStage.none")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap">
              {cycle.map((s, i) => {
                const isCurrent = axis.stage === s.id;
                const isPast = currentIndex > -1 && i < currentIndex;
                return (
                  <div
                    key={s.id}
                    className="flex min-w-0 flex-1 basis-[30%] items-center gap-1 sm:basis-auto"
                  >
                    <button
                      onClick={() => setStage(s.id)}
                      title={s.label}
                      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 transition hover:border-black ${
                        isCurrent
                          ? "border-bp-coral bg-black text-white"
                          : isPast
                            ? "border-rag-green bg-rag-green-light text-rag-green-dark"
                            : "border-border bg-neutral-50 text-secondary"
                      }`}
                    >
                      <span className="text-[13px] font-bold">{i + 1}</span>
                      <span className="w-full text-center text-[10px] font-semibold uppercase tracking-wide">
                        {s.label}
                      </span>
                    </button>
                    {i < cycle.length - 1 && (
                      <ArrowRight size={12} className="hidden shrink-0 text-tertiary sm:block" />
                    )}
                  </div>
                );
              })}
            </div>
            {terminals.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-tertiary">{t("axisStage.terminal")} :</span>
                {terminals.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStage(s.id)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition hover:border-black ${
                      axis.stage === s.id
                        ? "border-black bg-black text-white"
                        : "border-border bg-white text-secondary"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Compteur d'ensemble des indicateurs de l'axe ───────────────────────────────────── */}
      <IndicatorStatusSummary
        indicators={axisIndicators}
        measurements={data.measurements}
        showTotal={false}
        labels={{
          tracked: t("strategicAxes.summaryTracked"),
          onTrack: t("indicatorStatus.onTrack"),
          atRisk: t("indicatorStatus.atRisk"),
          indicatorsSuffix: t("strategicAxes.indicatorsCount"),
        }}
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
      />

      {/* ── Alertes de cascade de dépendance entre chantiers ───────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-rag-amber bg-rag-amber-light p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-rag-amber">
            <TriangleAlert size={14} /> {t("strategicAxes.dependencyAlerts")}
          </div>
          <ul className="space-y-1.5">
            {alerts.map((alert) => (
              <li
                key={`${alert.sourceId}-${alert.targetId}-${alert.type}`}
                className="flex flex-wrap items-center gap-2 text-[12px] text-primary"
              >
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-secondary">
                  {t(`dep.${alert.type.toLowerCase()}`)}
                </span>
                <span>{alert.message}</span>
                <span className="font-semibold">
                  {alert.delayDays} {t("strategicAxes.dependencyDelay")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Gantt des chantiers ────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={t("strategicAxes.ganttSection")}
          actions={
            <Button variant="outline" size="sm" onClick={() => setNewChantierOpen(true)}>
              <Plus size={12} /> {t("strategicAxes.newChantier")}
            </Button>
          }
        />
        <CardBody>
          <p className="mb-3 text-[11.5px] text-tertiary">{t("strategicAxes.ganttHint")}</p>
          <ChantierGantt
            chantiers={axisChantiers}
            actions={axisActions}
            stages={stages}
            alertedChantierIds={alertedChantierIds}
            onChantierClick={(c) => openChantier(c.id)}
            onActionClick={(action, c) => openChantier(c.id, action.id)}
            labels={{
              empty: t("strategicAxes.noChantiers"),
              unplannedTitle: t("strategicAxes.chantierUnplanned"),
              noDates: t("strategicAxes.chantierNoDates"),
              actionsSuffix: t("strategicAxes.actionsSuffix"),
            }}
          />
        </CardBody>
      </Card>

      <Modal
        open={newChantierOpen}
        onOpenChange={setNewChantierOpen}
        title={t("strategicAxes.newChantierModalTitle")}
        maxWidth="640px"
      >
        <ChantierForm
          initial={{ axisId: axis.id }}
          axes={data.axes}
          stages={stages}
          submitLabel={t("strategicAxes.createChantier")}
          onCancel={() => setNewChantierOpen(false)}
          onSubmit={async (values: ChantierFormValues) => {
            const created = await data.createChantier(values);
            setNewChantierOpen(false);
            showToast(t("strategicAxes.chantierCreated"), created.name, "success");
            openChantier(created.id);
          }}
        />
      </Modal>

      {/* ── Pop-up de détail d'un chantier (bloc Gantt OU action cliquée) ──────────────────── */}
      <Modal
        open={activeChantier !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setChantierModal(null);
            setActionForm(null);
            setPendingDelete(null);
          }
        }}
        title={activeChantier?.name ?? t("strategicAxes.chantierModalTitle")}
        maxWidth="720px"
      >
        {activeChantier && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AxisStageBadge stageId={activeChantier.stage} stages={stages} />
              {activeChantier.dependencies.length > 0 && (
                <span className="text-[11px] text-tertiary">
                  {t("strategicAxes.dependsOn")} :{" "}
                  {activeChantier.dependencies
                    .map(
                      (d) =>
                        `${data.chantiers.find((c) => c.id === d.targetId)?.name ?? d.targetId} (${d.type})`
                    )
                    .join(", ")}
                </span>
              )}
            </div>
            {activeChantier.description && (
              <p className="text-[13px] text-secondary">{activeChantier.description}</p>
            )}

            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[12px] font-bold uppercase tracking-wide text-primary">
                {t("strategicAxes.chantierActions")}
              </h4>
              {!actionForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActionForm({ mode: "create" })}
                >
                  <Plus size={12} /> {t("strategicAxes.newAction")}
                </Button>
              )}
            </div>

            {actionForm && (
              <ChantierActionForm
                key={actionForm.actionId ?? "new"}
                initial={editedAction}
                stages={stages}
                labels={actionFormLabels}
                onCancel={() => setActionForm(null)}
                onSubmit={async (values) => {
                  if (actionForm.mode === "edit" && actionForm.actionId) {
                    await data.updateChantierAction(actionForm.actionId, values);
                    showToast(t("strategicAxes.actionUpdated"), values.name, "success");
                  } else {
                    await data.createChantierAction({
                      ...values,
                      chantierId: activeChantier.id,
                    });
                    showToast(t("strategicAxes.actionCreated"), values.name, "success");
                  }
                  setActionForm(null);
                }}
              />
            )}

            {activeChantierActions.length === 0 && !actionForm ? (
              <p className="py-4 text-center text-[13px] text-tertiary">
                {t("strategicAxes.noActions")}
              </p>
            ) : (
              <ul className="space-y-2">
                {activeChantierActions.map((action) => {
                  const isFocused = chantierModal?.focusActionId === action.id;
                  const actionDeliverables = normalizeDeliverables(action.deliverables);
                  return (
                    <li
                      key={action.id}
                      className={`rounded-md border p-3 ${
                        isFocused ? "border-bp-coral ring-1 ring-bp-coral/40" : "border-border"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-primary">
                            {action.name}
                          </div>
                          <div className="mt-0.5 text-[11px] text-tertiary">
                            {action.start} → {action.end}
                            {action.owner ? ` · ${action.owner}` : ""} ·{" "}
                            {resolveMaturityStageLabel(action.status, stages)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActionForm({ mode: "edit", actionId: action.id })}
                          >
                            <Pencil size={12} /> {t("strategicAxes.editAction")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              if (pendingDelete !== action.id) {
                                setPendingDelete(action.id);
                                return;
                              }
                              await data.removeChantierAction(action.id);
                              setPendingDelete(null);
                              showToast(t("strategicAxes.actionDeleted"), action.name, "success");
                            }}
                          >
                            <Trash2 size={12} />{" "}
                            {pendingDelete === action.id
                              ? t("strategicAxes.confirmDelete")
                              : t("common.delete")}
                          </Button>
                        </div>
                      </div>

                      {action.description && (
                        <p className="mt-1.5 text-[12px] text-secondary">{action.description}</p>
                      )}

                      <div className="mt-2">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                          {t("strategicAxes.deliverables")}
                        </div>
                        {actionDeliverables.length === 0 ? (
                          <p className="text-[12px] text-tertiary">
                            {t("strategicAxes.noDeliverables")}
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-1.5 text-[12px] text-primary">
                            {actionDeliverables.map((d) => (
                              <li key={d.id}>
                                <span className="font-medium">{d.label}</span>
                                {/* Mini-timeline textuelle : une puce par sous-étape, dans
                                    l'ordre de saisie. */}
                                {d.phases.length > 0 && (
                                  <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                                    {d.phases.map((p) => (
                                      <span
                                        key={p.id}
                                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] text-secondary"
                                      >
                                        {p.start} → {p.end}
                                        {p.note ? ` · ${p.note}` : ""}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-border pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (pendingDelete !== activeChantier.id) {
                    setPendingDelete(activeChantier.id);
                    return;
                  }
                  // Les actions du chantier sont retirées d'abord : elles ne portent pas de
                  // `programId` et ne seraient plus rattachables à rien une fois le chantier parti.
                  for (const action of activeChantierActions) {
                    await data.removeChantierAction(action.id);
                  }
                  await data.removeChantier(activeChantier.id);
                  setPendingDelete(null);
                  setChantierModal(null);
                  showToast(t("strategicAxes.chantierDeleted"), activeChantier.name, "success");
                }}
              >
                <Trash2 size={12} />{" "}
                {pendingDelete === activeChantier.id
                  ? t("strategicAxes.confirmDeleteChantier")
                  : t("strategicAxes.deleteChantier")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Indicateurs de l'axe (lecture seule) ───────────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("strategicAxes.indicatorsSection")} />
        <CardBody>
          <p className="mb-3 text-[11.5px] text-tertiary">
            {t("strategicAxes.indicatorsReadOnly")}
          </p>

          {axisIndicators.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-tertiary">
              {t("strategicAxes.noIndicators")}
            </p>
          ) : (
            <div className="space-y-5">
              {macroIndicators.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                    {t("strategicAxes.macroIndicators")}
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {macroIndicators.map(renderIndicator)}
                  </div>
                </div>
              )}

              {axisChantiers.map((chantier) => {
                const list = axisIndicators.filter((i) => i.chantierId === chantier.id);
                if (list.length === 0) return null;
                return (
                  <div key={chantier.id}>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                      {chantier.name}
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {list.map(renderIndicator)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
