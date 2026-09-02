"use client";

import { useEffect, useState } from "react";
import { Save, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { MaturityStageConfig } from "@/types";
import {
  DEFAULT_MATURITY_STAGES,
  deleteMaturityStage,
  saveMaturityStage,
  subscribeMaturityStages,
} from "@/lib/firestore/maturityStageConfigs";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";

/**
 * Édition des étapes de maturité d'UN programme stratégique (à la CMMI/PPAP). Mirroring de
 * `components/admin/LifecycleEditor.tsx` — même ergonomie (table desktop + cartes mobile,
 * réordonnancement, bouton Enregistrer, garde "modifications non enregistrées") — avec DEUX
 * différences structurelles assumées :
 *   - scopé PAR PROGRAMME (`programId`), pas par entreprise : deux programmes de la même société
 *     peuvent avoir des cycles de longueurs différentes ;
 *   - nombre d'étapes LIBRE : `addStage`/`removeStage` en plus du renommage/réordonnancement,
 *     là où `LifecycleEditor` travaille sur un jeu fixe de 5 étapes indexées par l'union fermée
 *     `LeverStatus`.
 *
 * Enregistrement : l'état local est le brouillon, `Enregistrer` réconcilie avec Firestore
 * (écriture de chaque étape présente, suppression de celles retirées depuis le dernier
 * chargement). `order` est TOUJOURS renuméroté 1..N à partir de la position dans la liste, pour
 * qu'un réordonnancement ne puisse pas laisser deux étapes au même rang.
 */

/** Slug technique dérivé du libellé — les étapes sont référencées par id (`StrategicAxis.stage`,
 *  `Chantier.stage`), un slug lisible facilite le diagnostic en base. Toujours suffixé en cas de
 *  collision, et jamais recalculé après création (renommer une étape ne casse pas les entités qui
 *  la référencent). */
function slugify(label: string, taken: string[]): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "stage";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function MaturityStagesEditor({
  companyId,
  programId,
}: {
  companyId: string;
  programId: string;
}) {
  const [stages, setStages] = useState<MaturityStageConfig[]>([]);
  /** Dernier état persisté connu — sert à détecter les modifs non enregistrées ET à savoir
   *  quelles étapes ont été supprimées côté brouillon (à effacer en base à l'enregistrement). */
  const [savedStages, setSavedStages] = useState<MaturityStageConfig[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!programId) return;
    const unsub = subscribeMaturityStages(programId, (fetched) => {
      setStages(fetched);
      setSavedStages(structuredClone(fetched));
    });
    return unsub;
  }, [programId]);

  const stagesDirty = JSON.stringify(stages) !== JSON.stringify(savedStages);
  useRegisterUnsavedChanges(`admin:maturityStages:${programId}`, stagesDirty);

  const updateStage = (id: string, patch: Partial<MaturityStageConfig>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const moveStage = (id: string, direction: "up" | "down") => {
    setStages((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };

  const addStage = () => {
    setStages((prev) => {
      const label = `Étape ${prev.length + 1}`;
      return [
        ...prev,
        {
          id: slugify(
            label,
            prev.map((s) => s.id)
          ),
          programId,
          companyId,
          order: prev.length + 1,
          label,
        },
      ];
    });
  };

  const removeStage = (id: string) => {
    setStages((prev) => prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i + 1 })));
  };

  const resetToDefault = () => {
    setStages(DEFAULT_MATURITY_STAGES.map((stage) => ({ ...stage, programId, companyId })));
  };

  const save = async () => {
    if (!programId) return;
    setSaving(true);
    try {
      // Renumérotation systématique : la position dans la liste fait foi.
      const normalized = stages.map((s, i) => ({ ...s, order: i + 1 }));
      const keptIds = new Set(normalized.map((s) => s.id));
      await Promise.all([
        ...normalized.map((stage) => saveMaturityStage(stage)),
        ...savedStages
          .filter((s) => !keptIds.has(s.id))
          .map((s) => deleteMaturityStage(programId, s.id)),
      ]);
      setStages(normalized);
      // Rafraîchit le snapshot sans attendre l'écho de la souscription (même raison que
      // LifecycleEditor : le bouton resterait "dirty" quelques ms après le clic).
      setSavedStages(structuredClone(normalized));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-secondary">
          Personnalisez les étapes de maturité des axes et chantiers de CE programme. Vous pouvez
          ajouter, supprimer, renommer et réordonner librement les étapes — leur nombre n&apos;est
          pas limité. Une étape « terminale » (ex. Atteint / Non atteint) est un état de sortie,
          hors du cycle linéaire.
        </p>
        <button
          onClick={addStage}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
        >
          <Plus size={14} /> Ajouter une étape
        </button>
      </div>

      {/* Desktop/tablette (>= sm). En dessous de sm, remplacé par des cartes empilées — même
       * pattern que LifecycleEditor pour éviter tout scroll horizontal à 375px. */}
      <div className="hidden rounded-xl border border-border overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 w-12 text-center text-xs font-semibold text-text-secondary">
                Ordre
              </th>
              <th className="px-4 py-2.5 w-32 text-center text-xs font-semibold text-text-secondary">
                Clé
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Libellé
              </th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                Étape terminale
              </th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage, idx) => (
              <tr key={stage.id} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="px-4 py-2.5 text-center text-xs font-mono text-text-secondary">
                  {idx + 1}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <code className="rounded bg-bg-surface px-1.5 py-0.5 text-xs text-text-secondary">
                    {stage.id}
                  </code>
                </td>
                <td className="px-4 py-2.5">
                  <input
                    value={stage.label}
                    onChange={(e) => updateStage(stage.id, { label: e.target.value })}
                    className="w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
                  />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    onClick={() => updateStage(stage.id, { isTerminal: !stage.isTerminal })}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      stage.isTerminal
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {stage.isTerminal ? "Oui" : "Non"}
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-center">
                  <button
                    onClick={() => moveStage(stage.id, "up")}
                    disabled={idx === 0}
                    aria-label="Monter l'étape"
                    className="mr-1 text-text-secondary hover:text-bp-coral disabled:opacity-30"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveStage(stage.id, "down")}
                    disabled={idx === stages.length - 1}
                    aria-label="Descendre l'étape"
                    className="mr-3 text-text-secondary hover:text-bp-coral disabled:opacity-30"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    onClick={() => removeStage(stage.id)}
                    aria-label="Supprimer l'étape"
                    className="text-text-secondary hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {stages.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-text-secondary">
                  Aucune étape configurée pour ce programme.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile (< sm) : une carte par étape, tout empilé verticalement. */}
      <div className="divide-y divide-border rounded-xl border border-border sm:hidden">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
              <span className="font-mono">#{idx + 1}</span>
              <code className="rounded bg-bg-surface px-1.5 py-0.5">{stage.id}</code>
            </div>
            <input
              value={stage.label}
              onChange={(e) => updateStage(stage.id, { label: e.target.value })}
              className="mb-2 w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => updateStage(stage.id, { isTerminal: !stage.isTerminal })}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  stage.isTerminal
                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                Terminale : {stage.isTerminal ? "Oui" : "Non"}
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveStage(stage.id, "up")}
                  disabled={idx === 0}
                  aria-label="Monter l'étape"
                  className="text-text-secondary hover:text-bp-coral disabled:opacity-30"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  onClick={() => moveStage(stage.id, "down")}
                  disabled={idx === stages.length - 1}
                  aria-label="Descendre l'étape"
                  className="mr-2 text-text-secondary hover:text-bp-coral disabled:opacity-30"
                >
                  <ChevronDown size={16} />
                </button>
                <button
                  onClick={() => removeStage(stage.id)}
                  aria-label="Supprimer l'étape"
                  className="text-text-secondary hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {stages.length === 0 && (
          <div className="p-4 text-center text-sm text-text-secondary">
            Aucune étape configurée pour ce programme.
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
        >
          <Save size={14} /> Enregistrer
        </button>
        <button
          onClick={resetToDefault}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
        >
          Réinitialiser aux étapes par défaut
        </button>
      </div>
    </div>
  );
}
