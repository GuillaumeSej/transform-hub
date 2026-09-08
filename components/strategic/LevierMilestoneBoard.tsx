"use client";

import { colorForChantier, milestoneWeightPct } from "@/lib/axisLogic";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import type { Chantier, ChantierAction, MilestoneId } from "@/types";

/**
 * Vue E0→E4 par axe — widget dashboard "chantier-health" (round 8, remplace `ChantierHealthMatrix`,
 * qui affichait un état de santé à 3 niveaux PAR CHANTIER). Le grain de lecture passe du chantier au
 * LEVIER : chaque section d'axe montre 5 colonnes (jalons E0…E4), chaque levier RATTACHÉ À UN KPI
 * (`ChantierAction.indicatorId` défini) apparaissant en bulle dans la colonne de son
 * `milestones.currentMilestone` courant. Les leviers SANS KPI ne figurent jamais ici — voir
 * `LevierKanbanBoard.tsx`, rendu séparément par l'appelant juste en dessous de chaque section d'axe.
 *
 * La bulle affiche le nom du levier ET le nom de son CHANTIER PARENT en texte visible (jamais
 * seulement en infobulle — demande PO explicite : on doit voir de quel chantier relève un levier
 * sans avoir à survoler chaque bulle), colorée/bordée par `colorForChantier(chantier.id)`
 * (lib/axisLogic.ts, round 8) pour qu'un même chantier se reconnaisse d'un coup d'œil entre les
 * colonnes E0-E4 ET la ligne kanban classique en dessous.
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
  /** Leviers RATTACHÉS À UN KPI de l'axe, groupés par jalon courant (E0…E4). */
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
 *  l'exécution n'y apparaît jamais et ne serait donc jamais générée. Exporté pour que
 *  `LevierKanbanBoard.tsx` (même palette, même besoin) réutilise la même table plutôt que d'en
 *  dupliquer une copie qui pourrait diverger si la palette d'axisLogic.ts change un jour. */
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

/** Carte/bulle d'un levier, colorée par son chantier parent — réutilisée telle quelle par
 *  `LevierKanbanBoard.tsx` (même langage visuel entre la vue E0-E4 et le kanban classique). */
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
                <span
                  key={chantier.id}
                  className="flex items-center gap-1.5 text-[10.5px] text-tertiary"
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${colorForChantier(chantier.id)}`}
                  />
                  <span className="max-w-[140px] truncate" title={chantier.name}>
                    {chantier.name}
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 min-[640px]:grid-cols-5">
            {MILESTONE_ORDER.map((milestoneId) => {
              const cards = group.milestones[milestoneId] ?? [];
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
