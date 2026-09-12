"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Modal } from "@/components/shared/Modal";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import {
  LevierMilestoneBoard,
  type LevierBoardCard,
  type LevierBoardGroup,
} from "@/components/strategic/LevierMilestoneBoard";
import { StrategicImportButton } from "@/components/strategic/StrategicImportButton";
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
 * la vue E0→E4 par levier (`LevierMilestoneBoard`), une section par axe. Le grain "portefeuille
 * d'axes" de cette page (import, création, panneau chantier) reste inchangé — seul le corps de la
 * page change de contenu.
 *
 * Round 18 : le kanban classique des leviers sans KPI (`LevierKanbanBoard`) a été supprimé — le PO a
 * unifié tous les leviers sur le suivi E0→E4, avec ou sans KPI rattaché. `LevierMilestoneBoard`
 * couvre désormais TOUS les leviers de l'axe.
 *
 * Le clic sur un chantier ouvre le panneau chantier (`ChantierDetailPanel`) SUR CETTE MÊME page via
 * `?chantier=<chantierId>` (et `&action=` si ciblé) — inchangé depuis les rounds précédents.
 */
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
  // la section fixe "État des lieux d'avancement des leviers" ci-dessous (`levierBoardGroups`).
  const chantiersByAxis = useMemo(() => {
    const map = new Map<string, Chantier[]>();
    for (const chantier of data.chantiers) {
      const list = map.get(chantier.axisId);
      if (list) list.push(chantier);
      else map.set(chantier.axisId, [chantier]);
    }
    return map;
  }, [data.chantiers]);

  /** Groupes (un par axe) de la vue E0→E4 par levier — round 17 : porté depuis l'ancien widget
   *  dashboard "chantier-health" (`StrategicDashboardView.tsx`, `levierBoardGroups`), même calcul
   *  adapté à la forme de données de cette page (`chantiersByAxis` ci-dessus plutôt que
   *  `axisBreakdown`, qui n'existe pas ici). Alimente `LevierMilestoneBoard`. Un axe sans aucun
   *  chantier n'ouvre pas de section vide. Round 18 : TOUS les leviers de l'axe (avec ou sans KPI
   *  rattaché) sont groupés par `action.milestones?.currentMilestone ?? "E0"` (5 colonnes) — l'ancien
   *  bucket séparé des leviers sans KPI (`withoutKpi`, consommé par le kanban classique supprimé) a
   *  disparu. Chaque entrée porte `chantierColor` (`colorForChantier`, lib/axisLogic.ts) pour que le
   *  même chantier affiche systématiquement la même couleur.
   */
  const levierBoardGroups = useMemo<LevierBoardGroup[]>(
    () =>
      data.axes
        .map((axis) => ({ axis, chantiers: chantiersByAxis.get(axis.id) ?? [] }))
        .filter((row) => row.chantiers.length > 0)
        .map((row) => {
          const chantierById = new Map(row.chantiers.map((chantier) => [chantier.id, chantier]));

          const milestones = MILESTONE_ORDER.reduce(
            (acc, milestoneId) => ({ ...acc, [milestoneId]: [] as LevierBoardCard[] }),
            {} as Record<MilestoneId, LevierBoardCard[]>
          );

          for (const action of data.chantierActions) {
            const chantier = chantierById.get(action.chantierId);
            if (!chantier) continue; // Levier d'un chantier hors de cet axe.
            const card: LevierBoardCard = {
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
   *  (`strategicDashboard.levierBoard.*`, propriété de `LevierMilestoneBoard.tsx`, hors périmètre de
   *  ce lot — non renommée : ce vocabulaire appartient au COMPOSANT, pas à la page qui le monte). */
  const levierMilestoneLabels = {
    emptyColumn: t("strategicDashboard.levierBoard.emptyColumn"),
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
    router.push(`/levers?${params.toString()}`);
  };

  /** Ferme le panneau chantier — `router.replace` (pas `push`) pour ne pas empiler une entrée
   *  d'historique par fermeture, cohérent avec `openChantierPanel` ci-dessus. */
  const closeChantierPanel = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("chantier");
    params.delete("action");
    const qs = params.toString();
    router.replace(qs ? `/levers?${qs}` : "/levers");
  };

  const openChantierId = searchParams.get("chantier");
  const focusActionId = searchParams.get("action") ?? undefined;
  const openChantierEntity = openChantierId
    ? data.chantiers.find((c) => c.id === openChantierId)
    : undefined;

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
        // Round 17 (permutation) : contenu fixe — remplace les anciens onglets "Feuille de route"/
        // "Cartes". Même rendu que l'ex-widget dashboard "chantier-health" (voir doc-comment de
        // `levierBoardGroups` ci-dessus).
        <Card className="mb-0">
          <CardHeader title={t("strategicAxes.levierAdvancementTitle")} />
          <CardBody>
            {levierBoardGroups.length === 0 ? (
              emptyLine(t("strategicAxes.axisNoChantier"))
            ) : (
              <div className="space-y-6">
                {levierBoardGroups.map((group) => (
                  <div key={group.key}>
                    <LevierMilestoneBoard
                      groups={[group]}
                      labels={levierMilestoneLabels}
                      onLevierClick={openChantierPanel}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
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
            onClose={closeChantierPanel}
          />
        )}
      </Modal>
    </div>
  );
}
