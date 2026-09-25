"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type {
  AuthUser,
  Indicator,
  IndicatorDirection,
  IndicatorFrequency,
  IndicatorKind,
  Role,
} from "@/types";
import { subscribeUsers, subscribeCompanies } from "@/lib/firestore/admin";
import { saveIndicator } from "@/lib/firestore/indicators";
import { canBeKpiResponsible, computeIndicatorStatus } from "@/lib/axisLogic";
import { roles as roleDefinitions } from "@/lib/nav-config";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { AxisForm } from "@/components/strategic/AxisForm";
import { ChantierForm } from "@/components/strategic/ChantierForm";
import { Modal } from "@/components/shared/Modal";
import { UserPicker } from "@/components/strategic/UserPicker";

/**
 * Définition des indicateurs (KPI) d'UN programme stratégique. Mirroring de
 * `components/admin/HierarchyEditor.tsx` (écriture par ligne, table desktop + cartes mobile, garde
 * de navigation `useRegisterUnsavedChanges`), avec deux différences assumées :
 *
 *  - Le composant est scopé par `programId` et n'expose AUCUN sélecteur de programme : il est
 *    monté depuis la fiche d'un programme stratégique (voir `components/admin/ProgramsPanel.tsx`),
 *    qui connaît déjà le programme courant.
 *  - Les lectures/écritures passent par `useStrategicData` (qui porte déjà l'abonnement
 *    `onSnapshot` avec garde `hasPendingWrites`, la génération d'id et le recalcul de statut) au
 *    lieu d'appels `setDoc`/`deleteDoc` bruts — seule exception, l'ÉDITION d'un indicateur écrit
 *    le document complet via `saveIndicator` (voir `save()` : un patch fusionné ne peut pas
 *    supprimer une clé, or Firestore refuse toute valeur `undefined`).
 *
 * Déblocage inline : si le programme n'a encore ni axe ni chantier, l'admin peut en créer un sans
 * quitter l'écran (`AxisForm`/`ChantierForm` en mode `compact` dans une modale) — sinon la
 * définition d'un indicateur serait bloquée par une dépendance à un autre écran.
 */

/* Responsables de saisie (décision PO) : chaque KPI a un ou des responsables NOMMÉS
 * (`Indicator.additionalAuthorizedUserIds`, usernames) — voir `canFillIndicator`
 * (lib/axisLogic.ts), seul point de vérité. L'ancienne attribution par RÔLE
 * (`responsibleRoles`, qui donnait le droit à TOUS les détenteurs du rôle) n'est plus proposée :
 * elle n'est qu'affichée (et effaçable) sur les indicateurs historiques qui la portent encore. */

/** Libellés de fréquence de reporting — définis ici faute de référentiel partagé côté `lib/`
 *  (`IndicatorFrequency` est une union fermée de 4 valeurs, sans table de libellés). */
const FREQUENCY_OPTIONS: { value: IndicatorFrequency; key: string; fallback: string }[] = [
  { value: "monthly", key: "adminIndicators.frequency.monthly", fallback: "Mensuelle" },
  { value: "quarterly", key: "adminIndicators.frequency.quarterly", fallback: "Trimestrielle" },
  { value: "semiannual", key: "adminIndicators.frequency.semiannual", fallback: "Semestrielle" },
  { value: "annual", key: "adminIndicators.frequency.annual", fallback: "Annuelle" },
];

export type IndicatorFormState = {
  name: string;
  axisId: string;
  /** "" = indicateur macro rattaché directement à l'axe (voir `Indicator.chantierId`). */
  chantierId: string;
  kind: IndicatorKind;
  frequency: IndicatorFrequency;
  objective: string;
  /** Saisi en texte pour laisser le champ vide tant qu'il n'est pas renseigné. */
  objectiveValue: string;
  direction: IndicatorDirection;
  unit: string;
  /** LEGACY — conservé tel quel à l'édition, effaçable, plus jamais ajouté (voir plus haut). */
  responsibleRoles: Role[];
  /** Responsables de saisie nommés — `AuthUser.username` (pas d'uid Firebase), voir
   *  `canFillIndicator`. */
  additionalAuthorizedUserIds: string[];
  /** "" = aucun niveau (visible par tous) — voir `Company.confidentialityLevels` et
   *  `lib/leversLogic.ts` (même mécanisme que le Plan Performance). */
  confidentialityLevel: string;
};

