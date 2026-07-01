import { CircleAlert, CircleCheck, CircleUser, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Alert } from "@/types";

const ICONS = { red: CircleAlert, amber: TriangleAlert, green: CircleCheck, blue: CircleUser };
const ICON_STYLE = {
  red: "bg-rag-red-light text-rag-red",
  amber: "bg-rag-amber-light text-rag-amber",
  green: "bg-rag-green-light text-rag-green-dark",
  blue: "bg-info-blue-light text-info-blue",
};

/** Ligne d'alerte — porté depuis `.alert-row` du prototype legacy. */
export function AlertItem({ alert }: { alert: Alert }) {
  const Icon = ICONS[alert.type];
  return (
    <div className="flex gap-3 border-b border-border py-3 last:border-b-0">
      <div
        className={cn(
          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm",
          ICON_STYLE[alert.type]
        )}
      >
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-primary">{alert.title}</div>
        <div className="mt-0.5 text-[11.5px] text-secondary">{alert.desc}</div>
        <div className="mt-1 text-[10.5px] text-tertiary">
          {alert.ts} · {alert.scope}
        </div>
      </div>
    </div>
  );
}
