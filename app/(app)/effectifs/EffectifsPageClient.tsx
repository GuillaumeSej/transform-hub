"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Users, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { BudgetDonutChart } from "@/components/shared/charts/BudgetDonutChart";
import { KPICard } from "@/components/shared/KPICard";
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
import type { ChantierStaffing, StrategicAxis } from "@/types";

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
 *  1. PAR PÉRIODE (`StaffingPeriodBreakdown`, round 7) : combien d'ETP le programme mobilise-t-il,
 *     trimestre/semestre/année par trimestre/semestre/année, et par équipe dans chaque période.
 *     Cliquer une équipe (dans n'importe quelle période) la sélectionne et devient le filtre du
 *     bloc suivant.
 *  2. PAR AXE : où ces ETP sont-ils consommés. Sans sélection, une carte par axe donne sa
 *     répartition complète ; une équipe sélectionnée bascule le bloc en comparaison directe entre
 *     axes pour CETTE équipe — la lecture « sur-staffage » attendue (un axe qui capte l'essentiel
 *     d'une équipe saute alors aux yeux).
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
    loading: dataLoading,
  } = useStrategicData(user?.companyId ?? null, activeProgramId);
  const { fteByDept, loading: departmentsLoading } = useCompanyDepartments(user?.companyId ?? null);

  /** Équipe sélectionnée = filtre du bloc « par axe ». `null` = vue complète. */
  const [selectedFunction, setSelectedFunction] = useState<string | null>(null);

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

  // ── Budget FINANCIER alloué (round 12) ─────────────────────────────────────────────────────
  // Nouvelle section monétaire, distincte du besoin/disponible ETP ci-dessus (une question de €,
  // pas d'ETP) : total du budget alloué (`Chantier.allocatedBudget`, round 7) sur tout le
  // programme, même calcul que la puce du dashboard stratégique (`StrategicDashboardView`), et sa
  // ventilation PAR AXE pour le donut générique `BudgetDonutChart` (fondation round 12).
  const totalAllocatedBudget = useMemo(
    () => chantiers.reduce((sum, c) => sum + (c.allocatedBudget ?? 0), 0),
    [chantiers]
  );

  const allocatedBudgetByAxis = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of chantiers) {
      totals.set(c.axisId, (totals.get(c.axisId) ?? 0) + (c.allocatedBudget ?? 0));
    }
    return axes.map((axis) => ({ name: axis.name, value: totals.get(axis.id) ?? 0 }));
  }, [axes, chantiers]);

  /** Un groupe par axe du programme (y compris les axes SANS staffing : leur absence est une
   *  information — un axe sans aucun ETP déclaré n'est pas la même chose qu'un axe absent), plus
   *  un groupe de repli pour les lignes dont l'axe n'existe plus. */
  const byAxis = useMemo(() => {
    const groups: { axis: StrategicAxis | null; entries: ChantierStaffing[] }[] = axes.map(
      (axis) => ({ axis, entries: staffing.filter((e) => e.axisId === axis.id) })
    );
    const knownAxisIds = new Set(axes.map((a) => a.id));
    const orphans = staffing.filter((e) => !knownAxisIds.has(e.axisId));
    if (orphans.length > 0) groups.push({ axis: null, entries: orphans });
    return groups;
  }, [axes, staffing]);

  /** Comparaison inter-axes pour l'équipe sélectionnée, triée par volume décroissant. */
  const selectedByAxis = useMemo(() => {
    if (!selectedFunction) return [];
    return byAxis
      .map((group) => ({
        axis: group.axis,
        fte: group.entries
          .filter((e) => e.function === selectedFunction)
          .reduce((sum, e) => sum + (e.fte || 0), 0),
        chantiers: Array.from(
          new Set(
            group.entries.filter((e) => e.function === selectedFunction).map((e) => e.chantierId)
          )
        ),
      }))
      .filter((row) => row.fte > 0)
      .sort((a, b) => b.fte - a.fte);
  }, [byAxis, selectedFunction]);

  const selectedTotal = selectedByAxis.reduce((sum, row) => sum + row.fte, 0);
  const selectedMax = selectedByAxis[0]?.fte ?? 0;

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
  const moneyBudgetSection = (
    <Card className="mb-0">
      <CardHeader title={t("effectifs.moneyBudget.title")} />
      <CardBody>
        {totalAllocatedBudget === 0 ? (
          <p className="text-sm text-text-secondary">{t("effectifs.moneyBudget.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <KPICard
              label={t("effectifs.moneyBudget.totalLabel")}
              value={formatAllocatedBudget(totalAllocatedBudget)}
              icon={Wallet}
              sub={t("effectifs.moneyBudget.totalSub")}
            />
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
                {t("effectifs.moneyBudget.byAxisTitle")}
              </h3>
              <BudgetDonutChart data={allocatedBudgetByAxis} formatValue={formatAllocatedBudget} />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
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
      {needVsAvailableSection}

      <KPICard
        label={t("effectifs.kpi.totalFte")}
        value={`${formatFte(totalFte)} ${t("staffing.fteUnit")}`}
        icon={Users}
        sub={t("effectifs.kpi.totalFteSub")}
        barSegments={totalFteBarSegments}
      />

      {/* ── 1. Répartition par période (round 7 — remplace l'ancienne section "Au global, par
          grande fonction", sans dimension temporelle) ─────────────────────────────────────── */}
      <StaffingPeriodBreakdown
        staffing={staffing}
        fteByDept={fteByDept}
        selectedFunction={selectedFunction}
        onSelectFunction={setSelectedFunction}
      />

      {/* ── 2. Répartition par axe ─────────────────────────────────────────────────────────── */}
      {selectedFunction ? (
        <Card className="mb-0">
          <CardHeader
            title={`${t("effectifs.byAxisFor")} · ${selectedFunction}`}
            actions={
              <span className="text-[12px] text-secondary">
                {formatFte(selectedTotal)} {t("staffing.fteUnit")}
              </span>
            }
          />
          <CardBody>
            {selectedByAxis.length === 0 ? (
              <p className="text-sm text-text-secondary">{t("effectifs.noStaffingForFunction")}</p>
            ) : (
              <ul className="space-y-3">
                {selectedByAxis.map((row) => {
                  const sharePct = selectedTotal > 0 ? (row.fte / selectedTotal) * 100 : 0;
                  return (
                    <li key={row.axis?.id ?? "__orphans__"}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-primary">
                          {row.axis?.name ?? t("effectifs.axisUnknown")}
                        </span>
                        <span className="text-[12px] text-secondary">
                          <strong className="text-primary">{formatFte(row.fte)}</strong>{" "}
                          {t("staffing.fteUnit")} · {Math.round(sharePct)}{" "}
                          {t("effectifs.percentOfFunction")}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Bar
                          pct={selectedMax > 0 ? (row.fte / selectedMax) * 100 : 0}
                          fn={selectedFunction}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-tertiary">
                        {row.chantiers
                          .map((id) => chantierNames.get(id) ?? t("effectifs.chantierUnknown"))
                          .join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">
            {t("effectifs.byAxis")}
          </h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {byAxis.map((group) => {
              const axisTotals = totalsByFunction(group.entries);
              const axisTotal = axisTotals.reduce((sum, row) => sum + row.fte, 0);
              const axisMax = axisTotals[0]?.fte ?? 0;
              return (
                <Card key={group.axis?.id ?? "__orphans__"} className="mb-0">
                  <CardHeader
                    title={group.axis?.name ?? t("effectifs.axisUnknown")}
                    actions={
                      <span className="text-[12px] text-secondary">
                        <strong className="text-primary">{formatFte(axisTotal)}</strong>{" "}
                        {t("staffing.fteUnit")}
                      </span>
                    }
                  />
                  <CardBody>
                    {axisTotals.length === 0 ? (
                      <p className="text-[12px] text-tertiary">{t("effectifs.noStaffingOnAxis")}</p>
                    ) : (
                      <ul className="space-y-2">
                        {axisTotals.map(({ fn, fte }) => (
                          <li key={fn}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-[12px] text-primary">{fn}</span>
                              <span className="text-[12px] text-secondary">
                                {formatFte(fte)} {t("staffing.fteUnit")}
                              </span>
                            </div>
                            <div className="mt-1">
                              <Bar pct={axisMax > 0 ? (fte / axisMax) * 100 : 0} fn={fn} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
