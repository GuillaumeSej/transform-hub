"use client";

import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/components/shared/Modal";
import type { MovementAlert, MovementAlertKind } from "@/lib/hrEngine";
import { etpAlertFilterLink, etpMovementDeepLink } from "@/lib/hrMovementLink";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Lever } from "@/types";

type T = (key: string, fallback?: string) => string;

/** Ordre d'affichage des sections = ordre de gravité (même priorité que `movementAlerts`). */
const KIND_ORDER: MovementAlertKind[] = ["overdue", "leverMismatch", "toValidate", "due"];

const KIND_BADGE: Record<MovementAlertKind, string> = {
  overdue: "border-rag-red-light bg-rag-red-light/60 text-rag-red",
  leverMismatch: "border-rag-red-light bg-rag-red-light/60 text-rag-red",
  toValidate: "border-border bg-neutral-50 text-secondary",
  due: "border-rag-amber-light bg-rag-amber-light/60 text-primary",
};

function sectionTitle(t: T, kind: MovementAlertKind): string {
  switch (kind) {
    case "overdue":
      return t("hr.alertsModal.section.overdue", "En retard");
    case "leverMismatch":
      return t("hr.alertsModal.section.leverMismatch", "Désynchronisés");
    case "toValidate":
      return t("hr.alertsModal.section.toValidate", "À valider");
    case "due":
      return t("hr.alertsModal.section.due", "Échéance proche");
  }
}

function summaryPart(t: T, kind: MovementAlertKind, n: number): string {
  const tpl = {
    overdue: t("hr.alertsModal.summary.overdue", "{n} en retard"),
    leverMismatch: t("hr.alertsModal.summary.leverMismatch", "{n} désynchronisée(s)"),
    toValidate: t("hr.alertsModal.summary.toValidate", "{n} à valider"),
    due: t("hr.alertsModal.summary.due", "{n} échéance(s) proche(s)"),
  }[kind];
  return tpl.replace("{n}", String(n));
}

/** Tri par urgence au sein d'une catégorie (le plus urgent en premier). */
function urgencyScore(a: MovementAlert): number {
  const d = a.detail;
  if (!d) return 0;
  switch (d.reason) {
    case "overdue":
      return -d.daysLate; // plus gros retard d'abord
    case "due":
      return d.daysLeft; // échéance la plus proche d'abord
    case "leverCancelled":
      return 0; // levier annulé = le plus bloquant
    case "afterLeverEnd":
      return 1;
    case "signMismatch":
      return 2;
    case "toValidate":
      return 0;
  }
}

function fmtFte(n: number): string {
  return `${n > 0 ? "+" : ""}${n} ETP`;
}

/**
 * Synthèse des alertes mouvements du Dashboard RH, ouverte AVANT toute navigation depuis le
 * bandeau d'alertes (clic sur le compteur ou sur une catégorie). Aucun calcul métier : l'appelant
 * fournit la liste déjà calculée par `hr.movementAlerts` (lib/hrEngine.ts) ; la modale se contente
 * de regrouper par catégorie, trier par urgence et afficher les valeurs comparées portées par
 * `MovementAlert.detail`. Même Modal et même style de tableau que `MovementDetailDrilldownModal`.
 *
 * - Clic sur une ligne → détail du mouvement dans la Base ETP (`etpMovementDeepLink`, ouvre sa
 *   modale d'édition).
 * - Pied de modale → Base ETP, onglet mouvements, filtrée sur la/les catégorie(s) affichée(s)
 *   (`etpAlertFilterLink`, filtre `f_alert` visible et modifiable dans la barre de filtres).
 */
