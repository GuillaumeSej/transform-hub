"use client";

import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  PreviewBar,
  PreviewCard,
  PreviewRow,
  PreviewSection,
  fmtM,
  fmtShare,
  signedM,
} from "@/components/shared/charts/LeverGroupPreview";
import type { PnlLeverContribution } from "@/lib/financePreview";

/**
 * Aperçus au survol des graphiques du module Finance (retour PO, même carte que la « Trajectoire
 * des économies » du dashboard — `PreviewCard` : en-tête, valeurs clés avec marqueur, mini-barres,
 * écart corail si négatif / encre si positif, 3 principaux contributeurs, pied « Cliquer… »). À
 * rendre dans un `FloatingPreview` (portail, jamais rogné par la carte).
 */

/** Couleurs de charte de la répartition engagé / à venir / OPEX récurrent (jamais de vert). */
export const COMMITMENT_COLORS = {
  engaged: "#320300",
  upcoming: "#A99E9A",
  recurring: "#806659",
} as const;

/** Élément d'une liste « Principaux … » : `code` optionnel (levier), affiché en gras. */
export type PreviewListItem = { id: string; code?: string; name: string; value: number };

/** Liste des 3 principaux contributeurs (leviers, chantiers, centres de coût). */
export function PreviewTopList({
  title,
  items,
  format = fmtM,
}: {
  title: string;
  items: PreviewListItem[];
  format?: (v: number) => string;
}) {
  if (items.length === 0) return null;
  return (
    <PreviewSection>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        {title}
      </div>
      <div className="space-y-0.5">
        {items.map((it) => (
          <div key={it.id} className="flex justify-between gap-3">
            <span className="truncate text-secondary">
              {it.code && <span className="font-semibold text-primary">{it.code} · </span>}
              {it.name}
            </span>
            <span
              className={
                it.value < 0
                  ? "shrink-0 tabular-nums text-bp-coral"
                  : "shrink-0 tabular-nums text-primary"
              }
            >
              {format(it.value)}
            </span>
          </div>
        ))}
      </div>
    </PreviewSection>
  );
}

/** Engagé / À venir (/ OPEX récurrent) avec barre empilée proportionnelle. */
export function CommitmentSplit({
  engaged,
  upcoming,
  recurring,
  format = fmtM,
}: {
  engaged: number;
  upcoming: number;
  /** OPEX récurrent annuel — ligne omise si `undefined`. */
  recurring?: number;
  format?: (v: number) => string;
}) {
  const { t } = useTranslation();
  const parts = [
    { key: "engaged", value: engaged, color: COMMITMENT_COLORS.engaged },
    { key: "upcoming", value: upcoming, color: COMMITMENT_COLORS.upcoming },
    ...(recurring !== undefined
      ? [{ key: "recurring", value: recurring, color: COMMITMENT_COLORS.recurring }]
      : []),
  ];
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <>
      <div className="space-y-1">
        <PreviewRow
          color={COMMITMENT_COLORS.engaged}
          label={t("finance.chart.engaged", "Déjà engagé")}
          value={format(engaged)}
        />
        <PreviewRow
          color={COMMITMENT_COLORS.upcoming}
          label={t("finance.chart.upcoming", "À venir")}
          value={format(upcoming)}
        />
        {recurring !== undefined && (
          <PreviewRow
            color={COMMITMENT_COLORS.recurring}
            label={t("finance.preview.recurringOpex", "OPEX récurrent (annuel)")}
            value={format(recurring)}
          />
        )}
      </div>
      {total > 0 && (
        <div className="mt-2 flex h-1.5 bg-neutral-100">
          {parts.map((p) =>
            p.value > 0 ? (
              <div
                key={p.key}
                className="h-full"
                style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }}
              />
            ) : null
          )}
        </div>
      )}
    </>
  );
}

/** Aperçu d'une part de donut de coûts : montant, part du total, engagé vs à venir, principaux
 *  contributeurs, consigne de clic (les parts descendent d'un niveau ou ouvrent le détail). */
