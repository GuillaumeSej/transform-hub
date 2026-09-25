"use client";

import { useState } from "react";
import { UserPicker } from "@/components/strategic/UserPicker";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser, MaturityStageConfig, StrategicAxis } from "@/types";

/**
 * Formulaire de création/édition d'un axe stratégique. Volontairement SANS aucune logique
 * Firestore : il ne fait que collecter des champs et les remonter via `onSubmit`, pour être
 * réutilisable tel quel à la fois dans la modale « Nouvel axe » de la page Axes et dans une
 * création rapide inline (ex. depuis l'éditeur d'indicateurs, où l'on a besoin de créer un axe
 * sans quitter l'écran). L'appelant décide de la persistance (`useStrategicData.createAxis` /
 * `updateAxis`).
 */

export type AxisFormValues = Pick<
  StrategicAxis,
  "name" | "description" | "owner" | "color" | "stage" | "confidentialityLevel"
>;

const COLOR_CHOICES = ["#320300", "#FF3C47", "#806659", "#B8A99A", "#4A7C59", "#2F5D8C"];

export function AxisForm({
  users,
  initial,
  stages,
  confidentialityLevels,
  onSubmit,
  onCancel,
  submitLabel,
  compact = false,
  canEditOwner = true,
  ownerTooltip,
}: {
  /** Utilisateurs de l'entreprise, pour le `UserPicker` du responsable — même prop que
   *  `ChantierDetailPanel`/`ChantierAction` (voir `data.users`, `lib/hooks/useStrategicData.ts`). */
  users: AuthUser[];
  initial?: Partial<AxisFormValues>;
  /** Étapes de maturité du programme (voir `useMaturityStages`) — la première est proposée par
   *  défaut pour un axe neuf. */
  stages: MaturityStageConfig[];
  /** Échelle de confidentialité de l'entreprise (`Company.confidentialityLevels`) — voir
   *  `components/shared/LeverForm.tsx:291-300` pour le même sélecteur côté Plan Performance.
   *  Absente/vide = aucun sélecteur affiché (comportement non régressif : un axe sans niveau
   *  configuré reste visible par tous, exactement comme un levier sans niveau). */
  confidentialityLevels?: string[];
  onSubmit: (values: AxisFormValues) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  /** Mise en page resserrée pour une création rapide inline (une colonne, pas de description). */
  compact?: boolean;
  /** Désignation du sponsor d'axe (`owner`) : réservée au pilote du plan / aux admins
   *  (`canDesignate("axisSponsor", …)`, lib/strategicHierarchy.ts). `false` = lecture seule, avec
   *  `ownerTooltip` expliquant qui peut la modifier. Défaut `true` (appelants historiques). */
  canEditOwner?: boolean;
  ownerTooltip?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [owner, setOwner] = useState<string | undefined>(initial?.owner);
  const [color, setColor] = useState(initial?.color ?? COLOR_CHOICES[0]);
  const [stage, setStage] = useState(initial?.stage ?? stages[0]?.id ?? "");
  const [confidentialityLevel, setConfidentialityLevel] = useState(
    initial?.confidentialityLevel ?? ""
  );
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && stage.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        // Clés OMISES (jamais `undefined`) quand vides : `setDoc` rejette toute valeur
        // `undefined`, voir `optionalIndicatorFields` dans `components/admin/IndicatorsEditor.tsx`.
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(owner ? { owner } : {}),
        ...(confidentialityLevel ? { confidentialityLevel } : {}),
        color,
        stage,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral";

  return (
    <div className="space-y-3">
      <div className={compact ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="axis-name">
            {t("strategicAxes.form.axisName", "Nom de l'axe")}
          </label>
          <input
            id="axis-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder={t(
              "strategicAxes.form.axisNamePlaceholder",
              "Ex. Excellence opérationnelle"
            )}
          />
        </div>
        <UserPicker
          users={users}
          value={owner}
          onChange={setOwner}
          label={t("strategicAxes.owner", "Sponsor d'axe")}
          id="axis-owner"
          disabled={!canEditOwner}
          title={!canEditOwner ? ownerTooltip : undefined}
        />
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="axis-stage">
            {t("strategicAxes.form.maturityStage", "Étape de maturité")}
          </label>
          <select
            id="axis-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className={inputClass}
          >
            {stages.length === 0 && (
              <option value="">{t("strategicAxes.form.noStage", "Aucune étape configurée")}</option>
            )}
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {confidentialityLevels && confidentialityLevels.length > 0 && (
          <div>
            <label
              className="text-xs font-medium text-text-secondary"
              htmlFor="axis-confidentiality"
            >
              {t("strategicAxes.form.confidentiality", "Niveau de confidentialité")}
            </label>
            <select
              id="axis-confidentiality"
              value={confidentialityLevel}
              onChange={(e) => setConfidentialityLevel(e.target.value)}
              className={inputClass}
            >
              <option value="">
                {t("strategicAxes.form.confidentialityNone", "Aucun (visible par tous)")}
              </option>
              {confidentialityLevels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <span className="text-xs font-medium text-text-secondary">
            {t("strategicAxes.form.color", "Couleur")}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`${t("strategicAxes.form.color", "Couleur")} ${c}`}
                aria-pressed={color === c}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  color === c ? "border-text-primary" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      {!compact && (
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="axis-description">
            {t("strategicAxes.form.description", "Description")}
          </label>
          <textarea
            id="axis-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputClass}
            placeholder={t(
              "strategicAxes.form.axisDescriptionPlaceholder",
              "Ce que cet axe cherche à transformer."
            )}
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
        >
          {submitLabel ?? t("common.save", "Enregistrer")}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
          >
            {t("common.cancel", "Annuler")}
          </button>
        )}
      </div>
    </div>
  );
}
