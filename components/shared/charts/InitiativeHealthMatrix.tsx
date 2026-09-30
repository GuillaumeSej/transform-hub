"use client";

import { toggleInSelection } from "@/lib/filterUtils";
import { useState } from "react";
import type { LeverHealthGroup, LeverHealthStatus } from "@/lib/leverHealth";
import { groupBlockWidth, useAdaptiveGroupColumns } from "@/lib/hooks/useAdaptiveGroupColumns";
import type { LeverCellPreview } from "@/lib/chartHoverPreview";
import type { Lever, LeverStatus, RiskLevel } from "@/types";
import { STATUS_LEVEL } from "@/lib/status-config";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { leverRiskReasonText, riskLevelLabel } from "@/lib/leverRiskText";
import { alertTitle } from "@/lib/alertText";
import { ChartHoverArea, FloatingPreview } from "./HoverPreview";
import {
  PreviewBar,
  PreviewCard,
  PreviewRealizedBlock,
  PreviewRow,
  PreviewSection,
} from "./LeverGroupPreview";

const HEALTH_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "bg-rag-green",
  watch: "bg-rag-amber",
  critical: "bg-rag-red",
  cancelled: "bg-neutral-400",
};

/** Bordure gauche + fond léger utilisés pour les rectangles de leviers : la couleur reste
 * immédiatement scannable via la bande de couleur, sans passer tout le bloc en couleur saturée
 * (ce qui rendrait le texte blanc illisible en petite taille). */
const HEALTH_CELL_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "border-l-rag-green bg-rag-green/10",
  watch: "border-l-rag-amber bg-rag-amber/10",
  critical: "border-l-rag-red bg-rag-red/10",
  cancelled: "border-l-neutral-400 bg-neutral-400/10",
};

/** Couleurs charte du niveau de risque dans l'aperçu (jamais de vert). */
const RISK_COLOR: Record<RiskLevel, string> = {
  critical: "#991D1F",
  high: "#FF3C47",
  medium: "#FF797B",
  low: "#A99E9A",
};

/** Aperçu au survol d'un levier (retour PO, même carte que la Trajectoire des économies) : code +
 *  nom, maturité (étape du cycle de vie), risque + motif, réalisé / réactualisé, avancement du plan
 *  d'action et alerte principale. */
function LeverCellPreviewCard({
  lever,
  preview,
  stageLabel,
  healthLabel,
}: {
  lever: Lever;
  preview: LeverCellPreview;
  stageLabel?: (status: LeverStatus) => string;
  healthLabel: string;
}) {
  const { t } = useTranslation();
  const { risk, mainAlert } = preview;
  const stage = stageLabel?.(lever.status);
  return (
    <PreviewCard
      title={
        <>
          {lever.code} <span className="font-semibold text-secondary">· {lever.name}</span>
        </>
      }
      subtitle={healthLabel}
      clickHint={t("chart.groupPreview.clickLever", "Cliquer pour ouvrir le levier →")}
    >
      <div className="space-y-1">
        <PreviewRow
          label={t("chart.groupPreview.maturity", "Maturité")}
          value={
            lever.status === "cancelled"
              ? (stage ?? lever.status)
              : `${STATUS_LEVEL[lever.status]}${stage ? ` · ${stage}` : ""}`
          }
        />
        <PreviewRow
          color={RISK_COLOR[risk.level]}
          label={t("chart.groupPreview.risk", "Risque")}
          value={riskLevelLabel(t, risk.level)}
        />
      </div>
      <div className="mt-1 text-[10.5px] leading-snug text-tertiary">
        {leverRiskReasonText(t, risk)}
      </div>
      <PreviewSection>
        <PreviewRealizedBlock summary={{ ...preview, planned: 0 }} />
      </PreviewSection>
      <PreviewSection>
        <PreviewRow
          label={t("chart.groupPreview.actionProgress", "Avancement du plan d'action")}
          value={preview.actionCount > 0 ? `${preview.actionProgress} %` : "—"}
        />
        {preview.actionCount > 0 && (
          <div className="mt-1.5">
            <PreviewBar pct={preview.actionProgress} className="bg-bp-deep-red/70" />
          </div>
        )}
      </PreviewSection>
      {mainAlert && (
        <PreviewSection>
          <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            {t("chart.groupPreview.mainAlert", "Alerte principale")}
          </div>
          <div className="flex items-start gap-1.5 text-secondary">
            <span
              className="mt-1 inline-block h-2 w-2 shrink-0"
              style={{
                backgroundColor:
                  mainAlert.type === "red"
                    ? "#991D1F"
                    : mainAlert.type === "amber"
                      ? "#FF797B"
                      : "#A99E9A",
              }}
            />
            <span className="line-clamp-2">{alertTitle(t, mainAlert)}</span>
          </div>
        </PreviewSection>
      )}
    </PreviewCard>
  );
}

const HEALTH_ORDER: LeverHealthStatus[] = ["critical", "watch", "onTrack", "cancelled"];

/** Marqueur carré « contour » (légende en mode filtre, statut non sélectionné). */
const HEALTH_OUTLINE_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "border-rag-green",
  watch: "border-rag-amber",
  critical: "border-rag-red",
  cancelled: "border-neutral-400",
};

/** Géométrie des rectangles de leviers (largeur fixe). Le nombre de colonnes par bloc s'adapte
 * à la largeur disponible / au nombre de groupes (cf. `computeGroupColumns`) : peu de groupes →
 * blocs élargis sur plusieurs colonnes au lieu d'une longue pile verticale ; beaucoup de
 * groupes → une colonne par bloc (défilement horizontal en dernier recours). */