export function CostSlicePreview({
  name,
  subtitle,
  value,
  share,
  color,
  split,
  top,
  clickHint,
  format = fmtM,
}: {
  name: string;
  subtitle?: string;
  value: number;
  share: number | null;
  color: string;
  split?: { engaged: number; upcoming: number; recurring?: number };
  top?: { title: string; items: PreviewListItem[] };
  clickHint?: string;
  format?: (v: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <PreviewCard title={name} subtitle={subtitle} clickHint={clickHint}>
      <div className="space-y-1">
        <PreviewRow
          color={color}
          label={t("finance.preview.amount", "Montant")}
          value={format(value)}
          strong
        />
        <PreviewRow
          label={t("finance.preview.shareOfTotal", "Part du total")}
          value={fmtShare(share)}
        />
      </div>
      <div className="mt-2">
        <PreviewBar pct={share ?? 0} />
      </div>
      {split && (
        <PreviewSection>
          <CommitmentSplit {...split} format={format} />
        </PreviewSection>
      )}
      {top && <PreviewTopList title={top.title} items={top.items} format={format} />}
    </PreviewCard>
  );
}

/** Aperçu d'un compte de « Impact P&L par compte » : planifié initial / réactualisé / réalisé sur
 *  la période et la base affichées (base annuelle ou effet sur la période, comme la page), écart
 *  réalisé − plan et principaux leviers en écart. */
export function PnlAccountPreview({
  account,
  subtitle,
  plan,
  reforecast,
  realized,
  contributors,
  labels,
  clickHint,
}: {
  account: string;
  subtitle?: string;
  plan: number;
  reforecast?: number;
  realized: number;
  contributors?: PnlLeverContribution[];
  labels: { plan: string; reforecast: string; realized: string };
  clickHint?: string;
}) {
  const { t } = useTranslation();
  const round = (v: number) => Math.round(v * 10_000) / 10_000;
  const max = Math.max(Math.abs(plan), Math.abs(reforecast ?? 0), Math.abs(realized), 1e-9);
  const pct = (v: number) => (Math.abs(v) / max) * 100;
  const gap = round(realized - plan);
  const gapForecast = reforecast !== undefined ? round(reforecast - plan) : null;
  const top = (contributors ?? []).filter((c) => c.value !== 0).slice(0, 3);
  const gapClass = (v: number) =>
    v < 0 ? "font-bold tabular-nums text-bp-coral" : "font-bold tabular-nums text-primary";
  return (
    <PreviewCard title={account} subtitle={subtitle} clickHint={clickHint}>
      <div className="space-y-1">
        <PreviewRow color="#A99E9A" label={labels.plan} value={fmtM(plan)} />
        {reforecast !== undefined && (
          <PreviewRow color="#320300" label={labels.reforecast} value={fmtM(reforecast)} />
        )}
        <PreviewRow color="#FF3C47" label={labels.realized} value={fmtM(realized)} strong />
      </div>
      <div className="mt-2 space-y-1">
        <PreviewBar pct={pct(plan)} className="bg-bp-warm-brown/60" />
        {reforecast !== undefined && (
          <PreviewBar pct={pct(reforecast)} className="bg-bp-deep-red/70" />
        )}
        <PreviewBar pct={pct(realized)} />
      </div>
      <PreviewSection>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-primary">
            {t("chart.scurvePreview.gap", "Écart réalisé − plan")}
          </span>
          <span className={gapClass(gap)}>{gap === 0 ? fmtM(0) : signedM(gap)}</span>
        </div>
        {gapForecast !== null && (
          <div className="mt-1 flex justify-between gap-3 text-[11px] text-secondary">
            <span>{t("chart.scurvePreview.gapForecast", "Écart prévu (réactualisé − plan)")}</span>
            <span className={gapForecast < 0 ? "tabular-nums text-bp-coral" : "tabular-nums"}>
              {gapForecast === 0 ? fmtM(0) : signedM(gapForecast)}
            </span>
          </div>
        )}
      </PreviewSection>
      <PreviewTopList
        title={t("chart.scurvePreview.topLevers", "Principaux écarts")}
        items={top}
        format={(v) => (v === 0 ? fmtM(0) : signedM(v))}
      />
    </PreviewCard>
  );
}
