"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

export type SankeyDatum = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

const NODE_COLORS = ["#6B5750", "#FF3D3D", "#F5A623", "#4A90D9", "#2E7D32", "#8E24AA", "#9E9E9E"];

/** Flux "tous les leviers" -> étape atteinte (L1..L5, Annulé) — clic sur un nœud pour creuser. */
export function SankeyChart({
  data,
  height = 260,
  onNodeClick,
}: {
  data: SankeyDatum;
  height?: number;
  onNodeClick?: (name: string) => void;
}) {
  if (data.links.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun levier à représenter.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Sankey
        data={data}
        nodePadding={22}
        nodeWidth={10}
        margin={{ top: 8, right: 110, bottom: 8, left: 8 }}
        link={{ stroke: "#D8CFC9" }}
        node={({ x, y, width, height, index, payload }) => (
          <g
            onClick={() => onNodeClick?.(payload.name)}
            style={{ cursor: onNodeClick ? "pointer" : "default" }}
          >
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={NODE_COLORS[index % NODE_COLORS.length]}
              rx={2}
            />
            <text x={x + width + 6} y={y + height / 2} dy={4} fontSize={10.5} fill="#3A342F">
              {payload.name} ({payload.value})
            </text>
          </g>
        )}
      >
        <Tooltip formatter={(value) => [`${value} levier(s)`, ""]} />
      </Sankey>
    </ResponsiveContainer>
  );
}
