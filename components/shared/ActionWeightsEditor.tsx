"use client";

import { applyEvenWeights, clearWeights, weightsState } from "@/lib/actionWeights";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { LeverAction } from "@/types";

/** Pondération des actions d'un levier : total = 100 % requis dès qu'un poids est saisi. */
export function ActionWeightsEditor({
  actions,
  onChange,
  canEdit = true,
}: {
  actions: LeverAction[];
  onChange: (next: LeverAction[]) => void;
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  if (actions.length === 0) return null;
  const st = weightsState(actions);
  const setWeight = (id: string, raw: string) =>
    onChange(
      actions.map((a) =>
        a.id === id
          ? {
              ...a,
              weightPct: raw === "" ? undefined : Math.min(100, Math.max(0, Number(raw))),
            }
          : a
      )
    );
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          {t("actionWeights.title", "Pondération des actions")}
        </span>
        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChange(applyEvenWeights(actions))}
              className="rounded-sm bg-bp-coral/10 px-2 py-0.5 text-[11px] font-semibold text-bp-coral hover:bg-bp-coral/20"
            >
              {t("actionWeights.even", "Répartir équitablement")}
            </button>
            {st.mode !== "none" && (
              <button
                type="button"
                onClick={() => onChange(clearWeights(actions))}
                className="text-[11px] font-semibold text-tertiary hover:text-bp-coral"
              >
                {t("actionWeights.clear", "Non pondéré")}
              </button>
            )}
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {actions.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              disabled={!canEdit}
              value={a.weightPct ?? ""}
              onChange={(e) => setWeight(a.id, e.target.value)}
              className="w-20 rounded-sm border border-border px-2 py-1 text-right text-[12px] disabled:bg-neutral-100"
              aria-label={`${t("actionWeights.weight", "Poids (%)")} ${a.name}`}
            />
            <span className="text-tertiary">%</span>
          </li>
        ))}
      </ul>
      <div
        className={`mt-2 text-[11px] font-semibold ${st.valid ? "text-secondary" : "text-rag-red"}`}
        role={st.valid ? undefined : "alert"}
      >
        {st.mode === "none"
          ? t("actionWeights.unweighted", "Non pondéré (moyenne simple)")
          : `${t("actionWeights.total", "Total")} : ${st.total} %` +
            (st.valid
              ? ""
              : ` — ${t("actionWeights.mustBe100", "le total doit valoir 100 % et toutes les actions doivent avoir un poids")}`)}
      </div>
    </div>
  );
}
