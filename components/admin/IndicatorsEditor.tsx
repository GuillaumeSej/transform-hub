"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type {
  AuthUser,
  Indicator,
  IndicatorDirection,
  IndicatorFrequency,
  IndicatorKind,
  Role,
} from "@/types";
import { subscribeUsers } from "@/lib/firestore/admin";
import { saveIndicator } from "@/lib/firestore/indicators";
import { computeIndicatorStatus } from "@/lib/axisLogic";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { AxisForm } from "@/components/strategic/AxisForm";
import { ChantierForm } from "@/components/strategic/ChantierForm";
import { Modal } from "@/components/shared/Modal";

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

/** Rôles proposés comme responsables d'un indicateur. Liste volontairement DUPLIQUÉE ici (même
 *  convention que `OPERATIONAL_ROLES` dans `CompanyFieldsEditor.tsx` / `ALL_ROLES` dans
 *  `UsersPanel.tsx`) : chaque écran d'admin choisit son propre sous-ensemble de rôles, il n'y a
 *  pas de liste partagée à maintenir. `admin`/`admin_entreprise` en sont exclus : ils sont
 *  toujours autorisés par `canFillIndicator`, les proposer n'aurait aucun effet. */
const RESPONSIBLE_ROLES: { value: Role; shortKey: string; short: string; labelKey: string }[] = [
  { value: "cto", shortKey: "roles.cto.short", short: "CTO", labelKey: "roles.cto.label" },
  {
    value: "sponsor",
    shortKey: "roles.sponsor.short",
    short: "Sponsor",
    labelKey: "roles.sponsor.label",
  },
  { value: "lever", shortKey: "roles.lever.short", short: "PM", labelKey: "roles.lever.label" },
  {
    value: "finance",
    shortKey: "roles.finance.short",
    short: "Finance",
    labelKey: "roles.finance.label",
  },
  { value: "hr", shortKey: "roles.hr.short", short: "RH", labelKey: "roles.hr.label" },
  { value: "ops", shortKey: "roles.ops.short", short: "Ops", labelKey: "roles.ops.label" },
  // Profils du Plan Stratégique (organigramme 3-5-15) : un indicateur peut désormais être confié
  // au sponsor de l'axe ou au responsable du chantier concerné, pas seulement aux rôles
  // transverses historiques.
  {
    value: "strategic_lead",
    shortKey: "roles.strategicLead.short",
    short: "Pilote",
    labelKey: "roles.strategicLead.label",
  },
  {
    value: "axis_sponsor",
    shortKey: "roles.axisSponsor.short",
    short: "Sponsor axe",
    labelKey: "roles.axisSponsor.label",
  },
  {
    value: "chantier_owner",
    shortKey: "roles.chantierOwner.short",
    short: "Resp. chantier",
    labelKey: "roles.chantierOwner.label",
  },
  {
    value: "chantier_contributor",
    shortKey: "roles.chantierContributor.short",
    short: "Contributeur",
    labelKey: "roles.chantierContributor.label",
  },
  {
    value: "internal_comm",
    shortKey: "roles.internalComm.short",
    short: "Com. interne",
    labelKey: "roles.internalComm.label",
  },
  {
    value: "budget_control",
    shortKey: "roles.budgetControl.short",
    short: "Contrôle gestion",
    labelKey: "roles.budgetControl.label",
  },
];

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
  responsibleRoles: Role[];
  /** `AuthUser.username` (pas d'uid Firebase) — voir `canFillIndicator`. */
  additionalAuthorizedUserIds: string[];
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
};

/** Champs obligatoires manquants, sous forme de clés de champ. Fonction pure (testable sans React)
 *  — l'appelant traduit les clés pour construire le message d'erreur. Règles alignées sur le reste
 *  de l'app : un indicateur sans rôle responsable ne pourrait être renseigné par personne, et un
 *  indicateur quantitatif sans valeur cible ne permettrait aucun calcul de statut
 *  (`computeIndicatorStatus`). */
export function missingIndicatorFields(form: IndicatorFormState): string[] {
  const missing: string[] = [];
  if (!form.name.trim()) missing.push("name");
  if (!form.axisId) missing.push("axis");
  if (!form.objective.trim()) missing.push("objective");
  if (form.responsibleRoles.length === 0) missing.push("responsibleRoles");
  if (form.kind === "quantitative" && !Number.isFinite(Number(form.objectiveValue.trim() || NaN))) {
    missing.push("objectiveValue");
  }
  return missing;
}

