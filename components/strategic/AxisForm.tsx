"use client";

import { useState } from "react";
import type { MaturityStageConfig, StrategicAxis } from "@/types";

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
  "name" | "description" | "owner" | "color" | "stage"
>;

const COLOR_CHOICES = ["#320300", "#FF3C47", "#806659", "#B8A99A", "#4A7C59", "#2F5D8C"];

export function AxisForm({
  initial,
  stages,
  onSubmit,
  onCancel,
  submitLabel,
  compact = false,
}: {
  initial?: Partial<AxisFormValues>;
  /** Étapes de maturité du programme (voir `useMaturityStages`) — la première est proposée par
   *  défaut pour un axe neuf. */
  stages: MaturityStageConfig[];
  onSubmit: (values: AxisFormValues) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  /** Mise en page resserrée pour une création rapide inline (une colonne, pas de description). */
  compact?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [owner, setOwner] = useState(initial?.owner ?? "");
  const [color, setColor] = useState(initial?.color ?? COLOR_CHOICES[0]);
  const [stage, setStage] = useState(initial?.stage ?? stages[0]?.id ?? "");
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
        ...(owner.trim() ? { owner: owner.trim() } : {}),
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
            Nom de l&apos;axe
          </label>
          <input
            id="axis-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="Ex. Excellence opérationnelle"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="axis-owner">
            Responsable
          </label>
          <input
            id="axis-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={inputClass}
            placeholder="Nom du responsable"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="axis-stage">
            Étape de maturité
          </label>
          <select
            id="axis-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className={inputClass}
          >
            {stages.length === 0 && <option value="">Aucune étape configurée</option>}
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="text-xs font-medium text-text-secondary">Couleur</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Couleur ${c}`}
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
            Description
          </label>
          <textarea
            id="axis-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputClass}
            placeholder="Ce que cet axe cherche à transformer."
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
        >
          {submitLabel ?? "Enregistrer"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
          >
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}
