"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MovementExecutionStatus, MovementStatusByTypeRow } from "@/lib/hrExecution";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { movementTypeLabel } from "@/lib/hrMovementLabels";
import type { WorkforceMovement } from "@/types";

export function MovementStatusByTypeChart({
  data,
  height = 280,
  onBarClick,
}: {
  data: MovementStatusByTypeRow[];
  height?: number;
  /** Clic sur un segment (type × statut) — ouvre le détail des mouvements de cette cellule (voir
   *  `MovementDrilldownModal`, câblé dans `app/(app)/hr/page.tsx`). */
  onBarClick?: (
    type: WorkforceMovement["type"],
    status: MovementExecutionStatus,
    movements: WorkforceMovement[]
  ) => void;
}) {
  const { t } = useTranslation();
  const handleClick = (status: MovementExecutionStatus) => (payload: unknown) => {
    const row = payload as MovementStatusByTypeRow | undefined;
    if (row && onBarClick) onBarClick(row.type, status, row.movementsByStatus[status]);
  };
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 42 + 70)}>
      <BarChart data={data} layout="vertical" margin={{ top: 6, right: 14, left: 10, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="type"
          width={115}
          tickFormatter={(value) => movementTypeLabel(t, String(value))}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          labelFormatter={(label) => movementTypeLabel(t, String(label))}
          formatter={(value, name) => [
            t("shared.forcedDepartureStatusChart.movementsTooltip", "{n} mouvement(s)").replace(
              "{n}",
              String(Number(value))
            ),
            String(name),
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar
          dataKey="realized"
          name={t("chart.bar.realized", "Réalisé")}
          stackId="status"
          fill="#421799"
          onClick={handleClick("realized")}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="overdue"
          name={t("hr.alert.overdue", "En retard")}
          stackId="status"
          fill="#FF3C47"
          onClick={handleClick("overdue")}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="dueSoon"
          name={t("shared.hrOwnerActionTable.dueSoon", "À venir ≤ 90 j")}
          stackId="status"
          fill="#FFB1B5"
          onClick={handleClick("dueSoon")}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="later"
          name={t("shared.hrOwnerActionTable.later", "À venir > 90 j")}
          stackId="status"
          fill="#A99E9A"
          onClick={handleClick("later")}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="abandoned"
          name={t("dashboard.widgets.healthCancelled", "Abandonné")}
          stackId="status"
          fill="#806659"
          onClick={handleClick("abandoned")}
          cursor={onBarClick ? "pointer" : undefined}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
