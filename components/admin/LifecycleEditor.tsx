"use client";

import { useEffect, useState } from "react";
import { Save, RotateCcw, ChevronUp, ChevronDown } from "lucide-react";
import type { LifecycleStage, LeverStatus } from "@/types";
import { DEFAULT_LIFECYCLE_STAGES, STATUS_LEVEL } from "@/lib/status-config";
import { subscribeLifecycleConfig, saveLifecycleConfig } from "@/lib/firestore/admin";

/**
 * Édition des étapes du cycle de vie pour UNE entreprise déjà sélectionnée. Extrait de
 * `admin/lifecycle/page.tsx` — cette page garde son propre sélecteur d'entreprise et rend ce
 * composant scopé ; le hub `/admin/companies/detail` le rend directement, sans sélecteur. Seule
 * source de vérité pour ce CRUD.
 */
export function LifecycleEditor({ companyId }: { companyId: string }) {
  const [stages, setStages] = useState<LifecycleStage[]>(structuredClone(DEFAULT_LIFECYCLE_STAGES));

  useEffect(() => {
    if (!companyId) return;
    const unsub = subscribeLifecycleConfig(companyId, (fetched) => {
      setStages(fetched.length > 0 ? fetched : structuredClone(DEFAULT_LIFECYCLE_STAGES));
    });
    return unsub;
  }, [companyId]);

  const updateStage = (key: LeverStatus, patch: Partial<LifecycleStage>) => {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const moveStage = (key: LeverStatus, direction: "up" | "down") => {
    const idx = stages.findIndex((s) => s.key === key);
    if (idx < 0) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= stages.length) return;
    const next = [...stages];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setStages(next);
  };

  const resetToDefault = () => {
    setStages(structuredClone(DEFAULT_LIFECYCLE_STAGES));
  };

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-text-secondary">
        Personnalisez les étapes du cycle de vie des leviers pour cette entreprise. Vous pouvez
        renommer, réordonner, activer/désactiver les validations et ajuster le nombre d&apos;étapes.
      </p>

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 w-12 text-center text-xs font-semibold text-text-secondary">
                Ordre
              </th>
              <th className="px-4 py-2.5 w-16 text-center text-xs font-semibold text-text-secondary">
                Clé
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Libellé
              </th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                Validation (gate)
              </th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                Ordre
              </th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage, idx) => (
              <tr key={stage.key} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="px-4 py-2.5 text-center text-xs font-mono text-text-secondary">
                  {STATUS_LEVEL[stage.key]}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <code className="rounded bg-bg-surface px-1.5 py-0.5 text-xs text-text-secondary">
                    {stage.key}
                  </code>
                </td>
                <td className="px-4 py-2.5">
                  <input
                    value={stage.label}
                    onChange={(e) => updateStage(stage.key, { label: e.target.value })}
                    className="w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
                  />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    onClick={() =>
                      updateStage(stage.key, { validationRequired: !stage.validationRequired })
                    }
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      stage.validationRequired
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {stage.validationRequired ? "Oui" : "Non"}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    onClick={() => moveStage(stage.key, "up")}
                    disabled={idx === 0}
                    className="mr-1 text-text-secondary hover:text-bp-coral disabled:opacity-30"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveStage(stage.key, "down")}
                    disabled={idx === stages.length - 1}
                    className="text-text-secondary hover:text-bp-coral disabled:opacity-30"
                  >
                    <ChevronDown size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3">
        <button
          onClick={async () => {
            if (!companyId) return;
            await saveLifecycleConfig(companyId, stages);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
        >
          <Save size={14} /> Enregistrer
        </button>
        <button
          onClick={resetToDefault}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
        >
          <RotateCcw size={14} /> Réinitialiser
        </button>
      </div>
    </div>
  );
}
