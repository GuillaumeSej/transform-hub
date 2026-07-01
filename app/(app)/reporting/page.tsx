"use client";

import { useRouter } from "next/navigation";
import { CircleCheck, Clock, ListChecks, TriangleAlert } from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { Placeholder } from "@/components/shared/Placeholder";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { KPICard } from "@/components/shared/KPICard";
import type { ActionStatus, LeverAction } from "@/types";

const STATUS_LABEL: Record<ActionStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Fait",
  delayed: "En retard",
};

type ActionRow = LeverAction & {
  leverId: string;
  leverName: string;
  subLeverName: string | null;
};

/** Reporting générique (STRETCH) pour la plupart des rôles ; pour le Lever Owner, la nav
 * pointe explicitement vers "Action Plans" — cette page agrège alors toutes les actions de tous
 * les leviers/sous-leviers en une vue unique, claire, pour suivre l'avancement du plan d'action. */
export default function ReportingPage() {
  const { role } = useRole();
  const data = useBeTrackData();
  const router = useRouter();

  if (role !== "lever") {
    return (
      <Placeholder
        title="Reporting"
        description="Rapports de performance consolidés multi-workstream. Module STRETCH prévu dans une prochaine passe."
      />
    );
  }

  const rows: ActionRow[] = data.levers.flatMap((lever) => {
    const subLevers = data.getSubLeversForLever(lever.id);
    if (subLevers.length > 0) {
      return subLevers.flatMap((sl) =>
        sl.actions.map(
          (a): ActionRow => ({
            ...a,
            leverId: lever.id,
            leverName: lever.name,
            subLeverName: sl.name,
          })
        )
      );
    }
    return (lever.actions ?? []).map(
      (a): ActionRow => ({
        ...a,
        leverId: lever.id,
        leverName: lever.name,
        subLeverName: null,
      })
    );
  });

  const total = rows.length;
  const done = rows.filter((r) => r.status === "done").length;
  const delayed = rows.filter((r) => r.status === "delayed").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;

  const columns: ColumnDef<ActionRow>[] = [
    { key: "name", label: "Action", render: (r) => <strong>{r.name}</strong> },
    { key: "leverName", label: "Levier" },
    {
      key: "subLeverName",
      label: "Sous-levier",
      render: (r) => r.subLeverName ?? "—",
    },
    { key: "start", label: "Début" },
    { key: "end", label: "Fin" },
    {
      key: "cost",
      label: "Coût (€K)",
      align: "right",
      render: (r) => r.cost.toLocaleString("fr-FR"),
    },
    {
      key: "status",
      label: "Statut",
      render: (r) => STATUS_LABEL[r.status],
    },
  ];

  return (
    <div className="animate-fade-up">
      <h1 className="relative mb-5 w-fit pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
        Action Plans
      </h1>
      <div className="mb-5 grid grid-cols-4 gap-4">
        <KPICard label="Actions totales" value={String(total)} icon={ListChecks} />
        <KPICard label="En cours" value={String(inProgress)} icon={Clock} accent="amber" />
        <KPICard label="Terminées" value={String(done)} icon={CircleCheck} accent="green" />
        <KPICard
          label="En retard"
          value={String(delayed)}
          icon={TriangleAlert}
          accent={delayed > 0 ? "red" : "default"}
        />
      </div>
      {rows.length === 0 ? (
        <Placeholder
          title="Action Plans"
          description="Aucune action définie pour l'instant. Ouvrez un levier et son onglet « Plan d'action » pour en créer."
        />
      ) : (
        <EditableTable
          data={rows}
          columns={columns}
          onRowClick={(row) => router.push(`/levers/detail?id=${row.leverId}`)}
          searchPlaceholder="Rechercher une action, un levier..."
          defaultSort={{ key: "end", direction: "asc" }}
        />
      )}
    </div>
  );
}
