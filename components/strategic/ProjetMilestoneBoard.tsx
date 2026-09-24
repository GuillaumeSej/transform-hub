"use client";

import { TriangleAlert } from "lucide-react";
import { MilestoneTransitionBadge } from "@/components/strategic/MilestoneTransitionBadge";
import {
  currentMilestoneFillPct,
  displayMilestoneId,
  isProjetLate,
  milestoneProgressPct,
  milestoneTransitionState,
  progressBucket,
  type ProgressBucket,
  type ProjetAutoFlagsLookup,
  type ProjetProgressLookup,
} from "@/lib/axisLogic";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser, Chantier, ChantierAction, MilestoneId } from "@/types";

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
 * sans avoir à survoler chaque bulle), colorée/bordée par la nuance du chantier dérivée de la
 * couleur de son axe (`chantierShadesForAxis`, lib/axisLogic.ts) pour qu'un même chantier se
 * reconnaisse d'un coup d'œil entre les colonnes E0-E4 tout en restant visiblement rattaché à son
 * axe.
 *
 * Clic sur une bulle → même destination que l'ancienne matrice (`onProjetClick`, ouverture du
 * panneau du CHANTIER parent — un levier n'a pas de panneau propre).
 */

export type ProjetBoardCard = {
  action: ChantierAction;
  chantier: Chantier;
  /** Nuance hex du chantier dans son axe (`chantierShadesForAxis`, lib/axisLogic.ts) — appliquée
   *  en style inline (pastille + liséré gauche de la carte). */
  chantierColor: string;
};

export type ProjetBoardGroup = {
  /** Id de l'axe — clé React de la section. */
  key: string;
  /** Nom de l'axe — en-tête de section. */
  label: string;
  /** `StrategicAxis.color` — même convention d'accent que l'ancien widget "Répartition par axe". */
  color?: string;
  /** TOUS les leviers de l'axe (avec ou sans KPI rattaché, round 18), groupés par jalon courant
   *  (E0…E4). */
  milestones: Record<MilestoneId, ProjetBoardCard[]>;
  /** Chantiers de l'axe (round 10, point 1) — round 24 (Phase 4) : n'est plus rendu ICI (l'ancienne
   *  légende de couleur sous l'en-tête de section a été retirée, devenue redondante avec la
   *  section "Chantiers" dédiée que `StrategicAxesView.tsx` affiche désormais au-dessus de ce
   *  composant). Champ CONSERVÉ malgré tout : c'est cette même page qui continue de le peupler et
   *  de le lire pour construire sa propre section "Chantiers" — retirer le champ casserait ce seul
   *  appelant pour aucun bénéfice. */
  chantiers?: Chantier[];
};

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

/** Fond teinté + texte de la pastille "{pct}%" propre à CHAQUE carte de levier (round 19) — même
 *  convention que `BUCKET_PILL_CLASS` de `ChantierDetailPanel.tsx` (fond `-light` + texte de la
 *  couleur du bucket, `green` utilisant `text-rag-green-dark` pour le contraste, mêmes tokens
 *  `rag-*`), reprise ici plutôt que réimportée (fichier distinct, pas exportée là-bas). Distincte
 *  de `AVG_PROGRESS_DOT_CLASS` ci-dessus, qui reste la pastille discrète de la MOYENNE par colonne
 *  — celle-ci est le badge visible du pourcentage INDIVIDUEL d'une carte. */
const CARD_PROGRESS_PILL_CLASS: Record<ProgressBucket, string> = {
  empty: "bg-neutral-100 text-tertiary",
  red: "bg-rag-red-light text-rag-red",
  amber: "bg-rag-amber-light text-rag-amber",
  green: "bg-rag-green-light text-rag-green-dark",
};

/** Carte/bulle d'un levier, colorée par son chantier parent (round 18 : jusqu'ici réutilisée telle
 *  quelle par `LevierKanbanBoard.tsx`, supprimé — reste exportée pour un futur consommateur ayant le
 *  même besoin). */
