// SCOPE (PO explicite, round 4) : `EffortScoringGrid` ne doit JAMAIS être importé ailleurs que
// par la future fiche chantier dédiée (`app/(app)/levers/chantier/ChantierDetailClient.tsx`) —
// en particulier PAS par `StrategicAxesView.tsx`, `AxisKanban.tsx`, `ChantierGantt.tsx`, ni
// `StrategicDashboardView.tsx` ("je ne veux pas qu'elle apparaisse autre part"). Ce fichier n'est
// monté nulle part dans cette passe — l'intégration sur la fiche chantier est une passe séparée.
"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierEffort, EffortScore } from "@/types";

/**
 * Grille de notation d'effort d'un chantier (round 4, fiche chantier dédiée) : 4 dimensions
 * indépendantes (financier, humain, durée, conduite du changement), chacune notée 1-4 via un
 * contrôle segmenté — MÊME PATTERN visuel que la bascule d'échelle Mois/Trimestre/Semestre de
 * `ChantierGantt.tsx` (groupe de boutons contigus dans une bordure arrondie, sélection en fond
 * noir), plutôt que d'inventer un nouveau composant de segmented control.
 *
 * Sous les 4 lignes, un radar 4 axes (recharts `RadarChart`) résume visuellement le profil
 * d'effort — seul endroit de l'app où un radar a sa place (4 dimensions hétérogènes à comparer
 * d'un coup d'œil, ce qu'aucune barre/courbe ne rend aussi bien).
 *
 * PARTI PRIS : une dimension non encore notée est tracée à 0 sur le radar (plutôt qu'omise) pour
 * garder les 4 axes toujours présents — un radar dont le nombre d'axes varierait selon ce qui est
 * rempli serait illisible d'une notation à l'autre, et 0 lit naturellement comme "pas encore noté"
 * sur une échelle qui démarre à 1.
 */

const DIMENSIONS: Array<keyof ChantierEffort> = [
  "financialImpact",
  "humanImpact",
  "duration",
  "changeManagement",
];

const SCORES: EffortScore[] = [1, 2, 3, 4];

export function EffortScoringGrid({
  value,
  onChange,
}: {
  value: ChantierEffort;
  onChange: (next: ChantierEffort) => void;
}) {
  const { t } = useTranslation();

  const setScore = (dimension: keyof ChantierEffort, score: EffortScore) => {
    onChange({ ...value, [dimension]: score });
  };

  const radarData = DIMENSIONS.map((dimension) => {
    const rawScore = value[dimension];
    return {
      dimension: t(`strategicChantierDetail.effort.${dimension}`),
      score: rawScore ?? 0,
      optionLabel:
        rawScore !== undefined
          ? t(`strategicChantierDetail.effort.${dimension}.option${rawScore}`)
          : undefined,
    };
  });

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {DIMENSIONS.map((dimension) => {
          const dimensionLabel = t(`strategicChantierDetail.effort.${dimension}`);
          const current = value[dimension];
          return (
            <div
              key={dimension}
              className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="text-[11px] font-semibold text-secondary sm:w-40 sm:shrink-0">
                {dimensionLabel}
              </span>
              <div className="flex flex-1 overflow-hidden rounded-md border border-border">
                {SCORES.map((score) => {
                  const optionLabel = t(
                    `strategicChantierDetail.effort.${dimension}.option${score}`
                  );
                  const isSelected = current === score;
                  return (
                    <button
                      key={score}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setScore(dimension, score)}
                      className={`flex-1 px-2 py-1.5 text-center text-[10.5px] font-semibold leading-tight transition ${
                        isSelected
                          ? "bg-black text-white"
                          : "bg-white text-secondary hover:text-primary"
                      }`}
                    >
                      {optionLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <ResponsiveContainer width="100%" height={260}>
          <RadarChart data={radarData} outerRadius="70%">
            <PolarGrid stroke="rgba(0,0,0,0.08)" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fontSize: 10.5, fill: "var(--text-secondary)" }}
            />
            <PolarRadiusAxis
              domain={[0, 4]}
              tickCount={5}
              tick={{ fontSize: 9.5 }}
              axisLine={false}
            />
            <Radar
              name={t("strategicChantierDetail.effort.title")}
              dataKey="score"
              stroke="#FF3C47"
              fill="#FF3C47"
              fillOpacity={0.25}
              strokeWidth={2}
            />
            <Tooltip
              formatter={(_value, _name, props) => [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (props?.payload as any)?.optionLabel ?? _value,
                "",
              ]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
