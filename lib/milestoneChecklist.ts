import type { MilestoneId } from "@/types";

/**
 * Source unique du CONTENU des check-lists de jalon E0→E4 (libellés, quels items sont
 * automatiques) — pendant stratégique de `lib/status-config.ts` : une config statique, pure
 * donnée, aucune logique ni accès Firestore. Seules les RÉPONSES (progression, plans d'action) sont
 * persistées ; le contenu lui-même vit ici pour éviter un document Firestore énorme et permettre
 * d'ajuster un libellé plus tard sans migration de données.
 *
 * Round 7 : les réponses sont désormais consommées au niveau du LEVIER (`ChantierAction.milestones`,
 * voir `types/index.ts`) plutôt que du chantier — un chantier regroupe plusieurs leviers, chacun
 * avec son propre avancement E0→E4. `Chantier.milestones` reste dans le type (`@deprecated`) pour
 * les documents Firestore existants mais n'est plus lu. Le CONTENU des check-lists ci-dessous
 * (items, feux automatiques) est agnostique du porteur et reste byte-for-byte identique.
 * SIMPLIFIÉ par rapport à la note de méthode PMO complète du PO (autorisation explicite) : chaque
 * jalon est réduit à 3-6 items au lieu de reproduire chaque sous-bullet du document. Les libellés
 * eux-mêmes sont dans les dictionnaires i18n (`strategicChantierDetail.milestones.item.*`), jamais
 * ici — `i18nKey` ne fait que pointer vers la bonne clé.
 *
 * Round 26 : chaque jalon est désormais une liste PLATE et NON GROUPÉE d'actions — l'ancien
 * regroupement en 3 sections lettrées A ("préalable", presque toujours un item `auto`)/B
 * ("réalisation", les vraies actions manuelles)/C ("conclusion", seulement sur E0/E1) a été retiré
 * (voir `components/strategic/MilestoneChecklistPanel.tsx`, qui ne rend plus de sous-groupes). Le
 * verrou "oranges du jalon précédent soldés" (`auto: "previousOranges"`, un item de section A sur
 * chaque jalon après E0) a été supprimé avec les 4 entrées qui le portaient (E1-A1/E2-A1/E3-A1/
 * E4-A1) : `canPassMilestone` (lib/axisLogic.ts) exige désormais que TOUS les items du jalon COURANT
 * soient à 100 pour passer au suivant, ce qui rend ce verrou logiquement superflu (plus aucun item
 * partiel ne peut jamais rester "en attente" d'un jalon déjà validé). `dependencyAlert` (E0) et
 * `effortComplete` (E1) sont conservés tels quels : ce sont de vraies conditions métier, sans lien
 * avec le report d'un jalon à l'autre. Les `itemId` existants (ex. "E0-A1", "E1-C-effort") sont
 * gardés inchangés : ce sont de simples identifiants opaques référencés par les documents Firestore
 * déjà seedés, leur segment "A"/"B"/"C" n'a plus de signification depuis ce round.
 */

/** Un item `auto` est CALCULÉ (voir `resolveMilestoneAutoFlags` dans `lib/axisLogic.ts`) plutôt que
 *  répondu à la main sur la fiche chantier :
 *  - `dependencyAlert` : vert sauf si `chantierDependencyAlerts()` (round 4) signale ce chantier
 *    comme le côté BLOQUÉ (`sourceId`) d'une dépendance inter-chantiers violée — opérationnalise
 *    "ce chantier ne démarre pas si ses prérequis ne sont pas satisfaits". N'apparaît que sur E0.
 *  - `effortComplete` : vert si les 4 dimensions de `Chantier.effort` sont toutes renseignées —
 *    c'est ce qui rend la grille d'effort (round 4, déjà construite) de facto obligatoire.
 */
export type ChecklistItemDef = {
  /** Identifiant stable référencé par `MilestoneChecklistItem.itemId` (ex. "E0-A1") — opaque
   *  depuis round 26 (voir le commentaire de tête), ne code plus de section. */
  itemId: string;
  /** Clé i18n du libellé COURT de l'item (`strategicChantierDetail.milestones.item.<ID>`, `<ID>`
   *  reprenant `itemId` avec des underscores — les tirets de `itemId` ne posent pas de problème en
   *  soi, underscore est juste la convention retenue pour ce segment de clé). */
  i18nKey: string;
  auto?: "dependencyAlert" | "effortComplete";
};

/** Ordre de passage des 5 jalons — sert à `resolveMilestoneAutoFlags` (jalon précédent) et à
 *  `milestoneProgressPct` (implicitement, via `passedMilestones`). */
export const MILESTONE_ORDER: MilestoneId[] = ["E0", "E1", "E2", "E3", "E4"];

export const MILESTONE_CHECKLISTS: Record<MilestoneId, ChecklistItemDef[]> = {
  // E0 — Opportunité : le chantier a-t-il le droit de démarrer ?
  E0: [
    {
      itemId: "E0-A1",
      i18nKey: "strategicChantierDetail.milestones.item.E0_A1",
      auto: "dependencyAlert",
    },
    { itemId: "E0-A2", i18nKey: "strategicChantierDetail.milestones.item.E0_A2" },
    { itemId: "E0-B1", i18nKey: "strategicChantierDetail.milestones.item.E0_B1" },
    { itemId: "E0-B2", i18nKey: "strategicChantierDetail.milestones.item.E0_B2" },
    { itemId: "E0-C1", i18nKey: "strategicChantierDetail.milestones.item.E0_C1" },
  ],
  // E1 — Mobilisation : options comparées, effort noté, plan d'étude validé.
  E1: [
    { itemId: "E1-B1", i18nKey: "strategicChantierDetail.milestones.item.E1_B1" },
    { itemId: "E1-B2", i18nKey: "strategicChantierDetail.milestones.item.E1_B2" },
    { itemId: "E1-B3", i18nKey: "strategicChantierDetail.milestones.item.E1_B3" },
    {
      itemId: "E1-C-effort",
      i18nKey: "strategicChantierDetail.milestones.item.E1_C_effort",
      auto: "effortComplete",
    },
    { itemId: "E1-C2", i18nKey: "strategicChantierDetail.milestones.item.E1_C2" },
  ],
  // E2 — Conception (point de non-retour) : solution validée, ressources attribuées.
  E2: [
    { itemId: "E2-B1", i18nKey: "strategicChantierDetail.milestones.item.E2_B1" },
    { itemId: "E2-B2", i18nKey: "strategicChantierDetail.milestones.item.E2_B2" },
    { itemId: "E2-B3", i18nKey: "strategicChantierDetail.milestones.item.E2_B3" },
  ],
  // E3 — Clôture : résultats livrés, transfert opérationnel, date de bouclage fixée.
  E3: [
    { itemId: "E3-B1", i18nKey: "strategicChantierDetail.milestones.item.E3_B1" },
    { itemId: "E3-B2", i18nKey: "strategicChantierDetail.milestones.item.E3_B2" },
    { itemId: "E3-B3", i18nKey: "strategicChantierDetail.milestones.item.E3_B3" },
  ],
  // E4 — Bouclage sur les enjeux : le chantier a-t-il vraiment produit l'effet recherché ?
  E4: [
    { itemId: "E4-B1", i18nKey: "strategicChantierDetail.milestones.item.E4_B1" },
    { itemId: "E4-B2", i18nKey: "strategicChantierDetail.milestones.item.E4_B2" },
  ],
};