type IndicatorOptionalFields = Partial<
  Pick<
    Indicator,
    "chantierId" | "objectiveValue" | "direction" | "unit" | "additionalAuthorizedUserIds"
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
  const stages = useMaturityStages(programId);

  const [users, setUsers] = useState<AuthUser[]>([]);
  useEffect(() => {
    const unsub = subscribeUsers((list) => setUsers(list.filter((u) => u.companyId === companyId)));
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
      form.responsibleRoles.length > 0);
  useRegisterUnsavedChanges(`admin:indicators:${programId}`, formDirty);

  const axisChantiers = useMemo(
    () => chantiers.filter((c) => c.axisId === form.axisId),
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
      case "responsibleRoles":
        return t("adminIndicators.responsibleRoles", "Rôles autorisés à renseigner");
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
    });
    setShowForm(true);
  };

  const toggleRole = (role: Role) => {
    setForm((f) => ({
      ...f,
      responsibleRoles: f.responsibleRoles.includes(role)
        ? f.responsibleRoles.filter((r) => r !== role)
        : [...f.responsibleRoles, role],
    }));
  };

  const toggleUser = (username: string) => {
    setForm((f) => ({
      ...f,
      additionalAuthorizedUserIds: f.additionalAuthorizedUserIds.includes(username)
        ? f.additionalAuthorizedUserIds.filter((u) => u !== username)
        : [...f.additionalAuthorizedUserIds, username],
    }));
  };

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
    const def = RESPONSIBLE_ROLES.find((r) => r.value === role);
    return def ? t(def.shortKey, def.short) : role;
  };
  const rolesSummary = (roles: Role[]) => roles.map(roleShort).join(", ") || "—";
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
                {t("adminIndicators.frequency", "Fréquence de reporting")}
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

          {/* Responsables : plusieurs rôles autorisés (multi-select), PLUS des comptes ajoutés au
              cas par cas — voir `canFillIndicator` (lib/axisLogic.ts), seul point de vérité. */}
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <span className="text-xs font-medium text-text-secondary">
              {t("adminIndicators.responsibleRoles", "Rôles autorisés à renseigner")}
            </span>
            <p className="mt-1 text-xs text-text-secondary">
              {t(
                "adminIndicators.responsibleRolesHint",
                "Au moins un rôle est requis. Les administrateurs sont toujours autorisés, quel que soit ce choix."
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RESPONSIBLE_ROLES.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  title={t(role.labelKey, role.short)}
                  aria-pressed={form.responsibleRoles.includes(role.value)}
                  onClick={() => toggleRole(role.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    form.responsibleRoles.includes(role.value)
                      ? "bg-bp-coral text-white"
                      : "border border-border text-text-secondary hover:bg-bg-elevated"
                  }`}
                >
                  {t(role.shortKey, role.short)}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <span className="text-xs font-medium text-text-secondary">
              {t("adminIndicators.additionalUsers", "Comptes additionnels autorisés")}
            </span>
            <p className="mt-1 text-xs text-text-secondary">
              {t(
                "adminIndicators.additionalUsersHint",
                "Comptes autorisés en plus des rôles ci-dessus, au cas par cas."
              )}
            </p>
            {users.length === 0 ? (
              <p className="mt-2 text-xs text-text-secondary">
                {t(
                  "adminIndicators.additionalUsersEmpty",
                  "Aucun utilisateur pour cette entreprise."
                )}
              </p>
            ) : (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {users.map((u) => (
                  <label
                    key={u.username}
                    className="flex items-center gap-2 text-xs text-text-primary"
                  >
                    <input
                      type="checkbox"
                      checked={form.additionalAuthorizedUserIds.includes(u.username)}
                      onChange={() => toggleUser(u.username)}
                      className="h-4 w-4 rounded border-border accent-bp-coral"
                    />
                    <span>{u.name || `${u.firstName} ${u.lastName}`.trim()}</span>
                    <code className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-secondary">
                      {u.username}
                    </code>
                  </label>
                ))}
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
                  {rolesSummary(indicator.responsibleRoles)}
                  {(indicator.additionalAuthorizedUserIds?.length ?? 0) > 0 && (
                    <span className="ml-1 text-text-secondary">
                      {` +${indicator.additionalAuthorizedUserIds?.length}`}
                    </span>
                  )}
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
                    className="text-text-secondary hover:text-red-500"
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
                  className="text-text-secondary hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div className="mt-1 text-xs text-text-secondary">
              {kindLabel(indicator.kind)} · {frequencyLabel(indicator.frequency)}
            </div>
            <div className="mt-1 text-xs text-text-secondary">{objectiveSummary(indicator)}</div>
            <div className="mt-1 text-xs text-text-secondary">
              {rolesSummary(indicator.responsibleRoles)}
            </div>
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
          stages={stages}
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
          initial={{ axisId: form.axisId }}
          submitLabel={t("common.add", "Ajouter")}
          onCancel={() => setChantierModalOpen(false)}
          onSubmit={async (values) => {
            const chantier = await createChantier(values);
            setForm((f) => ({ ...f, axisId: chantier.axisId, chantierId: chantier.id }));
            setChantierModalOpen(false);
            showToast(t("adminIndicators.chantierCreated", "Chantier créé"), chantier.name);
          }}
        />
      </Modal>
    </div>
  );
}
