"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { DEPENDENCY_TYPES, DEPENDENCY_TYPE_DESCRIPTION, DEPENDENCY_TYPE_LABEL } from "@/lib/status-config";
import type { BeTrackData, DependencyType, LeverDependency } from "@/types";

const inputClass =
  "rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-bp-coral focus:outline-none";

/**
 * Éditeur de dépendances typées (cible + type Fin→Début / Début→Début / Fin→Fin / Début→Fin),
 * réutilisé par le modal "Gérer les dépendances" du détail levier et par SubLeverForm.
 * Contrôlé : reçoit la liste courante et remonte chaque changement via onChange.
 */
export function DependencyEditor({
  data,
  value,
  onChange,
  excludeIds = [],
}: {
  data: BeTrackData;
  value: LeverDependency[];
  onChange: (next: LeverDependency[]) => void;
  /** ids à exclure des cibles possibles (l'entité éditée elle-même, typiquement) */
  excludeIds?: string[];
}) {
  const [draftTarget, setDraftTarget] = useState("");
  const [draftType, setDraftType] = useState<DependencyType>("FS");

  const targetName = (id: string) =>
    data.levers.find((l) => l.id === id)?.name ??
    data.subLevers.find((s) => s.id === id)?.name ??
    id;

  const usedIds = new Set(value.map((d) => d.targetId));
  const options = [
    ...data.levers
      .filter((l) => !excludeIds.includes(l.id) && !usedIds.has(l.id))
      .map((l) => ({ id: l.id, label: `${l.id} · ${l.name}` })),
    ...data.subLevers
      .filter((s) => !excludeIds.includes(s.id) && !usedIds.has(s.id))
      .map((s) => ({ id: s.id, label: `${s.id} · ${s.name} (sous-levier)` })),
  ];

  const addDraft = () => {
    if (!draftTarget) return;
    onChange([...value, { targetId: draftTarget, type: draftType }]);
    setDraftTarget("");
    setDraftType("FS");
  };

  return (
    <div>
      {value.length === 0 && (
        <p className="mb-2 text-xs text-tertiary">Aucune dépendance pour l&apos;instant.</p>
      )}
      {value.map((dep) => (
        <div
          key={dep.targetId}
          className="mb-1.5 flex items-center gap-2 rounded-md border border-border bg-neutral-50 px-2.5 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">
            {dep.targetId} · {targetName(dep.targetId)}
          </span>
          <select
            value={dep.type}
            onChange={(e) =>
              onChange(
                value.map((d) =>
                  d.targetId === dep.targetId
                    ? { ...d, type: e.target.value as DependencyType }
                    : d
                )
              )
            }
            className={inputClass}
            title={DEPENDENCY_TYPE_DESCRIPTION[dep.type]}
          >
            {DEPENDENCY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DEPENDENCY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(value.filter((d) => d.targetId !== dep.targetId))}
            className="p-1 text-tertiary hover:text-bp-coral"
            aria-label="Retirer la dépendance"
          >
            <X size={13} />
          </button>
        </div>
      ))}

      <div className="mt-2 flex items-center gap-2">
        <select
          value={draftTarget}
          onChange={(e) => setDraftTarget(e.target.value)}
          className={`${inputClass} min-w-0 flex-1`}
        >
          <option value="">Choisir un levier ou sous-levier…</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={draftType}
          onChange={(e) => setDraftType(e.target.value as DependencyType)}
          className={inputClass}
          title={DEPENDENCY_TYPE_DESCRIPTION[draftType]}
        >
          {DEPENDENCY_TYPES.map((t) => (
            <option key={t} value={t}>
              {DEPENDENCY_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={addDraft} disabled={!draftTarget}>
          <Plus size={12} /> Ajouter
        </Button>
      </div>
      <p className="mt-1.5 text-[10.5px] text-tertiary">{DEPENDENCY_TYPE_DESCRIPTION[draftType]}</p>
    </div>
  );
}
