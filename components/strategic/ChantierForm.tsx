"use client";

import { useState } from "react";
import type { Chantier, MaturityStageConfig, StrategicAxis } from "@/types";

/**
 * Formulaire de création/édition d'un chantier. Même contrat que `AxisForm` : aucune logique
 * Firestore, l'appelant persiste via `useStrategicData.createChantier` / `updateChantier`. Il est
 * donc réutilisable à la fois dans la modale « Nouveau chantier » de la fiche d'axe et dans une
 * création rapide inline (ex. depuis l'éditeur d'indicateurs, pour rattacher un indicateur à un
 * chantier qui n'existe pas encore).
 *
 * Les dépendances inter-chantiers ne sont PAS éditées ici : elles se posent depuis la vue Gantt,
 * où l'on voit les chantiers voisins et leurs dates (voir plan, section hiérarchie).
 */

export type ChantierFormValues = Pick<Chantier, "name" | "description" | "axisId" | "stage">;

export function ChantierForm({
  initial,
  axes,
  stages,
  onSubmit,
  onCancel,
  submitLabel,
  compact = false,
}: {
  initial?: Partial<ChantierFormValues>;
  /** Axes du programme — un chantier appartient toujours à exactement un axe. */
  axes: StrategicAxis[];
  /** Étapes de maturité du programme (même référentiel que l'axe). */
  stages: MaturityStageConfig[];
  onSubmit: (values: ChantierFormValues) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  /** Mise en page resserrée pour une création rapide inline (une colonne, pas de description). */
  compact?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [axisId, setAxisId] = useState(initial?.axisId ?? axes[0]?.id ?? "");
  const [stage, setStage] = useState(initial?.stage ?? stages[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && axisId.length > 0 && stage.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        axisId,
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
          <label className="text-xs font-medium text-text-secondary" htmlFor="chantier-name">
            Nom du chantier
          </label>
          <input
            id="chantier-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="Ex. Refonte du parcours client"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="chantier-axis">
            Axe de rattachement
          </label>
          <select
            id="chantier-axis"
            value={axisId}
            onChange={(e) => setAxisId(e.target.value)}
            className={inputClass}
          >
            {axes.length === 0 && <option value="">Aucun axe disponible</option>}
            {axes.map((axis) => (
              <option key={axis.id} value={axis.id}>
                {axis.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="chantier-stage">
            Étape de maturité initiale
          </label>
          <select
            id="chantier-stage"
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
      </div>

      {!compact && (
        <div>
          <label className="text-xs font-medium text-text-secondary" htmlFor="chantier-description">
            Description
          </label>
          <textarea
            id="chantier-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputClass}
            placeholder="Ce que ce chantier regroupe comme actions concrètes."
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
