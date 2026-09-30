"use client";

import { Info, TriangleAlert } from "lucide-react";
import type { MovementAlert, MovementAlertKind } from "@/lib/hrEngine";
import { alertPrimaryBreakdown } from "@/lib/hrEngine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Tooltip } from "@/components/shared/Tooltip";

/** Couleur de segment par gravité (tokens RAG / neutres de la charte). */
const KIND_FILL: Record<MovementAlertKind, string> = {
  leverMismatch: "bg-rag-red",
  overdue: "bg-rag-red/55",
  toValidate: "bg-rag-amber",
  due: "bg-neutral-400",
};

/** Pourcentages entiers sommant à 100 (méthode du plus fort reste). */
function roundedPercents(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floors = raw.map(Math.floor);
  let rest = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors;
}

/**
 * Bandeau « alertes mouvements » du Dashboard RH : UN chiffre (mouvements distincts en alerte)
 * et sa répartition en barre 100 % empilée par catégorie PRINCIPALE (la plus grave du mouvement,
 * `alertPrimaryBreakdown` — lib/hrEngine.ts) : la somme des segments = le chiffre du titre, et
 * chaque segment ouvre la synthèse filtrée sur exactement ces mouvements
 * (`MovementAlertsSummaryModal`, même regroupement). Aucun nom de mouvement sur la carte.
 */
export function MovementAlertsBreakdown({
  alerts,
  onOpen,
  bare = false,
}: {
  alerts: MovementAlert[];
  /** Sans cadre ni marge : intégré dans la bande « Mouvements » du Dashboard RH. */
  bare?: boolean;
  /** `null` = toutes les alertes ; sinon la catégorie principale cliquée. */
  onOpen: (kind: MovementAlertKind | null) => void;
}) {
  const { t } = useTranslation();
  const { total, parts } = alertPrimaryBreakdown(alerts);
  if (total === 0) return null;

  const label: Record<MovementAlertKind, string> = {
    leverMismatch: t("hr.alert.leverMismatch", "Désynchronisé levier"),
    overdue: t("hr.alert.overdue", "En retard"),
    toValidate: t("hr.alert.toValidate", "À valider"),
    due: t("hr.alert.due", "Échéance proche"),
  };
  const pcts = roundedPercents(
    parts.map((p) => p.count),
    total
  );
  const tip = (kind: MovementAlertKind, count: number, pct: number) =>
    t("hr.alertsBreakdown.segmentTip", "{label} : {n} mouvement(s) ({pct} %) — voir le détail")
      .replace("{label}", label[kind])
      .replace("{n}", String(count))
      .replace("{pct}", String(pct));

  return (
    <div
      className={
        bare
          ? "min-w-0 flex-1"
          : "mb-4 rounded-lg border border-rag-amber-light bg-rag-amber-light/30 px-3 py-2"
      }
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen(null)}
            title={t(
              "hr.alertsBreakdown.openAll",
              "Voir la synthèse de tous les mouvements en alerte"
            )}
            className="flex items-center gap-1.5 text-[13px] font-bold tabular-nums text-primary hover:underline"
          >
            <TriangleAlert size={14} className="text-rag-amber" />
            {t("hr.alertedMovementsCount", "{n} mouvement(s) en alerte").replace(
              "{n}",
              String(total)
            )}
          </button>
          <Tooltip
            text={t(
              "hr.alertsBreakdown.note",
              "Chaque mouvement est compté une fois, dans sa catégorie la plus grave."
            )}
            position="bottom"
          >
            <Info size={11} className="shrink-0 text-tertiary" />
          </Tooltip>
        </div>

        <div
          className="flex h-2 w-full gap-px overflow-hidden bg-white lg:w-auto lg:min-w-[120px] lg:flex-1"
          role="group"
          aria-label={t("hr.alertsBreakdown.aria", "Répartition des mouvements en alerte")}
        >
          {parts.map((p, i) => (
            <button
              key={p.kind}
              type="button"
              onClick={() => onOpen(p.kind)}
              title={tip(p.kind, p.count, pcts[i])}
              aria-label={tip(p.kind, p.count, pcts[i])}
              style={{ flexGrow: p.count, flexBasis: 0 }}
              className={`min-w-[4px] transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black ${KIND_FILL[p.kind]}`}
            />
          ))}
        </div>

        <ul className="flex shrink-0 flex-wrap gap-x-3 gap-y-1">
          {parts.map((p, i) => (
            <li key={p.kind}>
              <button
                type="button"
                onClick={() => onOpen(p.kind)}
                title={tip(p.kind, p.count, pcts[i])}
                className="flex items-center gap-1.5 text-[12px] text-secondary hover:text-primary hover:underline"
              >
                <span aria-hidden className={`h-2 w-2 shrink-0 ${KIND_FILL[p.kind]}`} />
                <span>{label[p.kind]}</span>
                <span className="font-semibold tabular-nums text-primary">{p.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
