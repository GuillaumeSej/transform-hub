"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

export type SankeyDatum = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

const CHRONO_COLORS = [
  "#806659",
  "#FF3C47",
  "#FFB1B5",
  "#421799",
  "#320300",
  "#421799",
  "#E87D5F",
  "#D4A574",
  "#C49B6A",
  "#B8956F",
  "#A68960",
  "#4CAF50",
  "#F0A090",
];

/** Flux chronologique "tous les leviers" -> étape atteinte, avec une branche de sortie ("Annulé
 * après X") à chaque étape — format unique (l'ancienne vue "Distribution" simplifiée faisait
 * doublon avec le funnel "Avancement par étape du cycle de vie" et n'apportait rien de plus).
 * Clic sur un nœud pour creuser.
 *
 * Ce flux a beaucoup plus de colonnes (une par étape + les sorties "Annulé après X") qu'un Sankey
 * à 2 niveaux classique — dessiner les libellés À CÔTÉ de chaque nœud (comme un Sankey simple)
 * les fait chevaucher la colonne suivante dès que la largeur du widget est modeste. Les libellés
 * sont donc centrés AU-DESSUS de chaque nœud (dans l'empan horizontal de sa propre colonne) plutôt
 * qu'à sa droite, ce qui élimine ce chevauchement inter-colonnes. */
export function SankeyChart({
  data,
  height = 340,
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
        nodePadding={20}
        nodeWidth={12}
        margin={{ top: 26, right: 70, bottom: 8, left: 40 }}
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
              height={Math.max(nodeHeight, 2)}
              fill={CHRONO_COLORS[index % CHRONO_COLORS.length]}
              rx={2}
            />
            <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={9.5} fill="#1A1A1A">
              {payload.name}
            </text>
            <text
              x={x + width / 2}
              y={y + nodeHeight / 2}
              dy={3.5}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill="#fff"
            >
              {nodeHeight >= 14 ? payload.value : ""}
            </text>
          </g>
        )}
      >
        <Tooltip formatter={(value) => [`${value} levier(s)`, ""]} />
      </Sankey>
    </ResponsiveContainer>
  );
}
