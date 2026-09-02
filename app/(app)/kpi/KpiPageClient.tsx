"use client";

import { useMemo, useState } from "react";
import { LineChart, Lock, Pencil, Plus, Target } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import { IndicatorStatusSummary } from "@/components/strategic/IndicatorStatusSummary";
import { canFillIndicator, latestMeasurement, resolveIndicatorStatus } from "@/lib/axisLogic";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData, type StrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { roles as roleDefinitions } from "@/lib/nav-config";
import type {
  AuthUser,
  Chantier,
  Indicator,
  IndicatorDirection,
  IndicatorFrequency,
  IndicatorMeasurement,
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
export function currentPeriod(frequency: IndicatorFrequency, now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  switch (frequency) {
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
    case "quarterly":
      return `${year}-Q${Math.ceil(month / 3)}`;
    case "semiannual":
      return `${year}-S${month <= 6 ? 1 : 2}`;
    case "annual":
      return String(year);
  }
}

/** Parse une saisie numérique tolérante à la virgule décimale. `null` = saisie invalide,
 *  `undefined` = champ laissé vide. */
function parseNumber(raw: string): number | undefined | null {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral disabled:cursor-not-allowed disabled:opacity-60";

// ─── Carte d'un indicateur ───────────────────────────────────────────────────────────────────

function IndicatorCard({
  indicator,
  measurements,
  user,
  addMeasurement,
  updateIndicator,
}: {
  indicator: Indicator;
  /** Mesures DE CET indicateur uniquement (déjà filtrées par l'appelant). */
  measurements: IndicatorMeasurement[];
  user: AuthUser | null;
  addMeasurement: StrategicData["addMeasurement"];
  updateIndicator: StrategicData["updateIndicator"];
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const canFill = canFillIndicator(indicator, user);
  const quantitative = indicator.kind === "quantitative";
  const latest = latestMeasurement(indicator.id, measurements);

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
      await addMeasurement({
        indicatorId: indicator.id,
        period: trimmedPeriod,
        reportedBy: user.username,
        ...(parsedValue !== undefined ? { value: parsedValue } : {}),
        ...(trimmedNote !== "" ? { note: trimmedNote } : {}),
      });
      setValue("");
      setNote("");
      setPeriod(currentPeriod(indicator.frequency));
      showToast(t("kpi.measurementSaved"), indicator.name, "success");
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
    setEditingObjective(true);
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
    setSavingObjective(true);
    try {
      // Même contrainte Firestore que ci-dessus : une cible chiffrée laissée vide n'est pas
      // effacée (elle ne peut pas l'être depuis ici), elle est simplement laissée telle quelle —
      // la suppression d'une cible relève de l'écran Admin des indicateurs.
      await updateIndicator(indicator.id, {
        objective: trimmedObjective,
        ...(quantitative && parsedTarget !== undefined
          ? { objectiveValue: parsedTarget, direction: directionDraft }
          : {}),
      });
      setEditingObjective(false);
      showToast(t("kpi.objectiveSaved"), indicator.name, "success");
    } catch {
      showToast(t("kpi.saveError"), indicator.name, "error");
    } finally {
      setSavingObjective(false);
    }
  };

  const status = resolveIndicatorStatus(indicator);
  const authorizedRoles = indicator.responsibleRoles
    .map((role) => t(roleDefinitions[role].short))
    .join(", ");
  const additionalUsers = (indicator.additionalAuthorizedUserIds ?? []).join(", ");

  return (
    <Card className="mb-0">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{indicator.name}</span>
            <span className="rounded-full bg-bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
              {t(`kpi.kind.${indicator.kind}`)}
            </span>
            <span className="rounded-full bg-bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
              {t(`kpi.frequency.${indicator.frequency}`)}
            </span>
          </span>
        }
        actions={
          <IndicatorStatusBadge
            status={status}
            label={t(status === "at_risk" ? "indicatorStatus.atRisk" : "indicatorStatus.onTrack")}
          />
        }
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* ── Lecture : graphique + dernière valeur ─────────────────────────────────────── */}
          <div className="space-y-3">
            <IndicatorChart
              measurements={measurements}
              objectiveValue={indicator.objectiveValue}
              unit={indicator.unit}
              qualitative={!quantitative}
              labelValue={t("kpi.chart.value")}
              labelObjective={t("kpi.chart.objective")}
              emptyLabel={t("kpi.chart.empty")}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-text-secondary">
              <span className="font-semibold uppercase tracking-wide">{t("kpi.latestValue")}</span>
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
          </div>

          {/* ── Écriture : objectif + saisie de mesure ───────────────────────────────────── */}
          <div className="space-y-4">
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
                        {t("kpi.objectiveValue")}
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
                          onChange={(e) => setDirectionDraft(e.target.value as IndicatorDirection)}
                          className={`mt-1 ${FIELD_CLASS}`}
                        >
                          <option value="up">{t("kpi.direction.up")}</option>
                          <option value="down">{t("kpi.direction.down")}</option>
                        </select>
                      </label>
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
                      {t("kpi.objectiveValue")} : {indicator.objectiveValue}
                      {indicator.unit ? ` ${indicator.unit}` : ""} ·{" "}
                      {t(`kpi.direction.${indicator.direction ?? "up"}`)}
                    </p>
                  )}
                </div>
              )}
            </div>

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
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────────────────

