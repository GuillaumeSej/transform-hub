"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { AxisChantierProjetAccordion } from "@/components/strategic/AxisChantierProjetAccordion";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import {
  ProjetMilestoneBoard,
  type ProjetBoardCard,
  type ProjetBoardGroup,
} from "@/components/strategic/ProjetMilestoneBoard";
import { StrategicImportButton } from "@/components/strategic/StrategicImportButton";
import { hexToRgb, withAlpha } from "@/components/strategic/TimelineBars";
import { colorForChantier } from "@/lib/axisLogic";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { saveChantierAction } from "@/lib/firestore/chantierActions";
import { saveChantier } from "@/lib/firestore/chantiers";
import { saveIndicator } from "@/lib/firestore/indicators";
import { saveStrategicAxis } from "@/lib/firestore/strategicAxes";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import type { StrategicImportPreview } from "@/lib/strategicExcelImport";
import type { Chantier, MilestoneId } from "@/types";

/**
 * Page « Axes stratégiques » — portefeuille des axes du programme actif, servie sur la MÊME route
 * que la bibliothèque des leviers (`/levers`, voir le routeur `app/(app)/levers/page.tsx`) : c'est
 * l'équivalent stratégique de `LeversPagePerformance`, dont elle reprend la structure (import Excel,
 * création d'axe, panneau chantier).
 *
 * Round 17 (permutation) : cette page n'affiche plus les anciens onglets "Feuille de route"
 * (`ProgramRoadmap`, déplacé vers le dashboard exécutif stratégique, `StrategicDashboardView.tsx`,
 * qui en avait besoin comme vue globale programme) / "Cartes" (`AxisKanban`, désormais orphelin et
 * supprimé — ses fonctionnalités propres, donut budgétaire par chantier et drill-down par
 * compteur, sont délibérément abandonnées, décision PO). Cette page affiche désormais, à demeure et
 * sans bascule, le contenu qui vivait auparavant sur le dashboard sous le widget "chantier-health" :
 * la vue E0→E4 par levier (`ProjetMilestoneBoard`), une section par axe. Le grain "portefeuille
 * d'axes" de cette page (import, création, panneau chantier) reste inchangé — seul le corps de la
 * page change de contenu.
 *
 * Round 18 : le kanban classique des leviers sans KPI (`LevierKanbanBoard`) a été supprimé — le PO a
 * unifié tous les leviers sur le suivi E0→E4, avec ou sans KPI rattaché. `ProjetMilestoneBoard`
 * couvre désormais TOUS les leviers de l'axe.
 *
 * Le clic sur un chantier ouvre le panneau chantier (`ChantierDetailPanel`) SUR CETTE MÊME page via
 * `?chantier=<chantierId>` (et `&action=` si ciblé) — inchangé depuis les rounds précédents.
 *
 * Round 24 (Phase 4) : le corps de page se scinde en DEUX onglets locaux (`useState`, pas de
 * persistance — même langage visuel que `ChantierDetailPanel.tsx`, qui note lui-même avoir copié
 * ce patron d'onglets depuis une VERSION ANTÉRIEURE de cette page même : on le réadopte ici comme
 * le précédent voulu, pas comme une invention nouvelle) :
 *  - "Avancement" : même vue E0→E4 par axe qu'avant ce round, mais chaque axe gagne désormais son
 *    propre bloc délimité (accent de couleur + fond teinté, même langage visuel que
 *    `ProgramRoadmap.tsx`) et une section "Chantiers" dédiée (boutons cliquables), qui REMPLACE
 *    l'ancienne légende texte interne à `ProjetMilestoneBoard.tsx` (retirée de ce composant, voir
 *    son propre doc-comment).
 *  - "Vue par axe" : nouvel accordéon Axe → Chantier → Projet (`AxisChantierProjetAccordion.tsx`),
 *    tout replié par défaut — vue de navigation/drilldown, complémentaire à la vue "Avancement"
 *    groupée par jalon.
 */
const STRATEGIC_AXES_FALLBACK_COLOR = "#a99e9a";

