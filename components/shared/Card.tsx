import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Carte de contenu — porté depuis `.card` du prototype legacy. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-4 overflow-hidden rounded-lg border border-border bg-white shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch justify-between gap-2 border-b border-border px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3 sm:px-[18px]">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-primary">{title}</h3>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return <div className={flush ? "" : "p-[18px]"}>{children}</div>;
}
