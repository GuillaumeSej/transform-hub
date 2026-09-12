"use client";

import {
  colorForChantier,
  milestoneWeightPct,
  progressBucket,
  type ProgressBucket,
} from "@/lib/axisLogic";
import { MILESTONE_CHECKLISTS, MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Chantier, ChantierAction, MilestoneId } from "@/types";

/**
 * Vue E0→E4 par axe — widget dashboard "chantier-health" (round 8, remplace `ChantierHealthMatrix`,
 * qui affichait un état de santé à 3 niveaux PAR CHANTIER). Le grain de lecture passe du chantier au
 * LEVIER : chaque section d'axe montre 5 colonnes (jalons E0…E4), chaque levier apparaissant en
 * bulle dans la colonne de son `milestones.currentMilestone` courant. Round 18 : TOUS les leviers de
 * l'axe figurent ici, avec ou sans KPI rattaché — le PO a unifié le suivi de tous les leviers sur ces
 * jalons E0→E4 et supprimé l'ancien kanban classique (`LevierKanbanBoard.tsx`, supprimé) qui couvrait
 * jusqu'ici les leviers sans KPI séparément.
 *
 * La bulle affiche le nom du levier ET le nom de son CHANTIER PARENT en texte visible (jamais
 * seulement en infobulle — demande PO explicite : on doit voir de quel chantier relève un levier
 * sans avoir à survoler chaque bulle), colorée/bordée par `colorForChantier(chantier.id)`
 * (lib/axisLogic.ts, round 8) pour qu'un même chantier se reconnaisse d'un coup d'œil entre les
 * colonnes E0-E4.
 *
 * Clic sur une bulle → même destination que l'ancienne matrice (`onLevierClick`, ouverture du
 * panneau du CHANTIER parent — un levier n'a pas de panneau propre).
 */

export type LevierBoardCard = {
  action: ChantierAction;
  chantier: Chantier;
  /** `colorForChantier(chantier.id)` (lib/axisLogic.ts) — classe Tailwind `bg-*-500` pleine. */
  chantierColor: string;
};

export type LevierBoardGroup = {
  /** Id de l'axe — clé React de la section. */
  key: string;
  /** Nom de l'axe — en-tête de section. */
  label: string;
  /** `StrategicAxis.color` — même convention d'accent que l'ancien widget "Répartition par axe". */
  color?: string;
  /** TOUS les leviers de l'axe (avec ou sans KPI rattaché, round 18), groupés par jalon courant
   *  (E0…E4). */
  milestones: Record<MilestoneId, LevierBoardCard[]>;
  /** Chantiers de l'axe (round 10, point 1) — alimente la légende de couleur affichée sous
   *  l'en-tête de section, juste avant les colonnes E0→E4. Optionnel : un appelant qui ne l'a pas
   *  sous la main (aucun aujourd'hui) n'affiche simplement pas de légende. */
  chantiers?: Chantier[];
};

/** Correspondance `bg-*-500` → `border-*-500` pour la palette FIXE de `colorForChantier`
 *  (`CHANTIER_COLOR_PALETTE`, lib/axisLogic.ts) — mapping VOLONTAIREMENT littéral (jamais de
 *  substitution de chaîne `chantierColor.replace("bg-", "border-")` à l'exécution) : Tailwind JIT
 *  scanne le CODE SOURCE pour les classes utilisées, une classe construite dynamiquement à
 *  l'exécution n'y apparaît jamais et ne serait donc jamais générée. Exporté pour rester réutilisable
 *  par un futur composant ayant le même besoin plutôt que d'en dupliquer une copie qui pourrait
 *  diverger si la palette d'axisLogic.ts change un jour (round 18 : son unique autre consommateur,
 *  `LevierKanbanBoard.tsx`, a été supprimé). */
/** Pastille de couleur d'un `progressBucket` (lib/axisLogic.ts) — même convention visuelle que
 *  `BUCKET_DOT_CLASS` de `MilestoneChecklistPanel.tsx` (round 14, cohérence entre écrans) :
 *  déclarée ici séparément plutôt que réimportée, ce fichier n'ayant pas accès à cette constante
 *  non exportée. */
