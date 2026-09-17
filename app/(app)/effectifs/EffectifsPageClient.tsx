"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import {
  BudgetDonutChart,
  type BudgetDonutSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { KPICard } from "@/components/shared/KPICard";
import { Modal } from "@/components/shared/Modal";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { StaffingImportButton } from "@/components/strategic/StaffingImportButton";
import { StaffingPeriodBreakdown } from "@/components/strategic/StaffingPeriodBreakdown";
import { colorForDepartment } from "@/lib/axisLogic";
import { saveChantierStaffing } from "@/lib/firestore/chantierStaffing";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing } from "@/types";

/**
 * Page « Effectifs mobilisés » — lecture transverse du staffing saisi chantier par chantier
 * (`ChantierStaffingEditor`, dans la pop-up de détail d'un chantier), ou importé en lot via
 * `StaffingImportButton` (round 7). Trois niveaux de lecture, dans l'ordre demandé par le PO :
 *
 *  0. BESOIN vs DISPONIBLE (round 13, nouveau) : pour chaque équipe (= `Employee.department` de la
 *     base ETP entreprise, Plan Performance), le volume d'ETP demandé par le Plan Stratégique
 *     (`ChantierStaffing.fte`, sommé) comparé au volume RÉELLEMENT disponible dans cette équipe
 *     (`Employee.fte`, sommé — `useCompanyDepartments`, live). Remplace l'ancienne section
 *     « Budget d'ETP par fonction », où le "disponible" était un chiffre saisi à la main
 *     (`Program.staffingBudgets`, retiré) plutôt que la réalité de la base ETP.
 *  1. PAR PÉRIODE ET PAR AXE (`StaffingPeriodBreakdown`, round 7, fusionné round 22) : combien
 *     d'ETP le programme mobilise-t-il, trimestre/semestre/année par trimestre/semestre/année, et
 *     par équipe OU par axe (toggle "Période"/"Axe" interne au composant) dans chaque période.
 *     Round 22 (PO : le second graphique historique « Répartition par axe », sans dimension
 *     temporelle, ne réagissait jamais au toggle de granularité seul) — les deux anciennes cartes
 *     séparées ("par période" et "par axe") sont désormais UNE seule carte, l'abscisse restant
 *     TOUJOURS la période dans les deux modes. Toute la logique de cross-filtering (équipe/chantier
 *     sélectionnés, période épinglée, granularité) est désormais interne à ce composant — cette
 *     page ne lève plus cet état, voir le doc-comment de `StaffingPeriodBreakdown.tsx`.
 *
 * Aucune écriture MANUELLE ici : la saisie ligne par ligne vit exclusivement dans la fiche
 * chantier, pour ne pas avoir deux flux de saisie divergents sur la même donnée (même parti pris
 * que la page KPI vs la fiche axe). Seule exception, round 7 : le bouton d'import Excel
 * (`StaffingImportButton`) délègue l'écriture EN LOT à `saveChantierStaffing` — après aperçu et
 * confirmation explicite, jamais en silence (voir `lib/staffingExcelImport.ts`).
 *
 * Round 13 : la liste des équipes n'est plus une union fermée à 9 valeurs codée en dur
 * (`StaffingFunction`, retirée de `types/index.ts`) mais dérivée EN LIVE de la base ETP entreprise
 * (`useCompanyDepartments`) — voir le lien « Voir la base ETP » dans l'en-tête, qui pointe vers
 * `/hr/etp` (module RH/Plan Performance, désormais accessible aussi depuis le Plan Stratégique,
 * voir `lib/nav-config.ts`). Une entreprise sans base ETP encore saisie voit cette page vide de
 * toute équipe, avec un message explicite plutôt qu'un référentiel arbitraire.
 *
 * Barres : pur CSS/Tailwind (largeur en %), comme les barres de `KPICard` — pas de dépendance
 * graphique pour une répartition à une dimension. Chaque barre porte la couleur PROPRE à son
 * équipe (`colorForDepartment`, lib/axisLogic.ts — même hash déterministe que `colorForChantier`)
 * plutôt qu'une couleur unique — la sélection reste signalée par le halo `ring-*` autour de la
 * piste (voir `Bar` ci-dessous), pas par un changement de couleur qui effacerait l'identité de
 * l'équipe.
 *
 * Rien à voir avec les écrans RH du Plan Performance eux-mêmes : `Chantier`/`ChantierStaffing`
 * n'existent que côté stratégique, et la route est fermée aux programmes Performance (voir la
 * garde `programType` en bas de fichier + `programTypes: ["strategic"]` dans `lib/nav-config.ts`).
 * Seule la base ETP (`Employee`, via `useCompanyDepartments`) est PARTAGÉE entre les deux plans.
 */

