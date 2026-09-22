"use client";

import { useState } from "react";
import { UserPicker } from "@/components/strategic/UserPicker";
import type { AuthUser, Chantier, MaturityStageConfig, StrategicAxis } from "@/types";

/**
 * Formulaire de création/édition d'un chantier. Même contrat que `AxisForm` : aucune logique
 * Firestore, l'appelant persiste via `useStrategicData.createChantier` / `updateChantier`. Il est
 * donc réutilisable à la fois dans la modale « Nouveau chantier » de la fiche d'axe et dans une
 * création rapide inline (ex. depuis l'éditeur d'indicateurs, pour rattacher un indicateur à un
 * chantier qui n'existe pas encore).
 *
 * Les dépendances inter-chantiers ne sont PAS éditées ici : elles se posent depuis la vue Gantt,
 * où l'on voit les chantiers voisins et leurs dates (voir plan, section hiérarchie).
 *
 * Étape de maturité RETIRÉE de ce formulaire (demande PO, même round que le retrait du formulaire
 * de projet, `ChantierActionForm`) : le pilotage Kanban (Défini/Validé/Planifié/Exécuté/Réalisé)
 * est entièrement remplacé par les jalons J0→J4 du projet. `stage` reste écrit en base (champ
 * `Chantier.stage` toujours requis par le type, potentiellement encore lu par du code ancien) mais
 * silencieusement défaulté à la première étape du référentiel, jamais montré/éditable ici.
 */

export type ChantierFormValues = Pick<
  Chantier,
  "name" | "description" | "axisIds" | "stage" | "confidentialityLevel" | "pilote"
>;

export function ChantierForm({
  initial,
  axes,
  stages,
  confidentialityLevels,
  users,
  onSubmit,
  onCancel,
  submitLabel,
  compact = false,
}: {
  initial?: Partial<ChantierFormValues>;
  /** Axes du programme — un chantier appartient désormais à UN OU PLUSIEURS axes (round 24, voir
   *  `types/index.ts`). */
  axes: StrategicAxis[];
  /** Étapes de maturité du programme (même référentiel que l'axe) — n'alimente plus qu'un défaut
   *  silencieux (voir doc-comment de tête), il n'y a plus de sélecteur d'étape ici. */
  stages: MaturityStageConfig[];
  /** Échelle de confidentialité de l'entreprise (`Company.confidentialityLevels`) — même
   *  sélecteur que `AxisForm`/`components/shared/LeverForm.tsx:291-300`. Absente/vide = aucun
   *  sélecteur affiché (non régressif). */
  confidentialityLevels?: string[];
  /** Utilisateurs de l'entreprise, pour le sélecteur « Responsable de chantier » (`Chantier.pilote`,
   *  via `UserPicker`). Absent/vide = aucun sélecteur affiché (non régressif — même parti pris que
   *  `confidentialityLevels` ci-dessus) : certains appelants (ex. création rapide inline depuis
   *  l'éditeur d'indicateurs) n'ont pas forcément la liste sous la main au même endroit. */
  users?: AuthUser[];
  onSubmit: (values: ChantierFormValues) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  /** Mise en page resserrée pour une création rapide inline (une colonne, pas de description). */
  compact?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [axisIds, setAxisIds] = useState<string[]>(
    initial?.axisIds && initial.axisIds.length > 0
      ? initial.axisIds
      : axes[0]?.id
        ? [axes[0].id]
        : []
  );
  // Plus de sélecteur d'étape (voir doc-comment de tête) : défaut silencieux, jamais modifié après
  // le montage initial — même parti pris que `ChantierActionForm` pour son `status`.
  const [stage] = useState(initial?.stage ?? stages[0]?.id ?? "");
  const [confidentialityLevel, setConfidentialityLevel] = useState(
    initial?.confidentialityLevel ?? ""
  );
  const [pilote, setPilote] = useState<string | undefined>(initial?.pilote);
  const [submitting, setSubmitting] = useState(false);

  const toggleAxis = (axisId: string) => {
    setAxisIds((ids) =>
      ids.includes(axisId) ? ids.filter((id) => id !== axisId) : [...ids, axisId]
    );
  };

  const canSubmit = name.trim().length > 0 && axisIds.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        // Clé OMISE (jamais `undefined`) quand le champ est vide : `setDoc` rejette toute valeur
        // `undefined`, voir `optionalIndicatorFields` dans `components/admin/IndicatorsEditor.tsx`.
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(confidentialityLevel ? { confidentialityLevel } : {}),
        ...(pilote ? { pilote } : {}),
        axisIds,
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
          <span className="text-xs font-medium text-text-secondary">Axes de rattachement</span>
          {axes.length === 0 ? (
            <p className="mt-1 text-xs text-text-secondary">Aucun axe disponible</p>
          ) : (
            // Liste défilante à cases à cocher (round "chantier form") — remplace les puces à
            // bascule : l'axe d'origine (`initial.axisIds`) arrive déjà PRÉ-COCHÉ (voir l'état
            // `axisIds` ci-dessus), l'utilisateur peut en cocher d'autres pour un chantier
            // multi-axes sans perdre la présélection.
            <div
              role="group"
              aria-label="Axes de rattachement"
              className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2"
            >
              {axes.map((axis) => (
                <label
                  key={axis.id}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-text-primary hover:bg-bg-elevated"
                >
                  <input
                    type="checkbox"
                    checked={axisIds.includes(axis.id)}
                    onChange={() => toggleAxis(axis.id)}
                    className="accent-bp-coral"
                  />
                  {axis.name}
                </label>
              ))}
            </div>
          )}
        </div>
        {confidentialityLevels && confidentialityLevels.length > 0 && (
          <div>
            <label
              className="text-xs font-medium text-text-secondary"
              htmlFor="chantier-confidentiality"
            >
              Niveau de confidentialité
            </label>
            <select
              id="chantier-confidentiality"
              value={confidentialityLevel}
              onChange={(e) => setConfidentialityLevel(e.target.value)}
              className={inputClass}
            >
              <option value="">Aucun (visible par tous)</option>
              {confidentialityLevels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        )}
        {users && users.length > 0 && (
          <UserPicker
            users={users}
            value={pilote}
            onChange={setPilote}
            label="Responsable de chantier"
            placeholder="Non assigné"
            id="chantier-pilote"
          />
        )}
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
