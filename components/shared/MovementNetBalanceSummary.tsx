"use client";

import { formatSignedFr, type MovementNetBalance } from "@/lib/hrMovementBalance";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Violet BearingPoint = effectif en hausse, rouge corail = effectif en baisse (charte : ni vert
 *  ni orange). */
export const NET_POSITIVE_COLOR = "#421799";
export const NET_NEGATIVE_COLOR = "#FF3C47";

export function netBalanceColor(value: number): string | undefined {
  if (value > 0) return NET_POSITIVE_COLOR;
  if (value < 0) return NET_NEGATIVE_COLOR;
  return undefined;
}

/**
 * Bandeau "Bilan net" d'une liste de mouvements (entrées, sorties, transferts, net ETP signé et
 * coloré). Affiché en tête des modales de drill-down et dans l'infobulle de `MovementRhythmChart`.
 * Pur affichage : le calcul vit dans `lib/hrMovementBalance.ts::movementNetBalance`.
 */
export function MovementNetBalanceSummary({
  balance,
  compact = false,
}: {
  balance: MovementNetBalance;
  /** Variante infobulle : moins de padding, pas de fond. */
  compact?: boolean;
}) {
  const { t, locale } = useTranslation();
  const fmt = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  const etp = t("etp.column.fte", "ETP");
  const { entries, exits, transfersIn, transfersOut, netFte, netHeadcount } = balance;
  const hasTransfers = transfersIn.count > 0 || transfersOut.count > 0;
  // Le net en personnes n'apporte rien quand il coïncide avec le net ETP (temps plein partout).
  const showHeadcount = netHeadcount !== netFte;

  const flowLine = (label: string, count: number, fte: number) =>
    `${label} : ${count} (${fmt(fte)} ${etp})`;

  return (
    <div
      className={
        compact
          ? "text-[11px] leading-snug"
          : "rounded-md border border-border bg-neutral-50 px-3 py-2 text-[12px] leading-snug"
      }
    >
      <div className="text-[12.5px] font-bold" style={{ color: netBalanceColor(netFte) }}>
        {t("hr.netBalance.title", "Bilan net")} : {formatSignedFr(netFte, locale)} {etp}
        {showHeadcount && (
          <span className="ml-1 font-semibold">
            ({formatSignedFr(netHeadcount, locale)} {t("hr.netBalance.people", "pers.")})
          </span>
        )}
      </div>
      <div className="mt-0.5 text-secondary">
        {flowLine(t("hr.netBalance.entries", "Entrées (recrutements)"), entries.count, entries.fte)}
        {" · "}
        {flowLine(
          t("hr.netBalance.exits", "Sorties (attrition + départs forcés)"),
          exits.count,
          exits.fte
        )}
      </div>
      {hasTransfers && (
        <div className="text-tertiary">
          {t(
            "hr.netBalance.transfers",
            "Transferts : {in} entrant(s) · {out} sortant(s) — neutres sur le net"
          )
            .replace("{in}", String(transfersIn.count))
            .replace("{out}", String(transfersOut.count))}
        </div>
      )}
      {balance.abandonedCount > 0 && (
        <div className="text-tertiary">
          {t("hr.netBalance.abandoned", "{n} mouvement(s) abandonné(s) exclu(s) du bilan").replace(
            "{n}",
            String(balance.abandonedCount)
          )}
        </div>
      )}
    </div>
  );
}
