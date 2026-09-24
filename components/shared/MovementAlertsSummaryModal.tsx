"use client";

import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/shared/Modal";
import type { MovementAlert, MovementAlertKind } from "@/lib/hrEngine";
import { etpMovementDeepLink } from "@/lib/hrMovementLink";
import { alertedMovementIds } from "@/lib/hrEngine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Locale } from "@/lib/i18n/locales";
import {
  movementAlertMessage,
  movementStatusLabel,
  movementTypeLabel,
} from "@/lib/hrMovementLabels";
import type { Lever, MovementType } from "@/types";
import { intlTag } from "@/lib/format";

type T = (key: string, fallback?: string) => string;

/** Ordre d'affichage des sections = ordre de gravité (même priorité que `movementAlerts`). */
const KIND_ORDER: MovementAlertKind[] = ["overdue", "leverMismatch", "toValidate", "due"];

/** Pastille de compteur des en-têtes de section — tokens de la charte uniquement. */
const KIND_BADGE: Record<MovementAlertKind, string> = {
  overdue: "border-bp-coral bg-bp-coral text-white",
  leverMismatch: "border-bp-red-brick bg-bp-red-brick text-white",
  toValidate: "border-bp-purple bg-bp-purple text-white",
  due: "border-bp-light-pink bg-bp-light-pink text-bp-deep-red",
};

/** Couleur de type de mouvement — même palette que `HrGooduelleCharts` (TYPE_COLORS). */
const TYPE_DOT: Record<MovementType, string> = {
  Recrutement: "bg-bp-purple",
  Attrition: "bg-bp-light-pink",
  "Départ forcé": "bg-bp-coral",
  "Transfert entrant": "bg-bp-warm-taupe",
  "Transfert sortant": "bg-bp-warm-brown",
};

