import type { MilestoneId } from "@/types";

/**
 * Source unique du CONTENU des check-lists de jalon E0→E4 (libellés, sections A/B/C, quels items
 * sont automatiques) — pendant stratégique de `lib/status-config.ts` : une config statique, pure
 * donnée, aucune logique ni accès Firestore. Seules les RÉPONSES (feux, plans d'action) sont
 * persistées par chantier (`Chantier.milestones`, voir `types/index.ts`) ; le contenu lui-même vit
 * ici pour éviter un document Firestore énorme et permettre d'ajuster un libellé plus tard sans
 * migration de données.
 *
 * SIMPLIFIÉ par rapport à la note de méthode PMO complète du PO (autorisation explicite) : chaque
 * jalon est réduit à 3-6 items au lieu de reproduire chaque sous-bullet du document. Les libellés
 * eux-mêmes sont dans les dictionnaires i18n (`strategicChantierDetail.milestones.item.*`), jamais
 * ici — `i18nKey` ne fait que pointer vers la bonne clé.
 */

/** Un item `auto` est CALCULÉ (voir `resolveMilestoneAutoFlags` dans `lib/axisLogic.ts`) plutôt que
 *  répondu à la main sur la fiche chantier :
 *  - `previousOranges` : vert si tous les items orange du jalon PRÉCÉDENT sont `resolved`
 *    (vacuously vrai s'il n'y en a aucun) — opérationnalise la règle "le jalon suivant ne s'ouvre
 *    pas tant que les oranges du jalon d'avant ne sont pas soldés". N'apparaît jamais sur E0 (pas
 *    de jalon précédent).
 *  - `dependencyAlert` : vert sauf si `chantierDependencyAlerts()` (round 4) signale ce chantier
 *    comme le côté BLOQUÉ (`sourceId`) d'une dépendance inter-chantiers violée — opérationnalise
 *    "ce chantier ne démarre pas si ses prérequis ne sont pas satisfaits". N'apparaît que sur E0.
 *  - `effortComplete` : vert si les 4 dimensions de `Chantier.effort` sont toutes renseignées —
 *    c'est ce qui rend la grille d'effort (round 4, déjà construite) de facto obligatoire.
 */
export type ChecklistItemDef = {
  /** Identifiant stable référencé par `MilestoneChecklistItem.itemId` (ex. "E0-A1"). */
  itemId: string;
  section: "A" | "B" | "C";
  /** Clé i18n du libellé COURT de l'item (`strategicChantierDetail.milestones.item.<ID>`, `<ID>`
   *  reprenant `itemId` avec des underscores — les tirets de `itemId` ne posent pas de problème en
   *  soi, underscore est juste la convention retenue pour ce segment de clé). */
  i18nKey: string;
  auto?: "previousOranges" | "dependencyAlert" | "effortComplete";
};

/** Ordre de passage des 5 jalons — sert à `resolveMilestoneAutoFlags` (jalon précédent) et à
 *  `milestoneProgressPct` (implicitement, via `passedMilestones`). */
export const MILESTONE_ORDER: MilestoneId[] = ["E0", "E1", "E2", "E3", "E4"];

export const MILESTONE_CHECKLISTS: Record<MilestoneId, ChecklistItemDef[]> = {
  // E0 — Opportunité : le chantier a-t-il le droit de démarrer ?
  E0: [
    {
      itemId: "E0-A1",
      section: "A",
      i18nKey: "strategicChantierDetail.milestones.item.E0_A1",
      auto: "dependencyAlert",
    },
    { itemId: "E0-A2", section: "A", i18nKey: "strategicChantierDetail.milestones.item.E0_A2" },
    { itemId: "E0-B1", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E0_B1" },
    { itemId: "E0-B2", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E0_B2" },
    { itemId: "E0-C1", section: "C", i18nKey: "strategicChantierDetail.milestones.item.E0_C1" },
  ],
  // E1 — Mobilisation : options comparées, effort noté, plan d'étude validé.
  E1: [
    {
      itemId: "E1-A1",
      section: "A",
      i18nKey: "strategicChantierDetail.milestones.item.E1_A1",
      auto: "previousOranges",
    },
    { itemId: "E1-B1", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E1_B1" },
    { itemId: "E1-B2", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E1_B2" },
    { itemId: "E1-B3", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E1_B3" },
    {
      itemId: "E1-C-effort",
      section: "C",
      i18nKey: "strategicChantierDetail.milestones.item.E1_C_effort",
      auto: "effortComplete",
    },
    { itemId: "E1-C2", section: "C", i18nKey: "strategicChantierDetail.milestones.item.E1_C2" },
  ],
  // E2 — Conception (point de non-retour) : solution validée, ressources attribuées.
  E2: [
    {
      itemId: "E2-A1",
      section: "A",
      i18nKey: "strategicChantierDetail.milestones.item.E2_A1",
      auto: "previousOranges",
    },
    { itemId: "E2-B1", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E2_B1" },
    { itemId: "E2-B2", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E2_B2" },
    { itemId: "E2-B3", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E2_B3" },
  ],
  // E3 — Clôture : résultats livrés, transfert opérationnel, date de bouclage fixée.
  E3: [
    {
      itemId: "E3-A1",
      section: "A",
      i18nKey: "strategicChantierDetail.milestones.item.E3_A1",
      auto: "previousOranges",
    },
    { itemId: "E3-B1", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E3_B1" },
    { itemId: "E3-B2", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E3_B2" },
    { itemId: "E3-B3", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E3_B3" },
  ],
  // E4 — Bouclage sur les enjeux : le chantier a-t-il vraiment produit l'effet recherché ?
  E4: [
    {
      itemId: "E4-A1",
      section: "A",
      i18nKey: "strategicChantierDetail.milestones.item.E4_A1",
      auto: "previousOranges",
    },
    { itemId: "E4-B1", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E4_B1" },
    { itemId: "E4-B2", section: "B", i18nKey: "strategicChantierDetail.milestones.item.E4_B2" },
  ],
};
