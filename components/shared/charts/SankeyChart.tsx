"use client";

import { useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

export type SankeyDatum = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

const NODE_COLORS = ["#806659", "#FF3C47", "#FFB1B5", "#421799", "#320300", "#421799", "#969696"];
const CHRONO_COLORS = [
  "#806659", "#FF3C47", "#FFB1B5", "#421799", "#320300", "#421799",
  "#E87D5F", "#D4A574", "#C49B6A", "#B8956F", "#A68960", "#4CAF50",
  "#F0A090",
];

/** Flux "tous les leviers" -> étape atteinte (L1..L5, Annulé) — clic sur un nœud pour creuser. */
export function SankeyChart({
  data,
  chronologyData,
  height = 260,
  onNodeClick,
}: {
  data: SankeyDatum;
  chronologyData?: SankeyDatum;
  height?: number;
  onNodeClick?: (name: string) => void;
}) {
  const [view, setView] = useState<"simple" | "chrono">("simple");
  const activeData = view === "chrono" && chronologyData ? chronologyData : data;
  const colors = view === "chrono" ? CHRONO_COLORS : NODE_COLORS;

  if (activeData.links.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun levier à représenter.</p>;
  }

  return (
    <div>
      {chronologyData && (
        <div className="mb-2 flex gap-1">
          <button
            onClick={() => setView("simple")}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
              view === "simple"
                ? "bg-bp-coral text-white"
                : "bg-bg-elevated text-text-secondary hover:bg-bg-surface"
            }`}
          >
            Distribution
          </button>
          <button
            onClick={() => setView("chrono")}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
              view === "chrono"
                ? "bg-bp-coral text-white"
                : "bg-bg-elevated text-text-secondary hover:bg-bg-surface"
            }`}
          >
            Chronologie
          </button>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <Sankey
          data={activeData}
          nodePadding={view === "chrono" ? 14 : 22}
          nodeWidth={10}
          margin={{ top: 8, right: view === "chrono" ? 140 : 110, bottom: 8, left: 8 }}
          link={{ stroke: "#E2E2E2" }}
          node={({ x, y, width, height: nodeHeight, index, payload }) => (
            <g
              onClick={() => onNodeClick?.(payload.name)}
              style={{ cursor: onNodeClick ? "pointer" : "default" }}
            >
              <rect
                x={x}
                y={y}
                width={width}
                height={nodeHeight}
                fill={colors[index % colors.length]}
                rx={2}
              />
              <text x={x + width + 6} y={y + nodeHeight / 2} dy={4} fontSize={10.5} fill="#1A1A1A">
                {payload.name} ({payload.value})
              </text>
            </g>
          )}
        >
          <Tooltip formatter={(value) => [`${value} levier(s)`, ""]} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