export function ProjetCard({
  action,
  chantier,
  chantierColor,
  onProjetClick,
  clickable = true,
  users,
  progressOf,
  autoFlagsOf,
}: ProjetBoardCard & {
  onProjetClick: (chantierId: string, focusActionId?: string) => void;
  /** Round 25 (RBAC `chantier_contributor`) — le projet reste rendu (couleur, avancement, statut
   *  "en retard") mais devient inerte au clic quand `false`. Défaut `true` : comportement
   *  historique inchangé pour tout appelant qui ne le passe pas. */
  clickable?: boolean;
  /** Utilisateurs (nom affiché du demandeur d'un passage de jalon en attente). Optionnel : repli
   *  sur le username. */
  users?: Pick<AuthUser, "username" | "name">[];
  /** Avancement complet du projet (`useStrategicData().projetProgress`, items auto compris) —
   *  même chiffre que la fiche chantier. Omis = mode dégradé (items auto à 0). */
  progressOf?: ProjetProgressLookup;
  /** Items auto live du jalon courant (`useStrategicData().projetAutoFlags`) — permet l'état
   *  "prêt" de transition. Omis = seul l'état "en attente" est fiable. */
  autoFlagsOf?: ProjetAutoFlagsLookup;
}) {
  const { t } = useTranslation();
  // Round 19, point 3 : avancement PROPRE de ce levier (jalons pondérés `milestoneProgressPct`,
  // lib/axisLogic.ts) — MÊME chiffre que la fiche chantier quand l'appelant fournit `progressOf`
  // (items auto compris) ; sans lui, mode dégradé (items auto à 0, jamais une survalorisation).
  const progressPct = progressOf ? progressOf(action) : milestoneProgressPct(action);
  const progressPillClass = CARD_PROGRESS_PILL_CLASS[progressBucket(progressPct)];
  const displayedStage = displayMilestoneId(action.milestones?.currentMilestone ?? "E0");
  // Round 20, point 4 : la bande décorative du bas utilise désormais la MÊME valeur que la
  // pastille ci-dessus (`progressPct`, avec crédit partiel) — elle utilisait jusqu'ici
  // `milestoneWeightPct` (poids du jalon COURANT, sans crédit partiel), d'où la divergence remontée
  // par le PO ("la barre est presque pleine mais ça affiche 60%"). `milestoneWeightPct`/
  // `MILESTONE_WEIGHT` (lib/axisLogic.ts) n'ont plus d'autre appelant et ont été supprimés.
  // Round 20, point 3 : levier en retard (`isProjetLate`, lib/axisLogic.ts) — bordure/pastille
  // "En retard" (ton `rag-red`), volontairement DISTINCTE de la pastille rouge `CARD_PROGRESS_PILL_CLASS`
  // déjà utilisée pour un avancement 0-33% (deux signaux différents, jamais fusionnés).
  const late = isProjetLate(action, progressPct);
  // Round "passage de jalon explicite" : demande de passage en attente de confirmation du pilote
  // du chantier — pastille corail-rose (qui/quand en infobulle). Seul l'état "pending" est rendu
  // ici (pas "ready" : sans `autoFlags`, ce composant ne peut pas l'établir de façon fiable).
  const transition = milestoneTransitionState(action, autoFlagsOf?.(action));
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? () => onProjetClick(chantier.id, action.id) : undefined}
      title={`${action.name} · ${chantier.name} · ${displayedStage} · ${progressPct}%`}
      className={`group relative mb-1.5 flex w-full flex-col items-start gap-0.5 overflow-hidden rounded-md border border-l-4 border-border p-2 pb-2.5 text-left transition last:mb-0 focus:outline-none ${
        clickable
          ? "hover:-translate-y-px hover:shadow-sm focus:ring-2 focus:ring-black"
          : "opacity-60"
      } ${late ? "bg-rag-red-light/40 ring-2 ring-inset ring-rag-red" : "bg-white"}`}
      style={{ borderLeftColor: chantierColor }}
    >
      <span className="flex w-full flex-col gap-1">
        <span className="flex w-full items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: chantierColor }}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-primary">
            {action.name}
          </span>
          {/* Pourcentage d'avancement PROPRE à cette carte (round 19, point 3) — additif à la
              pastille de moyenne PAR COLONNE (`avgPct` plus bas), qui reste inchangée. */}
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${progressPillClass}`}
          >
            {progressPct}%
          </span>
        </span>
        {late && (
          <span
            className="flex w-fit shrink-0 items-center gap-0.5 rounded-full bg-rag-red px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
            title={t("strategicDashboard.projetBoard.late", "En retard")}
          >
            <TriangleAlert size={10} aria-hidden />
            {t("strategicDashboard.projetBoard.late", "En retard")}
          </span>
        )}
        {transition.status === "pending" && (
          <MilestoneTransitionBadge state={transition} users={users} compact />
        )}
      </span>
      <span className="w-full truncate pl-3.5 text-[10.5px] text-tertiary" title={chantier.name}>
        {chantier.name}
      </span>
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-[3px] rounded-r-full bg-black/50 transition-[width]"
        style={{ width: `${progressPct}%` }}
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
export function ProjetMilestoneBoard({
  groups,
  labels,
  onProjetClick,
  clickableActionIds = "all",
  users,
  progressOf,
  autoFlagsOf,
}: {
  groups: ProjetBoardGroup[];
  /** `emptyColumn` : placeholder discret d'une colonne de jalon sans levier — un texte plutôt que
   *  rien du tout, pour que la structure à 5 colonnes reste lisible même axe par axe. */
  labels: { emptyColumn: string };
  onProjetClick: (chantierId: string, focusActionId?: string) => void;
  /** Round 25 (RBAC `chantier_contributor`) — voir `StrategicData.clickableActionIds`,
   *  lib/hooks/useStrategicData.ts. Défaut `"all"` (comportement historique inchangé). */
  clickableActionIds?: Set<string> | "all";
  /** Nom affiché du demandeur d'un passage de jalon en attente (voir `ProjetCard.users`). */
  users?: Pick<AuthUser, "username" | "name">[];
  /** Voir `ProjetCard.progressOf`. */
  progressOf?: ProjetProgressLookup;
  /** Voir `ProjetCard.autoFlagsOf` — sert aussi à la moyenne de remplissage par colonne. */
  autoFlagsOf?: ProjetAutoFlagsLookup;
}) {
  const { t } = useTranslation();
  const isActionClickable = (actionId: string) =>
    clickableActionIds === "all" || clickableActionIds.has(actionId);
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
          <div className="grid grid-cols-1 gap-2 min-[640px]:grid-cols-5">
            {MILESTONE_ORDER.map((milestoneId) => {
              const cards = group.milestones[milestoneId] ?? [];
              // Round 12 : moyenne des `progressPct` déclarés du jalon COURANT, affichée à côté du
              // compte de leviers — `currentMilestoneFillPct` (même liste que la porte de
              // validation, items auto live si `autoFlagsOf` est fourni). Round 14 : une
              // pastille `progressBucket(avgPct)` accompagne ce texte (même convention que
              // `MilestoneChecklistPanel.tsx`) — seulement rendue quand `avgPct` est défini, donc
              // jamais pour une colonne vide (voir juste au-dessus, `cards.length > 0`).
              const avgPct =
                cards.length > 0
                  ? Math.round(
                      cards.reduce(
                        (sum, card) =>
                          sum + currentMilestoneFillPct(card.action, autoFlagsOf?.(card.action)),
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
                      {displayMilestoneId(milestoneId)}
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
                          "strategicDashboard.projetBoard.avgProgress",
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
                      <ProjetCard
                        key={card.action.id}
                        action={card.action}
                        chantier={card.chantier}
                        chantierColor={card.chantierColor}
                        onProjetClick={onProjetClick}
                        clickable={isActionClickable(card.action.id)}
                        users={users}
                        progressOf={progressOf}
                        autoFlagsOf={autoFlagsOf}
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