/** Somme des ETP par équipe sur un lot de lignes, restreinte aux équipes réellement mobilisées et
 *  triée par volume décroissant (le classement EST l'information : on lit d'abord l'équipe la plus
 *  sollicitée). */
function totalsByFunction(entries: ChantierStaffing[]): { fn: string; fte: number }[] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(entry.function, (map.get(entry.function) ?? 0) + (entry.fte || 0));
  }
  return Array.from(map.entries())
    .map(([fn, fte]) => ({ fn, fte }))
    .sort((a, b) => b.fte - a.fte);
}

/** Barre horizontale simple — `pct` déjà borné par l'appelant. `fn` détermine la couleur de
 *  remplissage (identité de l'équipe, toujours visible) ; `highlighted` ajoute un halo corail
 *  autour de la piste plutôt que de remplacer la couleur — deux signaux indépendants (équipe vs
 *  sélection) qui ne se marchent pas dessus. */
function Bar({ pct, fn, highlighted = false }: { pct: number; fn: string; highlighted?: boolean }) {
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-neutral-200 ${
        highlighted ? "ring-2 ring-bp-coral ring-offset-1" : ""
      }`}
    >
      <div
        className={`h-full rounded-full transition-all ${colorForDepartment(fn)}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

export function EffectifsPageClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, loading: roleLoading } = useRole();
  const {
    activeProgram,
    activeProgramId,
    programType,
    loading: programLoading,
  } = useActiveProgram();
  const {
    axes,
    chantiers,
    chantierActions,
    staffing,
    strategicRole,
    loading: dataLoading,
  } = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const { fteByDept, loading: departmentsLoading } = useCompanyDepartments(user?.companyId ?? null);

  /** Axe dont le drill-down budgétaire PAR CHANTIER (round 13) est actuellement ouvert — `null` =
   *  modale fermée. Le donut « Répartition par axe » de la section budget financier s'arrêtait au
   *  niveau de l'axe (round 12), jugé "trop grossier" par le PO : cliquer une part ouvre désormais
   *  un second donut, un slice par chantier de cet axe. */
  const [budgetDrilldownAxisId, setBudgetDrilldownAxisId] = useState<string | null>(null);

  /** Round 25 (RBAC) : pour `axis_sponsor`, `axes` ne contient déjà plus que SON/SES propre(s)
   *  axe(s) (scoping du hook) — le donut « Répartition par axe » de `moneyBudgetSection` n'a donc
   *  plus rien d'informatif à montrer EN PREMIER pour ce rôle (une seule part à 100%, ou quelques
   *  parts qui lui appartiennent toutes déjà). Plutôt que de le faire cliquer sur sa propre part
   *  pour atteindre le drill-down « Répartition par chantier » — mécanisme déjà construit pour les
   *  autres rôles, voir `budgetDrilldownModal` plus bas —, on ouvre directement ce drill-down sur
   *  son premier axe dès que la liste (scopée) est connue. Le garde `budgetDrilldownAxisId === null`
   *  ne redéclenche jamais l'ouverture après une fermeture manuelle (l'utilisateur peut refermer la
   *  modale et rester sur la page). */
  useEffect(() => {
    if (strategicRole === "axis_sponsor" && axes.length > 0 && budgetDrilldownAxisId === null) {
      setBudgetDrilldownAxisId(axes[0].id);
    }
  }, [strategicRole, axes, budgetDrilldownAxisId]);

  const globalTotals = useMemo(() => totalsByFunction(staffing), [staffing]);
  const totalFte = useMemo(() => staffing.reduce((sum, e) => sum + (e.fte || 0), 0), [staffing]);

  /** Besoin (staffing déclaré) vs disponible (base ETP réelle) par équipe — round 13, remplace la
   *  section « Budget d'ETP par fonction ». Une équipe apparaît dès qu'elle a du besoin OU du
   *  disponible (une équipe entièrement dispo mais jamais staffée reste visible : c'est une
   *  information utile — "cette équipe n'est staffée sur aucun chantier du plan"). Triée par
   *  besoin décroissant. */
  const needVsAvailable = useMemo(() => {
    const names = new Set<string>([
      ...globalTotals.map((row) => row.fn),
      ...Object.keys(fteByDept),
    ]);
    return Array.from(names)
      .map((fn) => ({
        fn,
        needed: globalTotals.find((row) => row.fn === fn)?.fte ?? 0,
        available: fteByDept[fn] ?? 0,
      }))
      .sort((a, b) => b.needed - a.needed);
  }, [globalTotals, fteByDept]);

  /** Segments colorés (un par équipe mobilisée) pour la barre de la tuile « Total ETP » — même
   *  couleur par équipe que partout ailleurs sur cette page (`colorForDepartment`). */
  const totalFteBarSegments = useMemo(
    () =>
      globalTotals.map(({ fn, fte }) => ({
        pct: totalFte > 0 ? (fte / totalFte) * 100 : 0,
        className: colorForDepartment(fn),
      })),
    [globalTotals, totalFte]
  );

  const chantierNames = useMemo(() => new Map(chantiers.map((c) => [c.id, c.name])), [chantiers]);

  /** Même lookup que `chantierNames` ci-dessus, en `Record` plutôt qu'en `Map` — round 20, point 3 :
   *  `StaffingPeriodBreakdown` (composant partagé, pas de dépendance à cette page) attend une map
   *  de noms sous cette forme pour son détail par chantier au survol d'une équipe. */
  const chantierNamesById = useMemo(() => Object.fromEntries(chantierNames), [chantierNames]);

  /** `Chantier.id` → `Chantier.axisIds` — round 24 : remplace l'ancien `ChantierStaffing.axisId`
   *  dénormalisé (supprimé) pour le mode "axis" de `StaffingPeriodBreakdown`, qui rejoint désormais
   *  chaque ligne de staffing à l'axe (ou aux axes) de son chantier via cette map plutôt que de lire
   *  un axe stocké directement sur la ligne. */
  const axisIdsByChantier = useMemo(
    () => Object.fromEntries(chantiers.map((c) => [c.id, c.axisIds])),
    [chantiers]
  );

  // ── Budget FINANCIER alloué (round 12) ─────────────────────────────────────────────────────
  // Nouvelle section monétaire, distincte du besoin/disponible ETP ci-dessus (une question de €,
  // pas d'ETP) : total du budget alloué (`Chantier.allocatedBudget`, round 7) sur tout le
  // programme, même calcul que la puce du dashboard stratégique (`StrategicDashboardView`).
  // Round 16 : la ventilation PAR AXE (ex-`allocatedBudgetByAxis`) est désormais construite plus
  // bas, fusionnée avec le consommé — voir `unifiedBudgetSlices`.
  const totalAllocatedBudget = useMemo(
    () => chantiers.reduce((sum, c) => sum + (c.allocatedBudget ?? 0), 0),
    [chantiers]
  );

  // ── Budget FINANCIER consommé (round 15, fusionné round 16) ────────────────────────────────
  // Le total consommé programme n'est plus recalculé séparément ici : depuis round 16, `data[].consumed`
  // par axe (`budgetByAxisWithConsumed` ci-dessous, réinjecté dans `unifiedBudgetSlices`) alimente
  // directement l'anneau "consommé" du donut unifié, qui somme lui-même son propre total affiché au
  // centre — plus besoin d'un `totalConsumedBudget` séparé au niveau de cette page.
  //
  // PAS d'équivalent ETP (`Chantier.consumedFte`) ajouté sur cette page : le seul total ETP déjà
  // affiché ici (`totalFte`, tuile "ETP mobilisés au total") somme le BESOIN déclaré par équipe
  // (`ChantierStaffing.fte`), pas un objectif d'ETP par chantier — `Chantier.consumedFte` est
  // explicitement documenté (`types/index.ts`) comme une valeur globale déclarative DISTINCTE de ce
  // besoin, sans compteur "planifié" comparable sur `Chantier`. Les comparer produirait un
  // rapprochement trompeur (deux notions différentes), donc volontairement omis ici.

  /** Alloué ET consommé, par axe — même découpage (`axes.map` + filtre par `axisIds`) que
   *  l'ex-`allocatedBudgetByAxis` (round 12, retiré round 16), mais regroupés ensemble : round 12
   *  s'en servait pour une `BudgetVsActualBar` par axe séparée, round 16 le réutilise directement
   *  ci-dessous pour alimenter l'anneau "consommé" du donut unifié.
   *
   *  Round 24 : un chantier peut désormais appartenir à PLUSIEURS axes — décision produit assumée
   *  (visibilité complète par axe) : son `allocatedBudget`/`consumedBudget` COMPLET est compté sous
   *  CHAQUE axe auquel il appartient (pas de répartition au prorata), donc la somme de ces lignes
   *  par axe peut désormais dépasser le vrai total programme — voir `totalAllocatedBudget`/
   *  `totalConsumedBudgetDeduped` ci-dessous pour le total PROGRAMME, qui lui compte chaque
   *  chantier une seule fois. */
  const budgetByAxisWithConsumed = useMemo(
    () =>
      axes.map((axis) => {
        const own = chantiers.filter((c) => c.axisIds.includes(axis.id));
        return {
          id: axis.id,
          name: axis.name,
          allocated: own.reduce((sum, c) => sum + (c.allocatedBudget ?? 0), 0),
          consumed: own.reduce((sum, c) => sum + (c.consumedBudget ?? 0), 0),
        };
      }),
    [axes, chantiers]
  );

  /** Total CONSOMMÉ programme, dédupliqué — pendant de `totalAllocatedBudget` ci-dessus (déjà
   *  correctement dédupliqué : il itère `chantiers`, la liste à plat, une fois chacun) mais pour le
   *  consommé, round 24 : nécessaire pour l'overlay central du donut unifié ci-dessous, qui ne peut
   *  plus dériver son total consommé de la somme des parts par axe (`unifiedBudgetSlices`) depuis
   *  qu'un chantier multi-axe y apparaît dans plusieurs parts à la fois (voir le commentaire de
   *  `budgetByAxisWithConsumed`). */
  const totalConsumedBudgetDeduped = useMemo(
    () => chantiers.reduce((sum, c) => sum + (c.consumedBudget ?? 0), 0),
    [chantiers]
  );

  /** Round 16 (PO : fusion de la carte "Budget financier alloué" en un seul graphique) — parts du
   *  donut UNIFIÉ par axe, alimentant à la fois l'anneau extérieur (répartition, `value`) et
   *  l'anneau intérieur "consommé" (`showConsumedRing`) de `BudgetDonutChart`. Même découpage/ordre
   *  d'axes que `budgetByAxisWithConsumed` ci-dessus, dont ce memo est une simple projection. */
  const unifiedBudgetSlices: BudgetDonutSlice[] = useMemo(
    () =>
      budgetByAxisWithConsumed.map((row) => ({
        name: row.name,
        value: row.allocated,
        consumed: row.consumed,
      })),
    [budgetByAxisWithConsumed]
  );

  /** `BudgetDonutChart.onSliceClick` ne renvoie que le NOM de la part cliquée (contrat du
   *  composant, inchangé) — ce lookup retrouve l'axe correspondant pour ouvrir son drill-down. */
  const axisByName = useMemo(() => new Map(axes.map((a) => [a.name, a] as const)), [axes]);

  /** Parts du donut de drill-down (round 13) : un slice par chantier de l'axe actuellement ouvert
   *  (`budgetDrilldownAxisId`), en excluant les chantiers sans `allocatedBudget` renseigné — même
   *  convention d'exclusion que le donut de répartition par levier de `AxisKanban` (round 12).
   *  `null` tant qu'aucune modale n'est ouverte. */
  const budgetDrilldownSlices: BudgetDonutSlice[] | null = useMemo(() => {
    if (!budgetDrilldownAxisId) return null;
    return chantiers
      .filter((c) => c.axisIds.includes(budgetDrilldownAxisId) && c.allocatedBudget !== undefined)
      .map((c) => ({ name: c.name, value: c.allocatedBudget ?? 0 }));
  }, [budgetDrilldownAxisId, chantiers]);

  /** `BudgetDonutChart.onSliceClick` du second donut (par chantier) ne renvoie lui aussi que le
   *  NOM de la part cliquée — ce lookup, restreint aux chantiers de l'axe actuellement ouvert dans
   *  la modale, retrouve l'`id` du chantier pour naviguer vers sa fiche (round 14). */
  const drilldownChantierByName = useMemo(() => {
    if (!budgetDrilldownAxisId) return new Map<string, string>();
    return new Map(
      chantiers
        .filter((c) => c.axisIds.includes(budgetDrilldownAxisId))
        .map((c) => [c.name, c.id] as const)
    );
  }, [budgetDrilldownAxisId, chantiers]);

  const budgetDrilldownAxis = axes.find((a) => a.id === budgetDrilldownAxisId) ?? null;

  // Bouton d'import Excel + lien base ETP : rendus directement dans l'en-tête (réutilisé par
  // toutes les branches de retour ci-dessous) plutôt que dans une variable de toolbar séparée.
  // L'import n'apparaît que lorsque `chantiers`/`chantierActions`/`staffing` sont effectivement
  // disponibles (programme actif de type stratégique) ; le lien base ETP, lui, ne dépend d'aucun
  // programme (round 13 — la base ETP est scopée entreprise, pas programme).
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Users size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">{t("effectifs.title")}</h1>
        {activeProgram && <span className="text-sm text-text-secondary">{activeProgram.name}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/hr/etp"
          className="flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-primary transition hover:border-black"
        >
          {t("effectifs.viewBaseEtp")} <ArrowUpRight size={13} />
        </Link>
        {activeProgram && programType === "strategic" && (
          <StaffingImportButton
            companyId={user?.companyId}
            programId={activeProgramId}
            chantiers={chantiers}
            chantierActions={chantierActions}
            staffing={staffing}
            knownDepartments={Object.keys(fteByDept)}
            onImport={async (entries) => {
              for (const entry of entries) await saveChantierStaffing(entry);
            }}
          />
        )}
      </div>
    </div>
  );

  if (roleLoading || programLoading || dataLoading || departmentsLoading) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("effectifs.loading")}</p>
      </div>
    );
  }

  if (!activeProgram) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("effectifs.noProgram")}</p>
      </div>
    );
  }

  // Atteinte directe par URL alors que le programme actif est un Plan Performance : la nav ne
  // propose pas cette route dans ce cas, on explique plutôt que d'afficher une page vide.
  if (programType !== "strategic") {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-text-secondary">{t("effectifs.notStrategic")}</p>
      </div>
    );
  }

  // Section budget FINANCIER : même scope PROGRAMME que la section besoin/disponible ci-dessous,
  // mais purement monétaire — rendue AVANT elle (demande PO : le lecteur voit d'abord l'argent,
  // puis le détail ETP), dans les deux branches de retour (staffing vide ou non).
  const formatAllocatedBudget = (value: number) =>
    `${value.toLocaleString()} ${activeProgram.currency}`;
  // Round 14 (PO) : la tuile `KPICard` "Budget total alloué" (simple somme) était redondante avec
  // le total désormais affiché au centre du donut lui-même (round 13) — retirée, le donut seul
  // porte maintenant à la fois la répartition ET le total.
  //
  // Round 16 (PO : "trois éléments visuels séparés pour la même info, c'est répétitif") : la barre
  // `BudgetVsActualBar` programme (consommé vs alloué total) et la liste d'une `BudgetVsActualBar`
  // par axe ont été retirées — le SEUL `BudgetDonutChart` ci-dessous porte maintenant la
  // répartition par axe ET le consommé (anneau intérieur `showConsumedRing`, alimenté par
  // `unifiedBudgetSlices`), avec le même comportement de clic (`onSliceClick`) qu'avant.
  const moneyBudgetSection = (
    <Card className="mb-0">
      <CardHeader title={t("effectifs.moneyBudget.title")} />
      <CardBody>
        {totalAllocatedBudget === 0 ? (
          <p className="text-sm text-text-secondary">{t("effectifs.moneyBudget.empty")}</p>
        ) : (
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              {t("effectifs.moneyBudget.byAxisTitle")}
            </h3>
            <BudgetDonutChart
              data={unifiedBudgetSlices}
              formatValue={formatAllocatedBudget}
              centerLabel={t("effectifs.moneyBudget.centerLabelConsumed")}
              showConsumedRing
              consumedLabel={t("effectifs.moneyBudget.consumedTooltipSuffix")}
              // Round 24 : `unifiedBudgetSlices` compte un chantier multi-axe une fois PAR axe
              // auquel il appartient (voir `budgetByAxisWithConsumed`) — le total/consommé affiché
              // au centre doit rester le vrai total PROGRAMME (chaque chantier une seule fois),
              // donc calculé séparément ici plutôt que dérivé de `data.reduce(...)`.
              total={totalAllocatedBudget}
              consumedTotal={totalConsumedBudgetDeduped}
              onSliceClick={(name) => {
                const axis = axisByName.get(name);
                if (axis) setBudgetDrilldownAxisId(axis.id);
              }}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );

  // Drill-down (round 13) : budget de l'axe cliqué ci-dessus, ventilé PAR CHANTIER. Round 14 (PO) :
  // ce second donut gagne à son tour un `onSliceClick` — la page Effectifs n'a pas de panneau
  // chantier propre, donc un clic ici navigue vers `/levers?chantier=<id>` (même contrat que
  // `StrategicAxesView.openChantierPanel`/`StrategicDashboardView`) pour ouvrir la fiche chantier
  // sur la page Axes stratégiques. Le donut de PREMIER niveau (par axe, ci-dessus) garde lui son
  // comportement actuel (ouvrir cette modale) — inchangé.
  const budgetDrilldownModal = (
    <Modal
      open={!!budgetDrilldownAxisId}
      onOpenChange={(open) => {
        if (!open) setBudgetDrilldownAxisId(null);
      }}
      title={t("effectifs.moneyBudget.byChantierModalTitle")}
      maxWidth="560px"
    >
      {budgetDrilldownAxis && (
        <p className="mb-3 text-[12px] font-semibold text-primary">{budgetDrilldownAxis.name}</p>
      )}
      {budgetDrilldownSlices && budgetDrilldownSlices.length > 0 ? (
        <BudgetDonutChart
          data={budgetDrilldownSlices}
          formatValue={formatAllocatedBudget}
          centerLabel={t("effectifs.moneyBudget.centerLabel")}
          onSliceClick={(name) => {
            const chantierId = drilldownChantierByName.get(name);
            if (chantierId) router.push(`/levers?chantier=${chantierId}`);
          }}
        />
      ) : (
        <p className="py-6 text-center text-[12px] text-tertiary">
          {t("effectifs.moneyBudget.byChantierEmpty")}
        </p>
      )}
    </Modal>
  );

  // Section besoin vs disponible : indépendante de la présence de lignes de staffing (une équipe
  // de la base ETP peut être 100% disponible et n'apparaître ici que pour ça) — construite une
  // seule fois et rendue dans les deux branches ci-dessous (staffing vide ou non).
  const needVsAvailableSection = (
    <Card className="mb-0">
      <CardHeader title={t("effectifs.needVsAvailable.title")} />
      <CardBody>
        {needVsAvailable.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("effectifs.needVsAvailable.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {needVsAvailable.map(({ fn, needed, available }) => {
              const pct = available > 0 ? Math.round((needed / available) * 100) : null;
              const overAllocated = pct !== null && pct > 100;
              return (
                <li key={fn}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                      <span
                        aria-hidden
                        className={`h-2 w-2 rounded-full ${colorForDepartment(fn)}`}
                      />
                      {fn}
                    </span>
                    <span className="text-[12px] text-secondary">
                      <strong className="text-primary">{formatFte(needed)}</strong>{" "}
                      {t("effectifs.needVsAvailable.neededOf")}{" "}
                      <strong className="text-primary">{formatFte(available)}</strong>{" "}
                      {t("staffing.fteUnit")}
                      {pct !== null && (
                        <span
                          className={`ml-1.5 font-bold ${overAllocated ? "text-bp-coral" : ""}`}
                        >
                          ({pct}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <Bar pct={pct !== null ? Math.min(pct, 100) : 0} fn={fn} />
                  {overAllocated && (
                    <p className="mt-1 text-[11px] font-semibold text-bp-coral">
                      {t("effectifs.needVsAvailable.overAllocated")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );

  if (staffing.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <p className="max-w-3xl text-sm text-text-secondary">{t("effectifs.subtitle")}</p>
        {moneyBudgetSection}
        {budgetDrilldownModal}
        {needVsAvailableSection}
        <Card>
          <CardBody>
            <p className="text-sm text-text-secondary">{t("effectifs.empty")}</p>
            <p className="mt-1 text-xs text-tertiary">{t("effectifs.emptyHint")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <p className="max-w-3xl text-sm text-text-secondary">{t("effectifs.subtitle")}</p>
      {moneyBudgetSection}
      {budgetDrilldownModal}
      {needVsAvailableSection}

      <KPICard
        label={t("effectifs.kpi.totalFte")}
        value={`${formatFte(totalFte)} ${t("staffing.fteUnit")}`}
        icon={Users}
        sub={t("effectifs.kpi.totalFteSub")}
        barSegments={totalFteBarSegments}
      />

      {/* ── 1. Répartition des ETP, par période ET par axe (round 7, fusionné round 22 — voir le
          doc-comment de `StaffingPeriodBreakdown.tsx` : le composant porte désormais lui-même tout
          le cross-filtering équipe/chantier/période qui vivait auparavant sur cette page, ainsi que
          l'ex-carte "Répartition par axe" retirée d'ici). ─────────────────────────────────────── */}
      <StaffingPeriodBreakdown
        staffing={staffing}
        fteByDept={fteByDept}
        axes={axes}
        chantierNamesById={chantierNamesById}
        axisIdsByChantier={axisIdsByChantier}
      />
    </div>
  );
}
