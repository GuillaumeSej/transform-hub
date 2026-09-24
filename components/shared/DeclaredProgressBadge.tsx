import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";

/**
 * Pastille d'avancement (%) — même palette RAG (rouge/amber/vert) que `ProgressBar`
 * (`components/shared/ProgressBar.tsx`, mêmes seuils 70/50) et `StatusBadge`, sous forme compacte :
 * en-tête de swimlane workstream du Kanban (`engine.workstreamProgressPct`) et niveaux de
 * l'arborescence. `pct === null` (rien à mesurer, ex. chantier sans levier actif) affiche un état
 * "Non renseigné" neutre plutôt qu'un 0 % trompeur.
 */
export function DeclaredProgressBadge({
  pct,
  className,
}: {
  pct: number | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (pct == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-neutral-50 px-2 py-0.5 text-[10.5px] font-semibold text-tertiary",
          className
        )}
      >
        {t("shared.declaredProgress.notProvided", "Non renseigné")}
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const toneClass =
    clamped >= 70
      ? "bg-rag-green-light text-rag-green-dark"
      : clamped >= 50
        ? "bg-rag-amber-light text-rag-amber"
        : "bg-rag-red-light text-rag-red";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
        toneClass,
        className
      )}
    >
      {clamped}%
    </span>
  );
}
