"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

export type SankeyDatum = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

/** Couleurs sémantiques BearingPoint pour le Sankey chronologique.
 *  Le mapping se fait par préfixe du nom de nœud pour rester découplé des labels i18n. */
function nodeColor(name: string): string {
  if (name.startsWith("Tous")) return "#000000";
  if (name.includes("M1")) return "#F8D5D2";
  if (name.includes("M2")) return "#F58F89";
  if (name.includes("M3")) return "#FF3D3D";
  if (name.includes("M4")) return "#C8281A";
  if (name.includes("M5") || name.includes("Réalisé")) return "#2E7D32";
  if (name.includes("Abandonné") || name.includes("Annulé")) return "#E8E2DE";
  return "#6B5750"; // fallback warm brown
}

/** Couleur du lien : hérite du nœud source, plus clair pour les abandons. */
function linkColor(sourceName: string, targetName: string): string {
  if (targetName.includes("Abandonné") || targetName.includes("Annulé")) return "#E8E2DE";
  return nodeColor(sourceName);
}

function linkOpacity(targetName: string): number {
  if (targetName.includes("Abandonné") || targetName.includes("Annulé")) return 0.2;
  return 0.35;
}

/** Flux chronologique "tous les leviers" → étapes de maturité M1-M5, avec branches de sortie
 *  "Abandonné après MX" à chaque étape. Les leviers qui stagnent à une étape sont visibles par
 *  la différence de largeur entre le flux entrant et les flux sortants du nœud.
 *
 *  Les libellés sont centrés au-dessus de chaque nœud (pas à droite) pour éviter les
 *  chevauchements entre colonnes sur les widgets de largeur modeste. */
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
        nodePadding={24}
        nodeWidth={12}
        margin={{ top: 26, right: 70, bottom: 8, left: 40 }}
        link={({
          sourceX,
          sourceY,
          sourceControlX,
          targetX,
          targetY,
          targetControlX,
          linkWidth,
          index,
        }) => {
          const sourceNode = data.nodes[data.links[index].source];
          const targetNode = data.nodes[data.links[index].target];
          const color = linkColor(sourceNode.name, targetNode.name);
          const opacity = linkOpacity(targetNode.name);
          const halfWidth = linkWidth / 2;
          return (
            <path
              d={`M${sourceX},${sourceY + halfWidth}
                  C${sourceControlX},${sourceY + halfWidth} ${targetControlX},${targetY + halfWidth} ${targetX},${targetY + halfWidth}
                  L${targetX},${targetY - halfWidth}
                  C${targetControlX},${targetY - halfWidth} ${sourceControlX},${sourceY - halfWidth} ${sourceX},${sourceY - halfWidth}
                  Z`}
              fill={color}
              fillOpacity={opacity}
              stroke="none"
            />
          );
        }}
        node={({ x, y, width, height: nodeHeight, payload }) => {
          const color = nodeColor(payload.name);
          return (
            <g
              onClick={() => onNodeClick?.(payload.name)}
              style={{ cursor: onNodeClick ? "pointer" : "default" }}
            >
              <rect
                x={x}
                y={y}
                width={width}
                height={Math.max(nodeHeight, 2)}
                fill={color}
                rx={2}
              />
              <text
                x={x + width / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={9.5}
                fill="#1A1A1A"
                fontWeight={payload.name.includes("Abandonné") ? 400 : 600}
              >
                {payload.name}
              </text>
              <text
                x={x + width / 2}
                y={y + nodeHeight / 2}
                dy={3.5}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={color === "#E8E2DE" || color === "#F8D5D2" ? "#1A1A1A" : "#fff"}
              >
                {nodeHeight >= 14 ? payload.value : ""}
              </text>
            </g>
          );
        }}
      >
        <Tooltip formatter={(value) => [`${value} levier(s)`, ""]} />
      </Sankey>
    </ResponsiveContainer>
  );
}