const GRID = { cellWidth: 186, cellGap: 4, groupGap: 12, groupChrome: 14, minCols: 1, maxCols: 4 };

export function InitiativeHealthMatrix({
  groups,
  labels,
  onLeverClick,
  details,
  stageLabel,
}: {
  groups: LeverHealthGroup[];
  labels: Record<LeverHealthStatus, string> & {
    empty: string;
    showAll: string;
    filterHint: string;
  };
  onLeverClick: (leverId: string) => void;
  /** Données de l'aperçu au survol d'un levier (voir `leverCellPreview`) ; absent = pas d'aperçu. */
  details?: (lever: Lever) => LeverCellPreview;
  /** Libellé (personnalisé) de l'étape du cycle de vie, pour la ligne « Maturité ». */
  stageLabel?: (status: LeverStatus) => string;
}) {
  // Filtre de statut géré localement au composant, piloté par la légende sous la matrice
  // (chaque entrée est un bouton bascule) : tableau vide = aucun filtre actif (multi-sélection).
  const [statusFilter, setStatusFilter] = useState<LeverHealthStatus[]>([]);
  const [hovered, setHovered] = useState<{ lever: Lever; health: LeverHealthStatus } | null>(null);
  // Colonnes calculées sur les groupes non filtrés : la disposition reste stable quand on
  // bascule un statut dans la légende.
  const maxCells = groups.reduce((max, group) => Math.max(max, group.cells.length), 0);
  const { ref, cols } = useAdaptiveGroupColumns({ ...GRID, groupCount: groups.length, maxCells });

  if (groups.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">{labels.empty}</p>;
  }

  const filteredGroups = groups.map((group) => ({
    ...group,
    cells:
      statusFilter.length === 0
        ? group.cells
        : group.cells.filter((cell) => statusFilter.includes(cell.health)),
  }));

  return (
    <ChartHoverArea className="space-y-3">
      <div ref={ref} className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-start justify-center gap-3">
          {filteredGroups.map((group, index) => {
            const cells = [...group.cells].sort(
              (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)
            );
            // Largeur du bloc = ses propres leviers (non filtrés, pour rester stable), plafonnée à `cols`.
            const groupCols = Math.max(GRID.minCols, Math.min(cols, groups[index].cells.length));
            return (
              <div
                key={group.key}
                className="shrink-0"
                style={{ width: groupBlockWidth(groupCols, GRID) }}
              >
                <div
                  className="mb-1.5 line-clamp-2 text-center text-[10.5px] font-semibold text-secondary"
                  title={group.label}
                >
                  {group.label}
                </div>
                <div className="text-center text-[10px] text-tertiary">
                  {group.cells.filter((cell) => cell.health !== "cancelled").length}
                </div>
                <div
                  className="mt-1.5 grid gap-1 rounded-sm border border-info-blue/40 bg-info-blue-light p-1.5"
                  style={{ gridTemplateColumns: `repeat(${groupCols}, minmax(0, 1fr))` }}
                >
                  {cells.map(({ lever, health }) => (
                    <button
                      key={lever.id}
                      type="button"
                      onClick={() => onLeverClick(lever.id)}
                      onMouseEnter={() => setHovered({ lever, health })}
                      onMouseLeave={() => setHovered(null)}
                      className={`flex flex-col items-start justify-center rounded-[2px] border-l-4 px-1.5 py-1 text-left leading-tight transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-black ${HEALTH_CELL_STYLE[health]}`}
                      aria-label={`${lever.code} ${lever.name} ${labels[health]}`}
                    >
                      <span className="w-full truncate text-[11px] font-semibold text-primary">
                        {lever.code}{" "}
                        <span className="font-normal text-secondary">· {lever.name}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Légende = filtre : chaque statut est un bouton bascule (aria-pressed). Sans filtre, tous
          les carrés sont pleins (légende classique) ; avec filtre, les statuts retenus gardent un
          carré plein + libellé gras souligné, les autres passent en carré contour atténué. */}
      <div
        role="group"
        aria-label={labels.filterHint}
        title={labels.filterHint}
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-secondary"
      >
        {HEALTH_ORDER.map((status) => {
          const isFiltering = statusFilter.length > 0;
          const isActive = statusFilter.includes(status);
          const isDimmed = isFiltering && !isActive;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isActive}
              onClick={() =>
                setStatusFilter((prev) => toggleInSelection(prev, status) as LeverHealthStatus[])
              }
              className={`inline-flex items-center gap-1.5 rounded-[2px] px-1 py-0.5 transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${
                isActive
                  ? "font-semibold text-primary underline underline-offset-2"
                  : isDimmed
                    ? "opacity-50 hover:opacity-100"
                    : ""
              }`}
            >
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-[2px] ${
                  isDimmed ? `border ${HEALTH_OUTLINE_STYLE[status]}` : HEALTH_STYLE[status]
                }`}
              />
              {labels[status]}
            </button>
          );
        })}
        {/* Toujours rendu (invisible sans filtre) pour éviter un saut de mise en page. */}
        <button
          type="button"
          onClick={() => setStatusFilter([])}
          className={`rounded-[2px] px-1 py-0.5 text-[11px] font-semibold text-secondary underline underline-offset-2 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${
            statusFilter.length === 0 ? "invisible" : ""
          }`}
        >
          {labels.showAll}
        </button>
      </div>
      {hovered && details && (
        <FloatingPreview>
          <LeverCellPreviewCard
            lever={hovered.lever}
            preview={details(hovered.lever)}
            stageLabel={stageLabel}
            healthLabel={labels[hovered.health]}
          />
        </FloatingPreview>
      )}
    </ChartHoverArea>
  );
}