export function MovementAlertsSummaryModal({
  open,
  onOpenChange,
  alerts,
  initialKind = null,
  kindLabels,
  levers,
  programLabels = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alerts: MovementAlert[];
  /** Catégorie ouverte à l'ouverture (clic sur une puce) — `null` = toutes. */
  initialKind?: MovementAlertKind | null;
  /** Libellés du filtre `f_alert` de la Base ETP (`hr.alert.*`) — valeurs passées dans l'URL. */
  kindLabels: Record<MovementAlertKind, string>;
  levers: Lever[];
  programLabels?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [activeKind, setActiveKind] = useState<MovementAlertKind | null>(initialKind);
  const [collapsed, setCollapsed] = useState<Set<MovementAlertKind>>(new Set());

  useEffect(() => {
    if (open) {
      setActiveKind(initialKind);
      setCollapsed(new Set());
    }
  }, [open, initialKind]);

  const leverById = useMemo(() => new Map(levers.map((l) => [l.id, l])), [levers]);

  const groups = useMemo(() => {
    const byKind = new Map<MovementAlertKind, MovementAlert[]>();
    for (const a of alerts) {
      const list = byKind.get(a.kind) ?? [];
      list.push(a);
      byKind.set(a.kind, list);
    }
    return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
      kind,
      items: [...(byKind.get(kind) ?? [])].sort(
        (a, b) =>
          urgencyScore(a) - urgencyScore(b) ||
          a.movement.plannedDate.localeCompare(b.movement.plannedDate) ||
          a.movement.label.localeCompare(b.movement.label, "fr")
      ),
    }));
  }, [alerts]);

  const visibleGroups = activeKind ? groups.filter((g) => g.kind === activeKind) : groups;
  const dash = "—";

  const bilan = `${t("hr.alertsModal.summary.total", "{n} alerte(s)").replace(
    "{n}",
    String(alerts.length)
  )} : ${groups.map((g) => summaryPart(t, g.kind, g.items.length)).join(", ")}`;

  const openMovement = (id: string) => {
    onOpenChange(false);
    router.push(etpMovementDeepLink([id]));
  };
  const goToDetailedPage = () => {
    onOpenChange(false);
    router.push(etpAlertFilterLink(visibleGroups.map((g) => kindLabels[g.kind])));
  };
  const toggleSection = (kind: MovementAlertKind) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const leverOf = (leverId: string) => {
    const l = leverById.get(leverId);
    return l ? `${l.code} — ${l.name}` : dash;
  };
  const programOf = (programId?: string) =>
    programId ? (programLabels[programId] ?? programId) : dash;

  const th = (label: string, key?: string) => (
    <th key={key ?? label} className="whitespace-nowrap px-3 py-2 font-semibold">
      {label}
    </th>
  );

  const colWho = t("hr.movementProgress.col.who", "Qui");
  const colType = t("hr.movementProgress.col.type", "Type");
  const colProgLever = t("hr.alertsModal.col.programLever", "Programme / levier");
  const colDept = t("hr.department", "Département");
  const colCountry = t("dashboard.country", "Pays");
  const colPlanned = t("hr.movementProgress.col.plannedDate", "Date prévue");
  const colActual = t("hr.movementProgress.col.actualDate", "Date réelle");

  const headers: Record<MovementAlertKind, string[]> = {
    overdue: [
      colWho,
      colType,
      colProgLever,
      colDept,
      colCountry,
      colPlanned,
      t("hr.alertsModal.col.daysLate", "Retard"),
    ],
    leverMismatch: [
      colWho,
      colType,
      t("hr.alertsModal.col.lever", "Levier"),
      t("hr.alertsModal.col.issue", "Écart constaté"),
      t("hr.alertsModal.col.movementValue", "Mouvement"),
      t("hr.alertsModal.col.leverValue", "Levier"),
    ],
    toValidate: [colWho, colType, colProgLever, colDept, colCountry, colActual],
    due: [
      colWho,
      colType,
      colProgLever,
      colDept,
      colCountry,
      colPlanned,
      t("hr.alertsModal.col.daysLeft", "Jours restants"),
    ],
  };

  const whoCells = (a: MovementAlert): ReactNode[] => {
    const m = a.movement;
    return [
      <td key="who" className="px-3 py-2 font-semibold text-primary">
        {m.label || dash}
        <span className="ml-1.5 font-mono text-[10px] font-normal text-tertiary">{m.id}</span>
      </td>,
      <td key="type" className="px-3 py-2 text-secondary">
        {m.type}
      </td>,
    ];
  };
  const contextCells = (a: MovementAlert): ReactNode[] => {
    const m = a.movement;
    return [
      <td key="pl" className="px-3 py-2 text-secondary">
        <div>{programOf(m.programId)}</div>
        <div className="text-[11px] text-tertiary">{leverOf(m.leverId)}</div>
      </td>,
      <td key="dept" className="px-3 py-2 text-secondary">
        {m.department || dash}
      </td>,
      <td key="country" className="px-3 py-2 text-secondary">
        {m.country || dash}
      </td>,
    ];
  };
  const numCell = (key: string, value: ReactNode, className = "text-secondary") => (
    <td key={key} className={`whitespace-nowrap px-3 py-2 tabular-nums ${className}`}>
      {value}
    </td>
  );

  const rowCells = (a: MovementAlert): ReactNode[] => {
    const m = a.movement;
    const d = a.detail;
    switch (a.kind) {
      case "overdue":
        return [
          ...whoCells(a),
          ...contextCells(a),
          numCell("planned", m.plannedDate || dash),
          numCell(
            "late",
            d?.reason === "overdue"
              ? t("hr.alertsModal.daysLate", "{n} j").replace("{n}", String(d.daysLate))
              : dash,
            "font-semibold text-rag-red"
          ),
        ];
      case "due":
        return [
          ...whoCells(a),
          ...contextCells(a),
          numCell("planned", m.plannedDate || dash),
          numCell(
            "left",
            d?.reason === "due"
              ? d.daysLeft === 0
                ? t("hr.alertsModal.today", "Aujourd'hui")
                : t("hr.alertsModal.daysLeft", "{n} j").replace("{n}", String(d.daysLeft))
              : dash,
            "font-semibold text-primary"
          ),
        ];
      case "toValidate":
        return [...whoCells(a), ...contextCells(a), numCell("actual", m.actualDate || dash)];
      case "leverMismatch": {
        let issue: string = a.message;
        let movementValue: string = dash;
        let leverValue: string = dash;
        let leverLabel = leverOf(m.leverId);
        if (d?.reason === "leverCancelled") {
          leverLabel = `${d.leverCode} — ${d.leverName}`;
          issue = t(
            "hr.alertsModal.issue.leverCancelled",
            "Levier annulé : mouvement encore actif, à requalifier"
          );
          movementValue = m.status;
          leverValue = t("hr.alertsModal.value.cancelled", "Annulé");
        } else if (d?.reason === "afterLeverEnd") {
          leverLabel = `${d.leverCode} — ${d.leverName}`;
          issue = t(
            "hr.alertsModal.issue.afterLeverEnd",
            "Date prévue après la fin du levier (non livré)"
          );
          movementValue = t("hr.alertsModal.value.planned", "Prévu le {d}").replace(
            "{d}",
            d.plannedDate
          );
          leverValue = t("hr.alertsModal.value.leverEnd", "Fin le {d}").replace("{d}", d.leverEnd);
        } else if (d?.reason === "signMismatch") {
          leverLabel = `${d.leverCode} — ${d.leverName}`;
          issue = t(
            "hr.alertsModal.issue.signMismatch",
            "Sens ETP contraire à l'impact visé du levier"
          );
          movementValue = fmtFte(d.movementFte);
          leverValue = fmtFte(d.leverFte);
        }
        return [
          ...whoCells(a),
          <td key="lever" className="px-3 py-2 text-secondary">
            {leverLabel}
          </td>,
          <td key="issue" className="px-3 py-2 text-primary">
            {issue}
          </td>,
          numCell("mv", movementValue, "font-semibold text-rag-red"),
          numCell("lv", leverValue, "font-semibold text-primary"),
        ];
      }
    }
  };

  const footer = (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="rounded-md border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-secondary transition hover:border-black"
      >
        {t("common.close", "Fermer")}
      </button>
      <button
        type="button"
        onClick={goToDetailedPage}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-bp-coral/40 bg-bp-coral/5 px-3 py-1.5 text-[12px] font-semibold text-bp-coral transition hover:border-bp-coral hover:bg-bp-coral/10"
      >
        {t("hr.alertsModal.seeDetailed", "Voir dans la page détaillée")}
        <ArrowUpRight size={13} />
      </button>
    </>
  );

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
      active
        ? "border-black bg-black text-white"
        : "border-border bg-white text-secondary hover:border-black"
    }`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("hr.alertsModal.title", "Alertes mouvements")}
      maxWidth="1040px"
      footer={footer}
    >
      {alerts.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("hr.alertsModal.empty", "Aucune alerte mouvement.")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-semibold text-primary">{bilan}</p>
          <div className="flex flex-wrap gap-1.5" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeKind === null}
              onClick={() => setActiveKind(null)}
              className={tabClass(activeKind === null)}
            >
              {t("hr.alertsModal.tabAll", "Toutes")} · {alerts.length}
            </button>
            {groups.map((g) => (
              <button
                key={g.kind}
                type="button"
                role="tab"
                aria-selected={activeKind === g.kind}
                onClick={() => setActiveKind(g.kind)}
                className={tabClass(activeKind === g.kind)}
              >
                {sectionTitle(t, g.kind)} · {g.items.length}
              </button>
            ))}
          </div>

          {visibleGroups.map((g) => {
            const isCollapsed = collapsed.has(g.kind);
            return (
              <section key={g.kind} className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => toggleSection(g.kind)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} className="text-tertiary" />
                  ) : (
                    <ChevronDown size={14} className="text-tertiary" />
                  )}
                  <span className="text-[13px] font-bold text-primary">
                    {sectionTitle(t, g.kind)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_BADGE[g.kind]}`}
                  >
                    {g.items.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
                      <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-tertiary">
                        <tr>
                          {headers[g.kind].map((h, i) => th(h, `${g.kind}-${i}`))}
                          <th className="w-8 px-2 py-2" aria-hidden />
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((a, i) => (
                          <tr
                            key={`${a.movement.id}-${i}`}
                            onClick={() => openMovement(a.movement.id)}
                            className="cursor-pointer border-t border-border transition hover:bg-neutral-50"
                            title={t("hr.movementProgress.openInEtp", "Ouvrir dans la Base ETP")}
                          >
                            {rowCells(a)}
                            <td className="px-2 py-2 text-tertiary">
                              <ArrowUpRight size={14} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