const EMPTY_FORM: IndicatorFormState = {
  name: "",
  axisId: "",
  chantierId: "",
  kind: "quantitative",
  frequency: "monthly",
  objective: "",
  objectiveValue: "",
  direction: "up",
  unit: "",
  responsibleRoles: [],
  additionalAuthorizedUserIds: [],
  confidentialityLevel: "",
};

/** Champs obligatoires manquants, sous forme de clés de champ. Fonction pure (testable sans React)
 *  — l'appelant traduit les clés pour construire le message d'erreur. Règles : au moins un
 *  responsable de saisie NOMMÉ (décision PO), et un indicateur quantitatif sans valeur cible ne
 *  permettrait aucun calcul de statut (`computeIndicatorStatus`). */
export function missingIndicatorFields(form: IndicatorFormState): string[] {
  const missing: string[] = [];
  if (!form.name.trim()) missing.push("name");
  if (!form.axisId) missing.push("axis");
  if (!form.objective.trim()) missing.push("objective");
  if (form.additionalAuthorizedUserIds.length === 0) missing.push("responsibleUsers");
  if (form.kind === "quantitative" && !Number.isFinite(Number(form.objectiveValue.trim() || NaN))) {
    missing.push("objectiveValue");
  }
  return missing;
}

type IndicatorOptionalFields = Partial<
  Pick<
    Indicator,
    | "chantierId"
    | "objectiveValue"
    | "direction"
    | "unit"
    | "additionalAuthorizedUserIds"
    | "confidentialityLevel"
  >
>;

/** Champs optionnels de l'indicateur, avec les clés ABSENTES quand la valeur est vide — jamais
 *  mises à `undefined` : `setDoc` rejette toute clé valant explicitement `undefined` (même
 *  précaution que `buildClearancePatch` dans `UsersPanel.tsx`). */
export function optionalIndicatorFields(form: IndicatorFormState): IndicatorOptionalFields {
  const out: IndicatorOptionalFields = {};
  if (form.chantierId) out.chantierId = form.chantierId;
  if (form.kind === "quantitative") {
    const raw = form.objectiveValue.trim();
    const value = Number(raw);
    if (raw !== "" && Number.isFinite(value)) {
      out.objectiveValue = value;
      // Le sens d'amélioration n'a de sens qu'avec une valeur cible à comparer.
      out.direction = form.direction;
    }
  }
  if (form.unit.trim()) out.unit = form.unit.trim();
  if (form.additionalAuthorizedUserIds.length > 0) {
    out.additionalAuthorizedUserIds = [...form.additionalAuthorizedUserIds];
  }
  if (form.confidentialityLevel) out.confidentialityLevel = form.confidentialityLevel;
  return out;
}