/** « 2026-03-12 » → « 12 mars 2026 » (locale active). Lu en UTC pour éviter tout décalage de jour. */
function formatIsoDate(
  iso: string | undefined,
  locale: Locale,
  month: "long" | "short"
): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlTag(locale), {
    day: "numeric",
    month,
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

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

function fmtFte(n: number, unit: string): string {
  return `${n > 0 ? "+" : ""}${n} ${unit}`;
}

/**
 * Synthèse des alertes mouvements du Dashboard RH, ouverte AVANT toute navigation depuis le
 * bandeau d'alertes (clic sur le compteur ou sur une catégorie). Aucun calcul métier : l'appelant
 * fournit la liste déjà calculée par `hr.movementAlerts` (lib/hrEngine.ts) ; la modale se contente
 * de regrouper par catégorie, trier par urgence et afficher les valeurs comparées portées par
 * `MovementAlert.detail`. Chaque alerte = une ligne-carte en grille (qui · où · urgence) sans
 * code mouvement visible (l'ID reste dans l'infobulle) ; en-têtes de section collants.
 *
 * - Clic sur une ligne → détail du mouvement dans la Base ETP (`etpMovementDeepLink`, ouvre sa
 *   modale d'édition).
 * - Pied de modale → Base ETP, onglet mouvements, restreinte aux mouvements affichés (ids, via
 *   `etpMovementDeepLink`) : même périmètre que le dashboard (programme, filtres, plage).
 * - Compteurs exprimés en mouvements distincts (un mouvement peut porter plusieurs alertes).
 */
export function MovementAlertsSummaryModal({
  open,
  onOpenChange,
  alerts,
  initialKind = null,
  levers,
  programLabels = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alerts: MovementAlert[];
  /** Catégorie ouverte à l'ouverture (clic sur une puce) — `null` = toutes. */
  initialKind?: MovementAlertKind | null;
  /** Libellés du filtre `f_alert` de la Base ETP (`hr.alert.*`) — valeurs passées dans l'URL. */
  /** @deprecated Plus utilisé : le lien "Voir dans la page détaillée" porte désormais les ids
   *  des mouvements affichés (M4), plus les libellés du filtre `f_alert`. */
  kindLabels?: Record<MovementAlertKind, string>;
  levers: Lever[];
  programLabels?: Record<string, string>;
}) {
  const { t, locale } = useTranslation();
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

  // Compteurs en MOUVEMENTS distincts : un mouvement peut porter plusieurs alertes (M4).
  const distinctCount = (items: MovementAlert[]) => alertedMovementIds(items).length;
  const bilan = `${t("hr.alertsModal.summary.totalMovements", "{n} mouvement(s) en alerte").replace(
    "{n}",
    String(distinctCount(alerts))
  )} : ${groups.map((g) => summaryPart(t, g.kind, distinctCount(g.items))).join(", ")}`;

  const openMovement = (id: string) => {
    onOpenChange(false);
    router.push(etpMovementDeepLink([id]));
  };
  // Base ETP restreinte EXACTEMENT aux mouvements affichés (ids) : même périmètre que le
  // dashboard (programme, filtres, plage) — le filtre `f_alert` de la Base ETP recalculait les
  // alertes sur toute l'entreprise, d'où des populations différentes (M4).
  const goToDetailedPage = () => {
    onOpenChange(false);
    router.push(etpMovementDeepLink(alertedMovementIds(visibleGroups.flatMap((g) => g.items))));
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

  const fmtDate = (iso: string | undefined, month: "long" | "short" = "long"): string =>
    formatIsoDate(iso, locale, month) ?? dash;

  const leverLabelOf = (a: MovementAlert): string => {
    const d = a.detail;
    if (d && "leverCode" in d) return `${d.leverCode} — ${d.leverName}`;
    return leverOf(a.movement.leverId);
  };

  /** Pastille d'urgence (colonne de droite) + date contextuelle en petit dessous. */
  const urgency = (a: MovementAlert): { pill: string; pillClass: string; sub: string } | null => {
    const m = a.movement;
    const d = a.detail;
    const planned = t("hr.alertsModal.date.planned", "prévu le {d}").replace(
      "{d}",
      fmtDate(m.plannedDate)
    );
    if (a.kind === "overdue") {
      return {
        pill:
          d?.reason === "overdue"
            ? t("hr.alertsModal.pill.late", "En retard de {n} j").replace("{n}", String(d.daysLate))
            : sectionTitle(t, "overdue"),
        pillClass: "border-bp-coral bg-bp-coral text-white",
        sub: planned,
      };
    }
    if (a.kind === "due") {
      const today = d?.reason === "due" && d.daysLeft === 0;
      return {
        pill: today
          ? t("hr.alertsModal.today", "Aujourd'hui")
          : d?.reason === "due"
            ? t("hr.alertsModal.pill.in", "Dans {n} j").replace("{n}", String(d.daysLeft))
            : sectionTitle(t, "due"),
        pillClass: today
          ? "border-bp-coral-pink bg-bp-coral-pink text-bp-deep-red"
          : "border-bp-light-pink bg-bp-light-pink text-bp-red-brick",
        sub: planned,
      };
    }
    if (a.kind === "toValidate") {
      return {
        pill: sectionTitle(t, "toValidate"),
        pillClass: "border-bp-purple bg-white text-bp-purple",
        sub: t("hr.alertsModal.date.done", "réalisé le {d}").replace(
          "{d}",
          fmtDate(d?.reason === "toValidate" ? d.actualDate : (m.actualDate ?? m.plannedDate))
        ),
      };
    }
    return null;
  };

  /** Désynchronisés : motif court + valeurs comparées « Mouvement : X ↔ Levier : Y ». */
  const mismatch = (a: MovementAlert): { reason: string; mv: string; lv: string } => {
    const m = a.movement;
    const d = a.detail;
    const fte = t("etp.column.fte", "ETP");
    switch (d?.reason) {
      case "leverCancelled":
        return {
          reason: t("hr.alertsModal.reason.leverCancelled", "Levier annulé, mouvement actif"),
          mv: movementStatusLabel(t, m.status),
          lv: t("hr.alertsModal.value.cancelled", "Annulé"),
        };
      case "afterLeverEnd":
        return {
          reason: t("hr.alertsModal.reason.afterLeverEnd", "Prévu après la fin du levier"),
          mv: fmtDate(d.plannedDate, "short"),
          lv: fmtDate(d.leverEnd, "short"),
        };
      case "signMismatch":
        return {
          reason: t("hr.alertsModal.reason.signMismatch", "Sens ETP opposé au levier"),
          mv: fmtFte(d.movementFte, fte),
          lv: fmtFte(d.leverFte, fte),
        };
      default:
        return { reason: movementAlertMessage(t, a), mv: dash, lv: dash };
    }
  };

  const chip = (label: string, value: string) => (
    <span className="inline-flex min-w-0 items-center gap-1 rounded border border-border bg-neutral-50 px-1.5 py-0.5 text-[11px]">
      <span className="shrink-0 text-tertiary">{label} :</span>
      <span className="truncate font-semibold tabular-nums text-primary">{value}</span>
    </span>
  );

  const renderRow = (a: MovementAlert, key: string, isMismatch: boolean) => {
    const m = a.movement;
    const program = m.programId ? (programLabels[m.programId] ?? m.programId) : "";
    const lever = leverLabelOf(a);
    const context = [program, lever !== dash ? lever : ""].filter(Boolean).join(" · ");
    const place = [m.department, m.country].filter(Boolean).join(" · ") || dash;
    const u = urgency(a);
    const mm = isMismatch ? mismatch(a) : null;
    return (
      <li key={key} className="border-t border-border first:border-t-0">
        <button
          type="button"
          onClick={() => openMovement(m.id)}
          title={`${t("hr.movementProgress.openInEtp", "Ouvrir dans la Base ETP")} (${m.id})`}
          className={`group grid w-full grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none ${
            isMismatch
              ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.5fr)_1rem]"
              : "sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_11rem_1rem]"
          }`}
        >
          {/* Qui : nom + type + programme/levier */}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-[13px] font-bold text-primary">{m.label || dash}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-2 py-0.5 text-[10.5px] font-semibold text-secondary">
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full ${TYPE_DOT[m.type as MovementType] ?? "bg-bp-warm-gray"}`}
                />
                {movementTypeLabel(t, m.type)}
              </span>
            </span>
            {context && <span className="truncate text-[11.5px] text-tertiary">{context}</span>}
          </span>

          {/* Où : département · pays */}
          <span className="min-w-0 truncate text-[11.5px] text-tertiary">{place}</span>

          {/* Urgence / écart */}
          {mm ? (
            <span className="flex min-w-0 flex-col gap-1 sm:items-end">
              <span className="text-[11.5px] font-semibold text-bp-red-brick">{mm.reason}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-1 sm:justify-end">
                {chip(t("hr.alertsModal.col.movementValue", "Mouvement"), mm.mv)}
                <span aria-hidden className="text-[11px] text-tertiary">
                  ↔
                </span>
                {chip(t("hr.alertsModal.col.leverValue", "Levier"), mm.lv)}
              </span>
            </span>
          ) : u ? (
            <span className="flex flex-col items-start gap-0.5 sm:items-end">
              <span
                className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold tabular-nums ${u.pillClass}`}
              >
                {u.pill}
              </span>
              <span className="text-[11px] text-tertiary">{u.sub}</span>
            </span>
          ) : (
            <span />
          )}

          <ArrowUpRight
            size={14}
            aria-hidden
            className="hidden text-tertiary transition group-hover:text-bp-coral sm:block"
          />
        </button>
      </li>
    );
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
              {t("hr.alertsModal.tabAll", "Toutes")} · {distinctCount(alerts)}
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
                {sectionTitle(t, g.kind)} · {distinctCount(g.items)}
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
                  className={`sticky top-0 z-10 flex w-full items-center gap-2 bg-white px-4 py-2.5 text-left transition hover:bg-neutral-50 ${
                    isCollapsed ? "rounded-md" : "rounded-t-md border-b border-border"
                  }`}
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
                    className={`min-w-[1.5rem] rounded-full border px-2 py-0.5 text-center text-[11px] font-bold tabular-nums ${KIND_BADGE[g.kind]}`}
                  >
                    {g.items.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <ul>
                    {g.items.map((a, i) =>
                      renderRow(a, `${a.movement.id}-${i}`, g.kind === "leverMismatch")
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