export function KpiPageClient() {
  const { t } = useTranslation();
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
    indicators,
    measurements,
    loading: dataLoading,
    addMeasurement,
    updateIndicator,
  } = useStrategicData(user?.companyId ?? null, activeProgramId);

  /** Regroupement d'affichage : par axe, puis par chantier. Les indicateurs "macro" (sans
   *  `chantierId`) ouvrent la section de leur axe ; un indicateur pointant un chantier disparu est
   *  rabattu sur le bloc macro plutôt que d'être silencieusement masqué. */
  const grouped = useMemo(() => {
    const knownChantierIds = new Set(chantiers.map((c) => c.id));
    return axes
      .map((axis) => {
        const axisIndicators = indicators.filter((i) => i.axisId === axis.id);
        const macro = axisIndicators.filter(
          (i) => !i.chantierId || !knownChantierIds.has(i.chantierId)
        );
        const byChantier = chantiers
          .filter((c) => c.axisId === axis.id)
          .map((chantier) => ({
            chantier,
            indicators: axisIndicators.filter((i) => i.chantierId === chantier.id),
          }))
          .filter((group) => group.indicators.length > 0);
        return { axis, macro, byChantier };
      })
      .filter((group) => group.macro.length > 0 || group.byChantier.length > 0);
  }, [axes, chantiers, indicators]);

  /** Indicateurs dont l'axe n'existe plus (ou n'est pas encore chargé) — affichés à part plutôt
   *  que perdus : ce sont des indicateurs à renseigner comme les autres. */
  const orphans = useMemo(() => {
    const knownAxisIds = new Set(axes.map((a) => a.id));
    return indicators.filter((i) => !knownAxisIds.has(i.axisId));
  }, [axes, indicators]);

  const measurementsByIndicator = useMemo(() => {
    const map = new Map<string, IndicatorMeasurement[]>();
    for (const m of measurements) {
      const bucket = map.get(m.indicatorId);
      if (bucket) bucket.push(m);
      else map.set(m.indicatorId, [m]);
    }
    return map;
  }, [measurements]);

  const renderCard = (indicator: Indicator) => (
    <IndicatorCard
      key={indicator.id}
      indicator={indicator}
      measurements={measurementsByIndicator.get(indicator.id) ?? []}
      user={user}
      addMeasurement={addMeasurement}
      updateIndicator={updateIndicator}
    />
  );

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

      <IndicatorStatusSummary
        indicators={indicators}
        measurements={measurements}
        labels={{
          tracked: t("kpi.summary.tracked"),
          onTrack: t("kpi.summary.onTrack"),
          atRisk: t("kpi.summary.atRisk"),
          total: t("kpi.summary.total"),
          indicatorsSuffix: t("kpi.summary.indicatorsSuffix"),
        }}
      />

      {indicators.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-text-secondary">{t("kpi.empty")}</p>
            <p className="mt-1 text-xs text-tertiary">{t("kpi.emptyHint")}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ axis, macro, byChantier }) => (
            <AxisSection
              key={axis.id}
              axis={axis}
              macro={macro}
              byChantier={byChantier}
              renderCard={renderCard}
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
  );
}

function AxisSection({
  axis,
  macro,
  byChantier,
  renderCard,
}: {
  axis: StrategicAxis;
  macro: Indicator[];
  byChantier: { chantier: Chantier; indicators: Indicator[] }[];
  renderCard: (indicator: Indicator) => React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-1.5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">{axis.name}</h2>
        {axis.owner && <span className="text-xs text-text-secondary">{axis.owner}</span>}
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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
            {t("kpi.chantier")} · {chantier.name}
          </p>
          {chantierIndicators.map(renderCard)}
        </div>
      ))}
    </section>
  );
}