export function IndicatorsEditor({
  companyId,
  programId,
}: {
  companyId: string;
  programId: string;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const {
    axes,
    chantiers,
    indicators,
    measurements,
    loading,
    createAxis,
    createChantier,
    createIndicator,
    removeIndicator,
  } = useStrategicData(companyId, programId);
  const stages = useMaturityStages(programId, companyId);

  const [users, setUsers] = useState<AuthUser[]>([]);
  useEffect(() => {
    const unsub = subscribeUsers(
      (list) => setUsers(list.filter((u) => u.companyId === companyId)),
      companyId
    );
    return unsub;
  }, [companyId]);

  // Échelle de confidentialité de l'entreprise — même sélecteur que `components/shared/
  // LeverForm.tsx:291-300` côté Plan Performance, réutilisé ici pour l'indicateur ET pour les
  // formulaires inline de création rapide d'axe/chantier (voir modales plus bas).
  const [confidentialityLevels, setConfidentialityLevels] = useState<string[]>([]);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === companyId);
      setConfidentialityLevels(company?.confidentialityLevels ?? []);
    }, companyId);
    return unsub;
  }, [companyId]);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<IndicatorFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [axisModalOpen, setAxisModalOpen] = useState(false);
  const [chantierModalOpen, setChantierModalOpen] = useState(false);

  // Même convention que `UsersPanel`/`ProgramsPanel` : le formulaire est "dirty" dès qu'il est
  // ouvert en édition, ou ouvert en création avec au moins un champ utile renseigné — ouvrir
  // "Nouvel indicateur" sans rien saisir ne doit pas bloquer la navigation.
  const formDirty =
    showForm &&
    (editId !== null ||
      form.name.trim() !== "" ||
      form.objective.trim() !== "" ||
      form.additionalAuthorizedUserIds.length > 0);
  useRegisterUnsavedChanges(`admin:indicators:${programId}`, formDirty);

  const axisChantiers = useMemo(
    () => chantiers.filter((c) => c.axisIds.includes(form.axisId)),
    [chantiers, form.axisId]
  );

  const fieldLabel = (field: string): string => {
    switch (field) {
      case "name":
        return t("adminIndicators.name", "Nom de l'indicateur");
      case "axis":
        return t("adminIndicators.axis", "Axe de rattachement");
      case "objective":
        return t("adminIndicators.objective", "Objectif / seuil");
      case "responsibleUsers":
        return t("strategic.kpiResponsible.label", "Responsable(s) de saisie");
      case "objectiveValue":
        return t("adminIndicators.objectiveValue", "Valeur cible");
      default:
        return field;
    }
  };

  const startCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM, axisId: axes[0]?.id ?? "" });
    setShowForm(true);
  };

  const startEdit = (indicator: Indicator) => {
    setEditId(indicator.id);
    setForm({
      name: indicator.name,
      axisId: indicator.axisId,
      chantierId: indicator.chantierId ?? "",
      kind: indicator.kind,
      frequency: indicator.frequency,
      objective: indicator.objective,
      objectiveValue: indicator.objectiveValue != null ? String(indicator.objectiveValue) : "",
      direction: indicator.direction ?? "up",
      unit: indicator.unit ?? "",
      responsibleRoles: [...indicator.responsibleRoles],
      additionalAuthorizedUserIds: [...(indicator.additionalAuthorizedUserIds ?? [])],
      confidentialityLevel: indicator.confidentialityLevel ?? "",
    });
    setShowForm(true);
  };

  const addResponsible = (username: string | undefined) => {
    if (!username) return;
    setForm((f) =>
      f.additionalAuthorizedUserIds.includes(username)
        ? f
        : { ...f, additionalAuthorizedUserIds: [...f.additionalAuthorizedUserIds, username] }
    );
  };

  const removeResponsible = (username: string) => {
    setForm((f) => ({
      ...f,
      additionalAuthorizedUserIds: f.additionalAuthorizedUserIds.filter((u) => u !== username),
    }));
  };

  /** Comptes proposables (hors comex/RH, qui ne saisissent jamais) et pas déjà désignés. */
  const responsibleCandidates = useMemo(
    () =>
      users.filter(
        (u) =>
          canBeKpiResponsible(u, programId) &&
          !form.additionalAuthorizedUserIds.includes(u.username)
      ),
    [users, programId, form.additionalAuthorizedUserIds]
  );

  const save = async () => {
    const missing = missingIndicatorFields(form);
    if (missing.length > 0) {
      showToast(
        t("adminIndicators.validationTitle", "Champs obligatoires manquants"),
        `${t("adminIndicators.validationBody", "Complétez les champs suivants :")} ${missing
          .map(fieldLabel)
          .join(", ")}`,
        "error"
      );
      return;
    }
    setSaving(true);
    try {
      const optional = optionalIndicatorFields(form);
      if (editId) {
        const existing = indicators.find((i) => i.id === editId);
        if (existing) {
          // Écriture du document COMPLET (et non d'un patch fusionné via
          // `useStrategicData.updateIndicator`) : passer d'un indicateur de chantier à un
          // indicateur macro, ou de quantitatif à qualitatif, doit RETIRER les clés devenues sans
          // objet. Un patch ne peut que les écraser, et `setDoc` refuse une valeur `undefined`.
          const base = { ...existing };
          delete base.chantierId;
          delete base.objectiveValue;
          delete base.direction;
          delete base.unit;
          delete base.additionalAuthorizedUserIds;
          delete base.confidentialityLevel;
          const next: Indicator = {
            ...base,
            name: form.name.trim(),
            axisId: form.axisId,
            kind: form.kind,
            frequency: form.frequency,
            objective: form.objective.trim(),
            responsibleRoles: [...form.responsibleRoles],
            lastUpdate: new Date().toISOString().slice(0, 10),
            ...optional,
          };
          // Même recalcul que `useStrategicData.updateIndicator` : changer l'objectif ou le sens
          // change mécaniquement le verdict porté sur la dernière mesure.
          next.status = computeIndicatorStatus(next, measurements);
          await saveIndicator(next);
        }
        showToast(t("adminIndicators.updated", "Indicateur mis à jour"), form.name.trim());
      } else {
        await createIndicator({
          axisId: form.axisId,
          name: form.name.trim(),
          kind: form.kind,
          frequency: form.frequency,
          objective: form.objective.trim(),
          responsibleRoles: [...form.responsibleRoles],
          ...optional,
        });
        showToast(t("adminIndicators.created", "Indicateur créé"), form.name.trim());
      }
      setShowForm(false);
      setEditId(null);
    } catch (error) {
      console.error("[betrack] échec d'enregistrement de l'indicateur :", error);
      showToast(
        t("adminIndicators.saveErrorTitle", "Enregistrement impossible"),
        t("adminIndicators.saveError", "L'indicateur n'a pas pu être enregistré."),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (indicator: Indicator) => {
    try {
      await removeIndicator(indicator.id);
      showToast(t("adminIndicators.deleted", "Indicateur supprimé"), indicator.name);
    } catch (error) {
      console.error("[betrack] échec de suppression de l'indicateur :", error);
      showToast(
        t("adminIndicators.deleteErrorTitle", "Suppression impossible"),
        t("adminIndicators.deleteError", "L'indicateur n'a pas pu être supprimé."),
        "error"
      );
    }
  };

  const axisName = (axisId: string) => axes.find((a) => a.id === axisId)?.name ?? axisId;
  const chantierName = (chantierId: string) =>
    chantiers.find((c) => c.id === chantierId)?.name ?? chantierId;
  const roleShort = (role: Role) => {
    const key = (roleDefinitions as Partial<Record<string, { short: string }>>)[role]?.short;
    return key ? t(key, role) : role;
  };
  const userLabel = (username: string) => {
    const u = users.find((x) => x.username === username);
    return u ? u.name || `${u.firstName} ${u.lastName}`.trim() || username : username;
  };
  /** Responsables nommés ; à défaut, rôles historiques marqués « (ancien) ». */
  const responsiblesSummary = (indicator: Indicator) => {
    const named = indicator.additionalAuthorizedUserIds ?? [];
    if (named.length > 0) return named.map(userLabel).join(", ");
    if (indicator.responsibleRoles.length > 0) {
      return `${indicator.responsibleRoles.map(roleShort).join(", ")} ${t(
        "strategic.kpiResponsible.legacySuffix",
        "(ancien, par rôle)"
      )}`;
    }
    return "—";
  };
  const frequencyLabel = (frequency: IndicatorFrequency) => {
    const def = FREQUENCY_OPTIONS.find((f) => f.value === frequency);
    return def ? t(def.key, def.fallback) : frequency;
  };
  const kindLabel = (kind: IndicatorKind) =>
    kind === "quantitative"
      ? t("adminIndicators.kindQuantitative", "Quantitatif")
      : t("adminIndicators.kindQualitative", "Qualitatif");
  const objectiveSummary = (indicator: Indicator) =>
    indicator.objectiveValue != null
      ? `${indicator.objective} · ${indicator.objectiveValue}${indicator.unit ? ` ${indicator.unit}` : ""}`
      : indicator.objective;

  const inputClass =
    "mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-secondary">
          {t(
            "adminIndicators.intro",
            "Définissez les indicateurs de ce plan stratégique : leur rattachement (axe, et éventuellement chantier), leur objectif, et qui a le droit de les renseigner. Les mesures elles-mêmes sont saisies par les responsables depuis la page Indicateurs (KPI)."
          )}
        </p>
        <button
          onClick={startCreate}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
        >
          <Plus size={14} /> {t("adminIndicators.new", "Nouvel indicateur")}
        </button>
      </div>

      {showForm && (
        <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4">
          <div className="text-sm font-semibold text-text-primary">
            {editId
              ? t("adminIndicators.editTitle", "Modifier l'indicateur")
              : t("adminIndicators.createTitle", "Nouvel indicateur")}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-text-secondary" htmlFor="indicator-name">
                {t("adminIndicators.name", "Nom de l'indicateur")}
              </label>
              <input
                id="indicator-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={inputClass}
                placeholder={t(
                  "adminIndicators.namePlaceholder",
                  "Ex. Taux de satisfaction client"
                )}
              />
            </div>

            <div>
              <label
                className="text-xs font-medium text-text-secondary"
                htmlFor="indicator-frequency"
              >
                {t("adminIndicators.frequency", "Fréquence de suivi")}
              </label>
              <select
                id="indicator-frequency"
                value={form.frequency}
                onChange={(e) =>
                  setForm((f) => ({ ...f, frequency: e.target.value as IndicatorFrequency }))
                }
                className={inputClass}
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.key, option.fallback)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary" htmlFor="indicator-axis">
                {t("adminIndicators.axis", "Axe de rattachement")}
              </label>
              <div className="mt-1 flex gap-2">
                <select
                  id="indicator-axis"
                  value={form.axisId}
                  onChange={(e) =>
                    // Changer d'axe invalide le chantier sélectionné (un chantier appartient à
                    // exactement un axe) — on le réinitialise plutôt que de laisser une
                    // combinaison incohérente partir en base.
                    setForm((f) => ({ ...f, axisId: e.target.value, chantierId: "" }))
                  }
                  className="w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                >
                  <option value="">{t("adminIndicators.selectAxis", "Sélectionner…")}</option>
                  {axes.map((axis) => (
                    <option key={axis.id} value={axis.id}>
                      {axis.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAxisModalOpen(true)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-surface"
                >
                  <Plus size={13} /> {t("adminIndicators.newAxis", "Nouvel axe")}
                </button>
              </div>
              {axes.length === 0 && (
                <p className="mt-1 text-xs text-text-secondary">
                  {t(
                    "adminIndicators.noAxisHint",
                    "Aucun axe n'existe encore pour ce programme — créez-en un pour rattacher l'indicateur."
                  )}
                </p>
              )}
            </div>

            <div>
              <label
                className="text-xs font-medium text-text-secondary"
                htmlFor="indicator-chantier"
              >
                {t("adminIndicators.chantier", "Chantier (optionnel)")}
              </label>
              <div className="mt-1 flex gap-2">
                <select
                  id="indicator-chantier"
                  value={form.chantierId}
                  onChange={(e) => setForm((f) => ({ ...f, chantierId: e.target.value }))}
                  disabled={!form.axisId}
                  className="w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral disabled:opacity-50"
                >
                  <option value="">
                    {t("adminIndicators.chantierMacro", "Aucun — indicateur macro de l'axe")}
                  </option>
                  {axisChantiers.map((chantier) => (
                    <option key={chantier.id} value={chantier.id}>
                      {chantier.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setChantierModalOpen(true)}
                  disabled={!form.axisId}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-surface disabled:opacity-40"
                >
                  <Plus size={13} /> {t("adminIndicators.newChantier", "Nouveau chantier")}
                </button>
              </div>
              {!form.axisId ? (
                <p className="mt-1 text-xs text-text-secondary">
                  {t("adminIndicators.chantierPickAxisFirst", "Sélectionnez d'abord un axe.")}
                </p>
              ) : (
                // Incitation explicite du PO : beaucoup de chantiers portent leurs propres KPI —
                // les rattacher au chantier (et non à l'axe) rend le suivi exploitable par le
                // responsable de chantier lui-même.
                <p className="mt-1 text-xs text-text-secondary">
                  {t(
                    "adminIndicators.chantierLevelHint",
                    "Certains chantiers ont leurs propres KPI : n'hésitez pas à rattacher l'indicateur au chantier concerné plutôt qu'à l'axe, et à le confier à son responsable de chantier."
                  )}
                </p>
              )}
            </div>

            <fieldset>
              <legend className="text-xs font-medium text-text-secondary">
                {t("adminIndicators.kind", "Nature")}
              </legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {(
                  [
                    { value: "quantitative", label: kindLabel("quantitative") },
                    { value: "qualitative", label: kindLabel("qualitative") },
                  ] as { value: IndicatorKind; label: string }[]
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                      form.kind === option.value
                        ? "border-bp-coral bg-bp-coral/5"
                        : "border-border hover:bg-bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name="indicatorKind"
                      value={option.value}
                      checked={form.kind === option.value}
                      onChange={() => setForm((f) => ({ ...f, kind: option.value }))}
                      className="accent-bp-coral"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label className="text-xs font-medium text-text-secondary" htmlFor="indicator-unit">
                {t("adminIndicators.unit", "Unité (optionnel)")}
              </label>
              <input
                id="indicator-unit"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className={inputClass}
                placeholder={t("adminIndicators.unitPlaceholder", "%, k€, jours…")}
              />
            </div>

            {confidentialityLevels.length > 0 && (
              <div>
                <label
                  className="text-xs font-medium text-text-secondary"
                  htmlFor="indicator-confidentiality"
                >
                  {t("adminIndicators.confidentialityLevel", "Niveau de confidentialité")}
                </label>
                <select
                  id="indicator-confidentiality"
                  value={form.confidentialityLevel}
                  onChange={(e) => setForm((f) => ({ ...f, confidentialityLevel: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">
                    {t("adminIndicators.confidentialityLevelNone", "Aucun (visible par tous)")}
                  </option>
                  {confidentialityLevels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="sm:col-span-2">
              <label
                className="text-xs font-medium text-text-secondary"
                htmlFor="indicator-objective"
              >
                {t("adminIndicators.objective", "Objectif / seuil")}
              </label>
              <input
                id="indicator-objective"
                value={form.objective}
                onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
                className={inputClass}
                placeholder={t(
                  "adminIndicators.objectivePlaceholder",
                  "Ex. 90 % de satisfaction d'ici la fin de l'année"
                )}
              />
            </div>

            {/* Valeur cible et sens d'amélioration n'existent que pour un indicateur quantitatif :
                un indicateur qualitatif n'a qu'un objectif en texte libre. */}
            {form.kind === "quantitative" && (
              <div>
                <label
                  className="text-xs font-medium text-text-secondary"
                  htmlFor="indicator-objective-value"
                >
                  {t("adminIndicators.objectiveValue", "Valeur cible")}
                </label>
                <input
                  id="indicator-objective-value"
                  type="number"
                  value={form.objectiveValue}
                  onChange={(e) => setForm((f) => ({ ...f, objectiveValue: e.target.value }))}
                  className={inputClass}
                  placeholder={t("adminIndicators.objectiveValuePlaceholder", "90")}
                />
              </div>
            )}

            {form.kind === "quantitative" && form.objectiveValue.trim() !== "" && (
              <div>
                <label
                  className="text-xs font-medium text-text-secondary"
                  htmlFor="indicator-direction"
                >
                  {t("adminIndicators.direction", "Sens d'amélioration")}
                </label>
                <select
                  id="indicator-direction"
                  value={form.direction}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, direction: e.target.value as IndicatorDirection }))
                  }
                  className={inputClass}
                >
                  <option value="up">
                    {t("adminIndicators.directionUp", "Plus haut vaut mieux")}
                  </option>
                  <option value="down">
                    {t("adminIndicators.directionDown", "Plus bas vaut mieux")}
                  </option>
                </select>
              </div>
            )}
          </div>

          {/* Responsables de saisie NOMMÉS — voir `canFillIndicator` (lib/axisLogic.ts), seul point
              de vérité. La valeur saisie suit ensuite le circuit de validation (sponsor d'axe puis
              pilote), hors de cet écran. */}
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <span className="text-xs font-medium text-text-secondary">
              {t("strategic.kpiResponsible.label", "Responsable(s) de saisie")}
            </span>
            <p className="mt-1 text-xs text-text-secondary">
              {t(
                "strategic.kpiResponsible.hint",
                "Au moins une personne nommée. Peuvent aussi saisir : le pilote du plan, le sponsor du chantier (KPI de chantier) ou de l'axe (KPI d'axe) et les administrateurs. Les membres du COMEX et les RH ne saisissent jamais."
              )}
            </p>
            {form.additionalAuthorizedUserIds.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {form.additionalAuthorizedUserIds.map((username) => (
                  <li
                    key={username}
                    className="flex items-center gap-1 rounded-full bg-bp-coral px-3 py-1 text-xs font-semibold text-white"
                  >
                    <span>{userLabel(username)}</span>
                    <button
                      type="button"
                      onClick={() => removeResponsible(username)}
                      aria-label={t("strategic.kpiResponsible.remove", "Retirer {name}").replace(
                        "{name}",
                        userLabel(username)
                      )}
                      className="rounded-full hover:bg-white/20"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {users.length === 0 ? (
              <p className="mt-2 text-xs text-text-secondary">
                {t(
                  "adminIndicators.additionalUsersEmpty",
                  "Aucun utilisateur pour cette entreprise."
                )}
              </p>
            ) : (
              <div className="mt-2 max-w-sm">
                <UserPicker
                  id="indicator-responsible-add"
                  users={responsibleCandidates}
                  value={undefined}
                  onChange={addResponsible}
                  placeholder={t("strategic.kpiResponsible.add", "Ajouter un responsable…")}
                />
              </div>
            )}
            {form.responsibleRoles.length > 0 && (
              <div className="mt-3 rounded-md border border-dashed border-border p-2 text-xs text-text-secondary">
                <span>
                  {t(
                    "strategic.kpiResponsible.legacyRoles",
                    "Rôles historiques (utilisés seulement tant qu'aucun responsable n'est nommé) :"
                  )}{" "}
                  {form.responsibleRoles.map(roleShort).join(", ")}
                </span>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, responsibleRoles: [] }))}
                  className="ml-2 font-semibold text-bp-coral hover:underline"
                >
                  {t("strategic.kpiResponsible.clearLegacy", "Retirer")}
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
            >
              {t("common.save", "Enregistrer")}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setEditId(null);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            >
              {t("common.cancel", "Annuler")}
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-text-secondary">
        {loading
          ? t("adminIndicators.loading", "Chargement…")
          : t("adminIndicators.count", "{n} indicateur(s)").replace(
              "{n}",
              String(indicators.length)
            )}
      </div>

      {/* Desktop/tablette (>= sm). En dessous de sm, remplacé par des cartes empilées — même
       * pattern que HierarchyEditor/UsersPanel pour éviter tout scroll horizontal à 375px. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-elevated">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminIndicators.columnName", "Indicateur")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminIndicators.columnScope", "Axe / Chantier")}
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary md:table-cell">
                {t("adminIndicators.columnKind", "Nature")}
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary md:table-cell">
                {t("adminIndicators.columnFrequency", "Fréquence")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminIndicators.columnObjective", "Objectif")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminIndicators.columnResponsibles", "Responsables")}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                {t("adminIndicators.columnActions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {indicators.map((indicator) => (
              <tr key={indicator.id} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="px-4 py-2.5 font-medium text-text-primary">{indicator.name}</td>
                <td className="px-4 py-2.5 text-text-secondary">
                  {axisName(indicator.axisId)}
                  {indicator.chantierId ? (
                    <span className="text-text-secondary">
                      {" › "}
                      {chantierName(indicator.chantierId)}
                    </span>
                  ) : (
                    <span className="ml-2 rounded-full bg-bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      {t("adminIndicators.macroBadge", "Macro")}
                    </span>
                  )}
                </td>
                <td className="hidden px-4 py-2.5 text-text-secondary md:table-cell">
                  {kindLabel(indicator.kind)}
                </td>
                <td className="hidden px-4 py-2.5 text-text-secondary md:table-cell">
                  {frequencyLabel(indicator.frequency)}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{objectiveSummary(indicator)}</td>
                <td className="px-4 py-2.5 text-text-secondary">
                  {responsiblesSummary(indicator)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <button
                    onClick={() => startEdit(indicator)}
                    aria-label={t("adminIndicators.editTitle", "Modifier l'indicateur")}
                    className="mr-2 text-text-secondary hover:text-bp-coral"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => void remove(indicator)}
                    aria-label={t("common.delete", "Supprimer")}
                    className="text-text-secondary hover:text-rag-red"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {indicators.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-text-secondary">
                  {t("adminIndicators.empty", "Aucun indicateur défini pour ce programme.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile (< sm) : une carte par indicateur. */}
      <div className="divide-y divide-border rounded-xl border border-border sm:hidden">
        {indicators.map((indicator) => (
          <div key={indicator.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-text-primary">{indicator.name}</div>
                <div className="text-xs text-text-secondary">
                  {axisName(indicator.axisId)}
                  {indicator.chantierId ? ` › ${chantierName(indicator.chantierId)}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  onClick={() => startEdit(indicator)}
                  aria-label={t("adminIndicators.editTitle", "Modifier l'indicateur")}
                  className="text-text-secondary hover:text-bp-coral"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => void remove(indicator)}
                  aria-label={t("common.delete", "Supprimer")}
                  className="text-text-secondary hover:text-rag-red"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div className="mt-1 text-xs text-text-secondary">
              {kindLabel(indicator.kind)} · {frequencyLabel(indicator.frequency)}
            </div>
            <div className="mt-1 text-xs text-text-secondary">{objectiveSummary(indicator)}</div>
            <div className="mt-1 text-xs text-text-secondary">{responsiblesSummary(indicator)}</div>
          </div>
        ))}
        {indicators.length === 0 && (
          <div className="p-4 text-center text-sm text-text-secondary">
            {t("adminIndicators.empty", "Aucun indicateur défini pour ce programme.")}
          </div>
        )}
      </div>

      {/* Création rapide d'un axe / d'un chantier sans quitter l'écran : sans ça, définir le
          premier indicateur d'un programme neuf serait impossible (aucun axe n'existe encore). */}
      <Modal
        open={axisModalOpen}
        onOpenChange={setAxisModalOpen}
        title={t("adminIndicators.newAxisTitle", "Créer un axe")}
      >
        {stages.length === 0 && (
          <p className="mb-3 rounded-lg border border-rag-amber bg-rag-amber-light px-3 py-2 text-xs text-rag-amber">
            {t(
              "adminIndicators.noStagesHint",
              "Configurez d'abord les étapes de maturité de ce programme."
            )}
          </p>
        )}
        <AxisForm
          compact
          users={users}
          stages={stages}
          confidentialityLevels={confidentialityLevels}
          submitLabel={t("common.add", "Ajouter")}
          onCancel={() => setAxisModalOpen(false)}
          onSubmit={async (values) => {
            const axis = await createAxis(values);
            setForm((f) => ({ ...f, axisId: axis.id, chantierId: "" }));
            setAxisModalOpen(false);
            showToast(t("adminIndicators.axisCreated", "Axe créé"), axis.name);
          }}
        />
      </Modal>

      <Modal
        open={chantierModalOpen}
        onOpenChange={setChantierModalOpen}
        title={t("adminIndicators.newChantierTitle", "Créer un chantier")}
      >
        {stages.length === 0 && (
          <p className="mb-3 rounded-lg border border-rag-amber bg-rag-amber-light px-3 py-2 text-xs text-rag-amber">
            {t(
              "adminIndicators.noStagesHint",
              "Configurez d'abord les étapes de maturité de ce programme."
            )}
          </p>
        )}
        <ChantierForm
          compact
          axes={axes}
          stages={stages}
          confidentialityLevels={confidentialityLevels}
          users={users}
          initial={{ axisIds: form.axisId ? [form.axisId] : [] }}
          submitLabel={t("common.add", "Ajouter")}
          onCancel={() => setChantierModalOpen(false)}
          onSubmit={async (values) => {
            const chantier = await createChantier(values);
            // Cette surface (formulaire indicateur) garde un `axisId` scalaire propre — on relit
            // l'axe PRIMAIRE du chantier nouvellement créé (round 24, voir `types/index.ts`).
            setForm((f) => ({ ...f, axisId: chantier.axisIds[0], chantierId: chantier.id }));
            setChantierModalOpen(false);
            showToast(t("adminIndicators.chantierCreated", "Chantier créé"), chantier.name);
          }}
        />
      </Modal>
    </div>
  );
}
