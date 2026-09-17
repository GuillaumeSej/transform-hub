import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";

/**
 * Badge d'avancement DÉCLARATIF (`lib/workstreamLogic.ts::leverDeclaredProgress`/
 * `workstreamDeclaredProgress`) — même palette RAG (rouge/amber/vert) que `ProgressBar`
 * (`components/shared/ProgressBar.tsx`, mêmes seuils 70/50) et `StatusBadge`, mais sous forme de
 * pastille compacte (pas de barre) : utilisé partout où l'espace horizontal est contraint (en-tête
 * de swimlane workstream du Kanban, niveaux de l'arborescence Workstream→Type→Levier→Action).
 *
 * `pct === null` (aucune donnée déclarée par le pilote — voir doc-comment de
 * `workstreamDeclaredProgress`/`leverDeclaredProgress`) affiche un état "Non renseigné" neutre
 * plutôt qu'un 0% trompeur qui laisserait croire à un avancement nul mesuré.
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
