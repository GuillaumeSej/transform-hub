"use client";

import type { ReactNode } from "react";
import { formatSignedFr, type MovementNetBalance } from "@/lib/hrMovementBalance";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Violet BearingPoint = effectif en hausse, rouge corail = effectif en baisse (charte : ni vert
 *  ni orange). */
export const NET_POSITIVE_COLOR = "#421799";
export const NET_NEGATIVE_COLOR = "#FF3C47";

/** Taupe de la charte (couleur des séries « transferts » dans les graphiques) — le bilan transferts
 *  garde toujours cette couleur pour ne pas être confondu avec le bilan net violet/corail. */
const TRANSFER_COLOR = "#806659";

export function netBalanceColor(value: number): string | undefined {
  if (value > 0) return NET_POSITIVE_COLOR;
  if (value < 0) return NET_NEGATIVE_COLOR;
  return undefined;
}

/**
 * Bandeau "Bilan net" d'une liste de mouvements (entrées, sorties, net ETP signé et coloré — hors
 * transferts), suivi d'un bloc "Bilan transferts" visuellement séparé (entrants, sortants, solde),
 * affiché seulement s'il y a des transferts. Affiché en tête des modales de drill-down et dans les
 * infobulles de `MovementRhythmChart` / `DepartmentMovementsChart`.
 * Pur affichage : le calcul vit dans `lib/hrMovementBalance.ts::movementNetBalance`.
 */
export function MovementNetBalanceSummary({
  balance,
  compact = false,
  netFooter,
}: {
  balance: MovementNetBalance;
  /** Variante infobulle : moins de padding, pas de fond. */
  compact?: boolean;
  /** Ligne complémentaire rattachée au bilan net (ex. cumul net d'une période), rendue AVANT le
   *  bloc transferts pour rester visuellement du côté « net ». */
  netFooter?: ReactNode;
}) {
  const { t, locale } = useTranslation();
  const fmt = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  const etp = t("etp.column.fte", "ETP");
  const { entries, exits, transfersIn, transfersOut, transferNetFte, netFte, netHeadcount } =
    balance;
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
      {balance.abandonedCount > 0 && (
        <div className="text-tertiary">
          {t("hr.netBalance.abandoned", "{n} mouvement(s) abandonné(s) exclu(s) du bilan").replace(
            "{n}",
            String(balance.abandonedCount)
          )}
        </div>
      )}
      {netFooter}
      {hasTransfers && (
        <div
          className={`mt-1.5 border-t border-dashed border-border pt-1.5 ${compact ? "" : "-mx-3 px-3"}`}
        >
          <div className="text-[12px] font-bold" style={{ color: TRANSFER_COLOR }}>
            {t("hr.transferBalance.title", "Bilan transferts")} :{" "}
            {formatSignedFr(transferNetFte, locale)} {etp}
          </div>
          <div className="mt-0.5 text-secondary">
            {flowLine(
              t("hr.transferBalance.in", "Transferts entrants"),
              transfersIn.count,
              transfersIn.fte
            )}
            {" · "}
            {flowLine(
              t("hr.transferBalance.out", "Transferts sortants"),
              transfersOut.count,
              transfersOut.fte
            )}
          </div>
          <div className="italic text-tertiary">
            {t("hr.transferBalance.note", "Non comptés dans le bilan net ETP — suivis à part")}
          </div>
        </div>
      )}
    </div>
  );
}
