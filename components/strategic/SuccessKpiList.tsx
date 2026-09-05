"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Chantier } from "@/types";

/** Une entrée de `Chantier.successKpis` — voir `types/index.ts`. */
type SuccessKpi = NonNullable<Chantier["successKpis"]>[number];

/** Id généré côté client pour un nouveau KPI de succès — même idiome que `makeDeliverableId`/
 *  `makePrerequisiteId` (app/(app)/levers/chantier/ChantierDetailClient.tsx) : jamais affiché,
 *  seulement une clé de liste stable. Le compteur de module évite la collision de deux créations
 *  dans la même milliseconde. */
let idSeq = 0;
function makeSuccessKpiId(): string {
  idSeq += 1;
  return `kpi-${Date.now()}-${idSeq}`;
}

/**
 * Critères de succès mesurables du chantier (round 5, point 3) — liste cochable en complément du
 * texte libre existant `Chantier.successCriteria` (INCHANGÉ, monté séparément). Même logique
 * d'auto-sauvegarde que le reste de la fiche chantier : chaque interaction reconstruit le tableau
 * complet et le remonte via `onChange`, à charge du parent de persister
 * (`updateChantierField({ successKpis: next })`).
 */
export function SuccessKpiList({
  value,
  onChange,
}: {
  value: SuccessKpi[];
  onChange: (next: SuccessKpi[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const toggle = (id: string) =>
    onChange(value.map((kpi) => (kpi.id === id ? { ...kpi, achieved: !kpi.achieved } : kpi)));

  const remove = (id: string) => onChange(value.filter((kpi) => kpi.id !== id));

  const add = () => {
    const label = draft.trim();
    if (!label) return;
    onChange([...value, { id: makeSuccessKpiId(), label }]);
    setDraft("");
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
        {t("strategicChantierDetail.successKpis.title")}
      </div>

      {value.length === 0 ? (
        <p className="text-[12px] text-tertiary">
          {t("strategicChantierDetail.successKpis.empty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {value.map((kpi) => (
            <li key={kpi.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={kpi.achieved ?? false}
                onChange={() => toggle(kpi.id)}
              />
              <span
                className={`flex-1 text-[12.5px] ${
                  kpi.achieved ? "text-tertiary line-through" : "text-primary"
                }`}
              >
                {kpi.label}
              </span>
              <button
                type="button"
                onClick={() => remove(kpi.id)}
                className="shrink-0 text-tertiary hover:text-rag-red"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("strategicChantierDetail.successKpis.placeholder")}
          className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-[12.5px] text-primary outline-none focus:border-bp-coral"
        />
        <Button variant="outline" size="sm" onClick={add}>
          <Plus size={12} /> {t("strategicChantierDetail.successKpis.addLabel")}
        </Button>
      </div>
    </div>
  );
}
