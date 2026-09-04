"use client";

import { useMemo, useState } from "react";
import { Building2, Layers, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { KPICard } from "@/components/shared/KPICard";
import { STAFFING_FUNCTIONS, formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing, StaffingFunction, StrategicAxis } from "@/types";

/**
 * Page « Effectifs mobilisés » — lecture transverse du staffing saisi chantier par chantier
 * (`ChantierStaffingEditor`, dans la pop-up de détail d'un chantier). Deux niveaux de lecture,
 * dans l'ordre demandé par le PO :
 *
 *  1. AU GLOBAL, par grande fonction : combien d'ETP RH / Finance / IT… le programme mobilise-t-il
 *     au total. Chaque fonction est CLIQUABLE et devient le filtre du bloc suivant.
 *  2. PAR AXE : où ces ETP sont-ils consommés. Sans sélection, une carte par axe donne sa
 *     répartition complète ; une fonction sélectionnée bascule le bloc en comparaison directe
 *     entre axes pour CETTE fonction — la lecture « sur-staffage » attendue (un axe qui capte
 *     l'essentiel d'une fonction saute alors aux yeux).
 *
 * Aucune écriture ici : la saisie vit exclusivement dans la fiche chantier, pour ne pas avoir deux
 * flux de saisie divergents sur la même donnée (même parti pris que la page KPI vs la fiche axe).
 *
 * Barres : pur CSS/Tailwind (largeur en %), comme les barres de `KPICard` — pas de dépendance
 * graphique pour une répartition à une dimension.
 *
 * Rien à voir avec les écrans RH du Plan Performance : `Chantier`/`ChantierStaffing` n'existent
 * que côté stratégique, et la route est fermée aux programmes Performance (voir la garde
 * `programType` en bas de fichier + `programTypes: ["strategic"]` dans `lib/nav-config.ts`).
 */

/** Somme des ETP par fonction sur un lot de lignes, restreinte aux fonctions réellement
 *  mobilisées et triée par volume décroissant (le classement EST l'information : on lit d'abord
 *  la fonction la plus sollicitée). */
function totalsByFunction(entries: ChantierStaffing[]): { fn: StaffingFunction; fte: number }[] {
  const map = new Map<StaffingFunction, number>();
  for (const entry of entries) {
    map.set(entry.function, (map.get(entry.function) ?? 0) + (entry.fte || 0));
  }
  return STAFFING_FUNCTIONS.filter((fn) => (map.get(fn) ?? 0) > 0)
    .map((fn) => ({ fn, fte: map.get(fn) ?? 0 }))
    .sort((a, b) => b.fte - a.fte);
}

/** Barre horizontale simple — `pct` déjà borné par l'appelant. */
function Bar({ pct, highlighted = false }: { pct: number; highlighted?: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
      <div
        className={`h-full rounded-full transition-all ${highlighted ? "bg-bp-coral" : "bg-black"}`}
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
    staffing,
    loading: dataLoading,
  } = useStrategicData(user?.companyId ?? null, activeProgramId);

  /** Fonction sélectionnée = filtre du bloc « par axe ». `null` = vue complète. */
  const [selectedFunction, setSelectedFunction] = useState<StaffingFunction | null>(null);

  const globalTotals = useMemo(() => totalsByFunction(staffing), [staffing]);
  const totalFte = useMemo(() => staffing.reduce((sum, e) => sum + (e.fte || 0), 0), [staffing]);
  const maxFunctionFte = globalTotals[0]?.fte ?? 0;

  const staffedChantierCount = useMemo(
    () => new Set(staffing.map((e) => e.chantierId)).size,
    [staffing]
  );

  const chantierNames = useMemo(() => new Map(chantiers.map((c) => [c.id, c.name])), [chantiers]);

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

  /** Comparaison inter-axes pour la fonction sélectionnée, triée par volume décroissant. */
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

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <Users size={22} className="text-bp-coral" />
      <h1 className="text-xl font-bold text-text-primary">{t("effectifs.title")}</h1>
      {activeProgram && <span className="text-sm text-text-secondary">{activeProgram.name}</span>}
    </div>
  );

  if (roleLoading || programLoading || dataLoading) {
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

  if (staffing.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <p className="max-w-3xl text-sm text-text-secondary">{t("effectifs.subtitle")}</p>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          label={t("effectifs.kpi.totalFte")}
          value={`${formatFte(totalFte)} ${t("staffing.fteUnit")}`}
          icon={Users}
          sub={t("effectifs.kpi.totalFteSub")}
        />
        <KPICard
          label={t("effectifs.kpi.functions")}
          value={String(globalTotals.length)}
          icon={Layers}
          sub={`${STAFFING_FUNCTIONS.length} ${t("effectifs.kpi.functionsSub")}`}
        />
        <KPICard
          label={t("effectifs.kpi.chantiers")}
          value={`${staffedChantierCount} / ${chantiers.length}`}
          icon={Building2}
          sub={t("effectifs.kpi.chantiersSub")}
        />
      </div>

      {/* ── 1. Au global, par grande fonction (cliquable) ──────────────────────────────────── */}
      <Card className="mb-0">
        <CardHeader
          title={t("effectifs.byFunction")}
          actions={
            selectedFunction && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedFunction(null)}>
                {t("effectifs.allFunctions")}
              </Button>
            )
          }
        />
        <CardBody>
          <p className="mb-3 text-xs text-tertiary">{t("effectifs.clickHint")}</p>
          <ul className="space-y-2.5">
            {globalTotals.map(({ fn, fte }) => {
              const selected = selectedFunction === fn;
              const sharePct = totalFte > 0 ? (fte / totalFte) * 100 : 0;
              return (
                <li key={fn}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedFunction(selected ? null : fn)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      selected
                        ? "border-bp-coral bg-neutral-50"
                        : "border-border bg-white hover:bg-neutral-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-primary">
                        {t(`staffing.function.${fn}`)}
                      </span>
                      <span className="text-[12px] text-secondary">
                        <strong className="text-primary">{formatFte(fte)}</strong>{" "}
                        {t("staffing.fteUnit")} · {Math.round(sharePct)}%
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Bar
                        pct={maxFunctionFte > 0 ? (fte / maxFunctionFte) * 100 : 0}
                        highlighted={selected}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      {/* ── 2. Répartition par axe ─────────────────────────────────────────────────────────── */}
      {selectedFunction ? (
        <Card className="mb-0">
          <CardHeader
            title={`${t("effectifs.byAxisFor")} · ${t(`staffing.function.${selectedFunction}`)}`}
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
                          highlighted
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
                              <span className="text-[12px] text-primary">
                                {t(`staffing.function.${fn}`)}
                              </span>
                              <span className="text-[12px] text-secondary">
                                {formatFte(fte)} {t("staffing.fteUnit")}
                              </span>
                            </div>
                            <div className="mt-1">
                              <Bar pct={axisMax > 0 ? (fte / axisMax) * 100 : 0} />
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
