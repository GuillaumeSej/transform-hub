import { cn } from "@/lib/utils";
import type { MaturityStageConfig } from "@/types";

/**
 * Badge d'étape de maturité d'un axe ou d'un chantier. CLONE délibéré de
 * `components/shared/StageBadge.tsx` plutôt qu'une généricisation : celui-ci est typé sur l'union
 * fermée `LeverStatus` (5 étapes connues à la compilation, couleurs câblées une par une), alors
 * qu'ici l'ensemble des étapes est CONFIGURABLE par programme et de longueur libre — on ne peut ni
 * connaître les clés à l'avance ni leur attribuer une couleur nommée.
 *
 * Couleur dérivée donc de la POSITION dans le cycle (`order` rapporté au nombre d'étapes) plutôt
 * que de l'identité de l'étape : dégradé neutre → accent au fil de l'avancement, et un traitement
 * distinct pour les étapes terminales (état de sortie, hors cycle linéaire). Une palette à 4 tons
 * suffit et reste lisible quel que soit le nombre d'étapes (4 comme 12).
 */

/** Du moins avancé au plus avancé — index calculé par quartile de progression dans le cycle.
 *  Classes littérales (pas de template dynamique) pour que le JIT Tailwind les détecte. */
const PROGRESS_STYLES = [
  "bg-neutral-100 text-secondary",
  "bg-bp-warm-taupe/10 text-bp-warm-brown",
  "bg-info-blue-light text-info-blue",
  "bg-rag-green-light text-rag-green-dark",
];

const TERMINAL_STYLE = "bg-neutral-200 text-primary";

export function AxisStageBadge({
  stageId,
  stages,
  className,
}: {
  stageId: string;
  /** Référentiel du programme (voir `useMaturityStages`) — la source de vérité du libellé. */
  stages: MaturityStageConfig[];
  className?: string;
}) {
  const stage = stages.find((s) => s.id === stageId);
  // Étape supprimée du référentiel depuis qu'elle a été affectée : on affiche l'id brut plutôt
  // que rien, pour que l'incohérence soit visible et corrigeable, jamais silencieuse.
  const label = stage?.label ?? stageId;

  let style: string;
  if (!stage) {
    style = PROGRESS_STYLES[0];
  } else if (stage.isTerminal) {
    style = TERMINAL_STYLE;
  } else {
    const cycle = stages.filter((s) => !s.isTerminal);
    const position = cycle.findIndex((s) => s.id === stage.id);
    const ratio = cycle.length > 1 ? position / (cycle.length - 1) : 0;
    const bucket = Math.min(
      PROGRESS_STYLES.length - 1,
      Math.max(0, Math.round(ratio * (PROGRESS_STYLES.length - 1)))
    );
    style = PROGRESS_STYLES[bucket];
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        style,
        className
      )}
    >
      {label}
    </span>
  );
}
