import { cn } from "@/lib/utils";

/** Barre de progression avec code couleur — porté depuis `.pbar` du prototype legacy. */
export function ProgressBar({
  pct,
  showLabel = true,
  className,
}: {
  pct: number;
  showLabel?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const colorClass = clamped >= 70 ? "bg-rag-green" : clamped >= 50 ? "bg-rag-amber" : "bg-rag-red";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={cn("h-full rounded-full transition-[width]", colorClass)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="min-w-[36px] text-right text-[11px] font-semibold text-secondary">
          {clamped}%
        </span>
      )}
    </div>
  );
}