export function StrategicAxesView() {
  const { user } = useRole();
  const { activeProgramId, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const data = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);
  const [newAxisOpen, setNewAxisOpen] = useState(false);

  // Round 24 (Phase 4, Partie 1) : bascule d'onglet locale, sans persistance — voir le doc-comment
  // de tête de ce fichier.
  const [activeTab, setActiveTab] = useState<"advancement" | "byAxis">("advancement");

  // Échelle de confidentialité de l'entreprise — pour le sélecteur du formulaire de création d'axe
  // (même pattern que `components/shared/LeverForm.tsx`, voir `AxisForm`).
  const [confidentialityLevels, setConfidentialityLevels] = useState<string[]>([]);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setConfidentialityLevels(company?.confidentialityLevels ?? []);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);

  // Chantiers regroupés par axe, dans l'ordre de `data.chantiers` (déjà trié par le hook) — alimente
  // la section fixe "État des lieux d'avancement des leviers" ci-dessous (`projetBoardGroups`).
  // Round 24 : un chantier appartient désormais potentiellement à PLUSIEURS axes (`axisIds`) — il
  // est poussé dans le bucket de CHACUN d'eux (pas seulement le premier), décision produit assumée
  // (visibilité complète par axe, voir `lib/axisLogic.ts`).
  const chantiersByAxis = useMemo(() => {
    const map = new Map<string, Chantier[]>();
    for (const chantier of data.chantiers) {
      for (const axisId of chantier.axisIds) {
        const list = map.get(axisId);
        if (list) list.push(chantier);
        else map.set(axisId, [chantier]);
      }
    }
    return map;
  }, [data.chantiers]);

  /** Numéro "Axe {n}" de chaque axe (round 24, Phase 4, Partie 2) — position 1-based dans
   *  `data.axes`, jamais retriée : même ordre que celui déjà utilisé pour tout le reste de cette
   *  page (import, création, `projetBoardGroups` ci-dessous). Aucun autre concept de numérotation
   *  d'axe "officielle" trouvé ailleurs dans l'app — un simple index + 1 sur cet ordre déjà établi
   *  est donc le choix le plus cohérent, réutilisé tel quel par `AxisChantierProjetAccordion.tsx`
   *  (qui reçoit `data.axes` dans le même ordre et numérote pareil, indépendamment de cette map). */
  const axisNumberById = useMemo(() => {
    const map = new Map<string, number>();
    data.axes.forEach((axis, index) => map.set(axis.id, index + 1));
    return map;
  }, [data.axes]);

  /** Groupes (un par axe) de la vue E0→E4 par levier — round 17 : porté depuis l'ancien widget
   *  dashboard "chantier-health" (`StrategicDashboardView.tsx`, `projetBoardGroups`), même calcul
   *  adapté à la forme de données de cette page (`chantiersByAxis` ci-dessus plutôt que
   *  `axisBreakdown`, qui n'existe pas ici). Alimente `ProjetMilestoneBoard`. Un axe sans aucun
   *  chantier n'ouvre pas de section vide. Round 18 : TOUS les leviers de l'axe (avec ou sans KPI
   *  rattaché) sont groupés par `action.milestones?.currentMilestone ?? "E0"` (5 colonnes) — l'ancien
   *  bucket séparé des leviers sans KPI (`withoutKpi`, consommé par le kanban classique supprimé) a
   *  disparu. Chaque entrée porte `chantierColor` (`colorForChantier`, lib/axisLogic.ts) pour que le
   *  même chantier affiche systématiquement la même couleur.
   */
  const projetBoardGroups = useMemo<ProjetBoardGroup[]>(
    () =>
      data.axes
        .map((axis) => ({ axis, chantiers: chantiersByAxis.get(axis.id) ?? [] }))
        .filter((row) => row.chantiers.length > 0)
        .map((row) => {
          const chantierById = new Map(row.chantiers.map((chantier) => [chantier.id, chantier]));

          const milestones = MILESTONE_ORDER.reduce(
            (acc, milestoneId) => ({ ...acc, [milestoneId]: [] as ProjetBoardCard[] }),
            {} as Record<MilestoneId, ProjetBoardCard[]>
          );

          for (const action of data.chantierActions) {
            const chantier = chantierById.get(action.chantierId);
            if (!chantier) continue; // Levier d'un chantier hors de cet axe.
            const card: ProjetBoardCard = {
              action,
              chantier,
              chantierColor: colorForChantier(chantier.id),
            };
            const milestoneId = action.milestones?.currentMilestone ?? "E0";
            milestones[milestoneId].push(card);
          }

          return {
            key: row.axis.id,
            label: row.axis.name,
            color: row.axis.color,
            milestones,
            chantiers: row.chantiers,
          };
        }),
    [data.axes, data.chantierActions, chantiersByAxis]
  );

  /** Placeholder d'une colonne de jalon E0-E4 sans levier — même clé i18n que l'ex-widget dashboard
   *  (`strategicDashboard.projetBoard.*`, propriété de `ProjetMilestoneBoard.tsx`, hors périmètre de
   *  ce lot — non renommée : ce vocabulaire appartient au COMPOSANT, pas à la page qui le monte). */
  const projetMilestoneLabels = {
    emptyColumn: t("strategicDashboard.projetBoard.emptyColumn"),
  };

  const emptyLine = (label: string) => (
    <p className="py-6 text-center text-xs text-tertiary">{label}</p>
  );

  const openAxis = (axisId: string) => router.push(`/levers/detail?id=${axisId}`);

  /** Panneau chantier (round 6, point 0 — remplace l'ancienne route `/levers/chantier?id=…`) : ouvre
   *  en posant `?chantier=<id>` (et `&action=<id>` si ciblé) sur CETTE MÊME page, `router.push` pour
   *  que l'ouverture reste dans l'historique (le bouton "retour" du navigateur referme le panneau). */
  const openChantierPanel = (chantierId: string, focusActionId?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("chantier", chantierId);
    if (focusActionId) params.set("action", focusActionId);
    else params.delete("action");
    // `{ scroll: false }` (round 20) : sans cette option, l'App Router remonte la page en haut à
    // chaque ouverture du panneau — même correctif que les filtres de la feuille de route (voir
    // le commentaire dans `KpiPageClient.tsx`).
    router.push(`/levers?${params.toString()}`, { scroll: false });
  };

  /** Clic sur UN livrable précis de l'accordéon "Vue par axe" (round <n>,
   *  `AxisChantierProjetAccordion.tsx`'s `onDeliverableClick`) — ouvre le panneau chantier
   *  EXACTEMENT comme `openChantierPanel(chantierId, actionId)` ci-dessus, plus l'état local qui
   *  fait apparaître directement la modale de CE livrable (`ChantierDetailPanel`'s
   *  `initialOpenDeliverable`, voir son propre doc-comment). */
  const openChantierPanelOnDeliverable = (
    chantierId: string,
    actionId: string,
    deliverableId: string
  ) => {
    setInitialOpenDeliverable({ actionId, deliverableId });
    openChantierPanel(chantierId, actionId);
  };

  /** Ferme le panneau chantier — `router.replace` (pas `push`) pour ne pas empiler une entrée
   *  d'historique par fermeture, cohérent avec `openChantierPanel` ci-dessus. */
  const closeChantierPanel = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("chantier");
    params.delete("action");
    const qs = params.toString();
    // Remis à zéro à la fermeture (round <n>) — voir le doc-comment de `initialOpenDeliverable` :
    // une réouverture ultérieure du MÊME chantier via `openChantierId` seul (pas depuis l'accordéon)
    // ne doit pas rouvrir à tort la modale de ce livrable.
    setInitialOpenDeliverable(undefined);
    // `{ scroll: false }` (round 20) : même raison que `openChantierPanel` ci-dessus.
    router.replace(qs ? `/levers?${qs}` : "/levers", { scroll: false });
  };

  const openChantierId = searchParams.get("chantier");
  const focusActionId = searchParams.get("action") ?? undefined;
  const openChantierEntity = openChantierId
    ? data.chantiers.find((c) => c.id === openChantierId)
    : undefined;

  /** Livrable ciblé à l'ouverture du panneau chantier (round <n>) — sourcé UNIQUEMENT par un clic
   *  sur une étiquette de livrable de l'accordéon "Vue par axe" (`AxisChantierProjetAccordion.tsx`,
   *  `onDeliverableClick` ci-dessous). Volontairement PAS dans l'URL (contrairement à
   *  `chantier`/`action` ci-dessus) : un livrable n'a pas d'existence adressable indépendante côté
   *  route de cette page (seul `ChantierAction` a droit à `?action=`), et cette cible n'a de sens
   *  qu'au moment précis du clic — un état local suffit, remis à zéro à chaque fermeture du panneau
   *  (`closeChantierPanel` ci-dessous) pour qu'une réouverture ultérieure du MÊME chantier via
   *  `openChantierId` seul ne rouvre pas à tort la modale de ce livrable. */
  const [initialOpenDeliverable, setInitialOpenDeliverable] = useState<
    { actionId: string; deliverableId: string } | undefined
  >(undefined);

  /**
   * Écrit les entités validées par `StrategicImportButton` (round 4, point 3) — la librairie
   * d'import (`lib/strategicExcelImport.ts`) reste pure et n'appelle jamais Firestore, c'est donc
   * ICI, dans l'appelant, qu'on boucle sur les `save*` déjà existants. Les ids sont déjà alloués
   * par l'importeur (voir doc-comment en tête de ce fichier) : un `Promise.all` global suffit,
   * l'ordre d'écriture n'a aucune incidence (Firestore n'impose aucune contrainte d'intégrité
   * référentielle). En cas d'erreur, l'exception remonte telle quelle à `StrategicImportButton`,
   * qui affiche déjà son propre toast d'échec — pas de gestion d'erreur dupliquée ici. Les
   * abonnements `onSnapshot` de `useStrategicData` reprennent la main automatiquement, sans état
   * local à rafraîchir.
   */
  const handleImport = async (toCreate: StrategicImportPreview["toCreate"]) => {
    await Promise.all([
      ...toCreate.axes.map((axis) => saveStrategicAxis(axis)),
      ...toCreate.chantiers.map((chantier) => saveChantier(chantier)),
      ...toCreate.actions.map((action) => saveChantierAction(action)),
      ...toCreate.indicators.map((indicator) => saveIndicator(indicator)),
    ]);
  };

  if (!programsLoading && !activeProgramId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        {t("strategicAxes.noProgram")}
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("strategicAxes.title")}
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {data.axes.length} {t("strategicAxes.count")} · {data.chantiers.length}{" "}
            {t("strategicAxes.chantiersCount")} · {data.indicators.length}{" "}
            {t("strategicAxes.indicatorsCount")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StrategicImportButton
            data={{
              axes: data.axes,
              chantiers: data.chantiers,
              actions: data.chantierActions,
              indicators: data.indicators,
            }}
            companyId={user?.companyId}
            programId={activeProgramId}
            maturityStages={stages}
            onImport={handleImport}
          />
          <Button variant="primary" onClick={() => setNewAxisOpen(true)}>
            <Plus size={13} /> {t("strategicAxes.newAxis")}
          </Button>
        </div>
      </div>

      <Modal
        open={newAxisOpen}
        onOpenChange={setNewAxisOpen}
        title={t("strategicAxes.newAxisModalTitle")}
        maxWidth="640px"
      >
        <AxisForm
          users={data.users}
          stages={stages}
          confidentialityLevels={confidentialityLevels}
          submitLabel={t("strategicAxes.createAxis")}
          onCancel={() => setNewAxisOpen(false)}
          onSubmit={async (values: AxisFormValues) => {
            const created = await data.createAxis(values);
            setNewAxisOpen(false);
            showToast(t("strategicAxes.axisCreated"), created.name, "success");
            openAxis(created.id);
          }}
        />
      </Modal>

      {data.loading ? (
        <div className="rounded-lg border border-border bg-white p-10 text-center text-sm text-tertiary">
          {t("strategicAxes.loading")}
        </div>
      ) : data.axes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
          <div className="text-sm font-semibold text-primary">{t("strategicAxes.empty")}</div>
          <div className="mt-1 text-[13px]">{t("strategicAxes.emptyHint")}</div>
        </div>
      ) : (
        // Round 24 (Phase 4, Partie 1) : bascule d'onglets — remplace le contenu fixe unique du
        // round 17. Même langage visuel que `ChantierDetailPanel.tsx` (voir son propre
        // doc-comment, qui note l'avoir initialement copié d'une version antérieure de CETTE
        // page — on le réadopte donc ici en toute cohérence).
        <div>
          <div className="mb-4 flex w-fit overflow-hidden rounded-md border border-border">
            {(
              [
                { id: "advancement", label: t("strategicAxes.tabs.advancement", "Avancement") },
                { id: "byAxis", label: t("strategicAxes.tabs.byAxis", "Vue par axe") },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  activeTab === tab.id ? "bg-black text-white" : "bg-white text-secondary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Onglet "Avancement" (round 24, Phase 4, Partie 2) — même vue E0→E4 par axe qu'avant
              ce round, mais chaque axe gagne désormais son propre bloc délimité (accent de couleur
              + fond teinté, même langage visuel que `ProgramRoadmap.tsx`) et une section
              "Chantiers" dédiée qui remplace l'ancienne légende interne à `ProjetMilestoneBoard`
              (retirée de ce composant). ─────────────────────────────────────────────────────── */}
          <div className={activeTab === "advancement" ? undefined : "hidden"}>
            {projetBoardGroups.length === 0 ? (
              <div className="rounded-lg border border-border bg-white p-6">
                {emptyLine(t("strategicAxes.axisNoChantier"))}
              </div>
            ) : (
              <div className="space-y-4">
                {projetBoardGroups.map((group) => {
                  const axisColor =
                    group.color && hexToRgb(group.color)
                      ? group.color
                      : STRATEGIC_AXES_FALLBACK_COLOR;
                  const axisNumber = axisNumberById.get(group.key);
                  return (
                    <div
                      key={group.key}
                      className="overflow-hidden rounded-lg border border-border"
                      style={{
                        borderLeft: `4px solid ${axisColor}`,
                        backgroundColor: withAlpha(axisColor, 0.05),
                      }}
                    >
                      <div className="border-b border-border-strong px-4 py-3">
                        <h3 className="truncate text-[13px] font-bold text-primary">
                          {t("strategicAxes.axisNumberPrefix", "Axe {n} : {name}")
                            .replace("{n}", String(axisNumber ?? ""))
                            .replace("{name}", group.label)}
                        </h3>
                      </div>
                      <div className="px-4 py-3.5">
                        {/* Section "Chantiers" dédiée (round 24, Phase 4, Partie 2) — boutons
                            cliquables (`Button`, même composant que le reste de cette page),
                            ouvrent le panneau chantier exactement comme l'ancienne légende texte
                            (`onProjetClick`/`openChantierPanel` sans `focusActionId`). */}
                        {group.chantiers && group.chantiers.length > 0 && (
                          <div className="mb-3.5">
                            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-tertiary">
                              {t("strategicAxes.chantiersLabel", "Chantiers")}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.chantiers.map((chantier) => (
                                <Button
                                  key={chantier.id}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openChantierPanel(chantier.id)}
                                  title={chantier.name}
                                >
                                  <span
                                    aria-hidden
                                    className={`h-2 w-2 shrink-0 rounded-full ${colorForChantier(chantier.id)}`}
                                  />
                                  {chantier.name}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Libellé d'avancement relocalisé (round 24, Phase 4, Partie 2) — ex-titre
                            de `CardHeader` de la section fixe, désormais un simple label discret
                            juste au-dessus du board E0→E4, même poids visuel que "Chantiers"
                            ci-dessus. */}
                        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-tertiary">
                          {t("strategicAxes.projetAdvancementTitle")}
                        </div>

                        <ProjetMilestoneBoard
                          groups={[group]}
                          labels={projetMilestoneLabels}
                          onProjetClick={openChantierPanel}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Onglet "Vue par axe" (round 24, Phase 4, Partie 3) — accordéon Axe → Chantier →
              Projet, tout replié par défaut. ────────────────────────────────────────────────── */}
          <div className={activeTab === "byAxis" ? undefined : "hidden"}>
            <AxisChantierProjetAccordion
              axes={data.axes}
              chantiers={data.chantiers}
              chantierActions={data.chantierActions}
              onProjetClick={openChantierPanel}
              onDeliverableClick={openChantierPanelOnDeliverable}
            />
          </div>
        </div>
      )}

      {/* ── Panneau chantier (round 6, point 0) — remplace l'ancienne route dédiée, monté dans un
          Modal plus large que les modales de formulaire (1100px) pour porter tout le détail chantier
          (jalons, RACI, effort, timeline…) sans rien couper. ────────────────────────────────── */}
      <Modal
        open={!!openChantierId}
        onOpenChange={(open) => {
          if (!open) closeChantierPanel();
        }}
        title={openChantierEntity?.name ?? t("strategicChantierDetail.title")}
        maxWidth="1100px"
      >
        {openChantierId && (
          <ChantierDetailPanel
            chantierId={openChantierId}
            focusActionId={focusActionId}
            initialOpenDeliverable={initialOpenDeliverable}
            onClose={closeChantierPanel}
          />
        )}
      </Modal>
    </div>
  );
}