const AVG_PROGRESS_DOT_CLASS: Record<ProgressBucket, string> = {
  empty: "bg-neutral-300",
  red: "bg-rag-red",
  amber: "bg-rag-amber",
  green: "bg-rag-green",
};

export const CHANTIER_BORDER_CLASS: Record<string, string> = {
  "bg-blue-500": "border-blue-500",
  "bg-emerald-500": "border-emerald-500",
  "bg-violet-500": "border-violet-500",
  "bg-pink-500": "border-pink-500",
  "bg-amber-500": "border-amber-500",
  "bg-indigo-500": "border-indigo-500",
  "bg-teal-500": "border-teal-500",
  "bg-orange-500": "border-orange-500",
  "bg-rose-500": "border-rose-500",
  "bg-cyan-500": "border-cyan-500",
};

/** Carte/bulle d'un levier, colorée par son chantier parent (round 18 : jusqu'ici réutilisée telle
 *  quelle par `LevierKanbanBoard.tsx`, supprimé — reste exportée pour un futur consommateur ayant le
 *  même besoin). */
export function LevierCard({
  action,
  chantier,
  chantierColor,
  onLevierClick,
}: LevierBoardCard & {
  onLevierClick: (chantierId: string, focusActionId?: string) => void;
}) {
  const borderClass = CHANTIER_BORDER_CLASS[chantierColor] ?? "border-border";
  // Round 9, point 1 : remplissage pondéré par le poids du jalon COURANT (`milestoneWeightPct`,
  // lib/axisLogic.ts — E0/E1/E2 cadrage léger, E3 exécution longue, E4 clôture) — un DEUXIÈME
  // signal qui doit coexister avec l'accent de couleur par chantier (`border-l-4` ci-dessus) sans
  // le remplacer : une fine bande en bas de carte (largeur proportionnelle au poids, jamais un
  // lavage de fond complet) reste lisible avec le texte à 100% comme à 10%, contrairement à un
  // fond teinté qui viendrait réduire le contraste du nom du levier.
  const weightPct = milestoneWeightPct(action);
  return (
    <button
      type="button"
      onClick={() => onLevierClick(chantier.id, action.id)}
      title={`${action.name} · ${chantier.name} · ${weightPct}%`}
      className={`group relative mb-1.5 flex w-full flex-col items-start gap-0.5 overflow-hidden rounded-md border border-l-4 bg-white p-2 pb-2.5 text-left transition last:mb-0 hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-black ${borderClass}`}
    >
      <span className="flex w-full items-center gap-1.5">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${chantierColor}`} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-primary">
          {action.name}
        </span>
      </span>
      <span className="w-full truncate pl-3.5 text-[10.5px] text-tertiary" title={chantier.name}>
        {chantier.name}
      </span>
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-[3px] rounded-r-full bg-black/50 transition-[width]"
        style={{ width: `${weightPct}%` }}
      />
    </button>
  );
}

/**
 * Moyenne (0-100) des `progressPct` déclarés des items du jalon COURANT d'un levier (round 12) —
 * même logique interne que `milestoneProgressPct` (lib/axisLogic.ts) mais bornée au jalon courant
 * seul (pas de crédit cumulé des jalons déjà franchis) : ce widget affiche une moyenne "de la
 * colonne" à l'instant T, pas un avancement global du levier. Un item non répondu compte pour `0`,
 * comme `milestoneProgressPct`.
 *
 * Simplification round 12 (notée dans le rapport de fin de tâche) : les items `auto` du jalon sont
 * traités comme des items manuels non répondus (`0`) plutôt que recalculés via
 * `resolveMilestoneAutoFlags` — ce composant ne reçoit pas `allChantiers`/`allActions` (nécessaires
 * à ce calcul) et enfiler ces collections en props jusqu'ici pour ce seul usage serait
 * disproportionné.
 */
function currentMilestoneAverage(action: ChantierAction, milestoneId: MilestoneId): number {
  const defs = MILESTONE_CHECKLISTS[milestoneId];
  if (defs.length === 0) return 0;
  const stored = action.milestones?.checklists?.[milestoneId] ?? [];
  let sum = 0;
  for (const def of defs) {
    const storedItem = stored.find((i) => i.itemId === def.itemId);
    sum += storedItem?.progressPct ?? 0;
  }
  return sum / defs.length;
}

export function LevierMilestoneBoard({
  groups,
  labels,
  onLevierClick,
}: {
  groups: LevierBoardGroup[];
  /** `emptyColumn` : placeholder discret d'une colonne de jalon sans levier — un texte plutôt que
   *  rien du tout, pour que la structure à 5 colonnes reste lisible même axe par axe. */
  labels: { emptyColumn: string };
  onLevierClick: (chantierId: string, focusActionId?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.key}>
          {/* En-tête de section (axe) — même accent coloré que l'ancienne matrice de santé. */}
          <div
            className="mb-2 flex items-center gap-2 border-b border-border pb-1.5"
            style={{ borderBottomColor: group.color ?? undefined }}
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: group.color ?? "var(--bp-warm-taupe)" }}
            />
            <span className="text-[12.5px] font-bold uppercase tracking-wide text-primary">
              {group.label}
            </span>
          </div>
          {/* Légende de couleur des chantiers (round 10, point 1) — même `colorForChantier` que les
              bordures/pastilles des bulles ci-dessous, pour qu'un chantier se reconnaisse d'un
              coup d'œil entre la légende et les colonnes E0-E4. Compacte : pastille + nom, pas une
              liste détaillée. */}
          {group.chantiers && group.chantiers.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {group.chantiers.map((chantier) => (
                <button
                  key={chantier.id}
                  type="button"
                  onClick={() => onLevierClick(chantier.id)}
                  title={chantier.name}
                  className="flex items-center gap-1.5 rounded text-[10.5px] text-tertiary transition hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${colorForChantier(chantier.id)}`}
                  />
                  {/* Round 12 : nom en entier (plus de troncature `max-w-[140px] truncate`) et
                      cliquable — demande PO explicite, ouvre le panneau du chantier comme les
                      bulles de leviers ci-dessous (`onLevierClick` sans `focusActionId`). */}
                  <span>{chantier.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 min-[640px]:grid-cols-5">
            {MILESTONE_ORDER.map((milestoneId) => {
              const cards = group.milestones[milestoneId] ?? [];
              // Round 12 : moyenne des `progressPct` déclarés du jalon COURANT, affichée à côté du
              // compte de leviers — voir `currentMilestoneAverage` ci-dessus pour la simplification
              // (items auto comptés à 0, pas de `resolveMilestoneAutoFlags` ici). Round 14 : une
              // pastille `progressBucket(avgPct)` accompagne ce texte (même convention que
              // `MilestoneChecklistPanel.tsx`) — seulement rendue quand `avgPct` est défini, donc
              // jamais pour une colonne vide (voir juste au-dessus, `cards.length > 0`).
              const avgPct =
                cards.length > 0
                  ? Math.round(
                      cards.reduce(
                        (sum, card) => sum + currentMilestoneAverage(card.action, milestoneId),
                        0
                      ) / cards.length
                    )
                  : undefined;
              return (
                <div
                  key={milestoneId}
                  className="min-h-[92px] rounded-lg border border-border bg-neutral-50 p-2"
                >
                  <div className="mb-2 flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                      {milestoneId}
                    </span>
                    <span className="rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
                      {cards.length}
                    </span>
                  </div>
                  {avgPct !== undefined && (
                    <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[10px] text-tertiary">
                      <span
                        aria-hidden
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${AVG_PROGRESS_DOT_CLASS[progressBucket(avgPct)]}`}
                      />
                      <span>
                        {t(
                          "strategicDashboard.levierBoard.avgProgress",
                          "{pct}% en moyenne"
                        ).replace("{pct}", String(avgPct))}
                      </span>
                    </div>
                  )}
                  {cards.length === 0 ? (
                    <p className="py-3 text-center text-[11px] text-tertiary">
                      {labels.emptyColumn}
                    </p>
                  ) : (
                    cards.map((card) => (
                      <LevierCard
                        key={card.action.id}
                        action={card.action}
                        chantier={card.chantier}
                        chantierColor={card.chantierColor}
                        onLevierClick={onLevierClick}
                      />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
