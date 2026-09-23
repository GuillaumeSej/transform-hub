import type { WorkforceMovement } from "@/types";
import { isActiveMovement } from "@/lib/workforceLogic";
import { targetMovementFteImpact } from "@/lib/hrProgramSummary";

/**
 * Bilan net d'une liste de mouvements — alimente la ligne "Bilan net : ±N ETP" des infobulles
 * (`MovementRhythmChart`) et des modales de drill-down (`MovementDrilldownModal`,
 * `MovementDetailDrilldownModal`).
 *
 * Conventions alignées sur `movementRhythmSeries` (lib/hrTimeSeries.ts) et le KPI Impact ETP
 * (`targetMovementFteImpact`, lib/hrProgramSummary.ts) :
 *   - ETP cible = `lockedPlan.fte` si présent, sinon `fte` ;
 *   - mouvements "Abandonné" exclus ;
 *   - entrées = Recrutements, sorties = Attrition + Départs forcés ;
 *   - transferts entrants/sortants comptés à part : neutres sur l'effectif total, donc exclus du net.
 */
export type MovementFlow = { count: number; fte: number };

export type MovementNetBalance = {
  /** Recrutements. */
  entries: MovementFlow;
  /** Attrition + Départs forcés. */
  exits: MovementFlow;
  transfersIn: MovementFlow;
  transfersOut: MovementFlow;
  /** Net ETP cible (entrées − sorties), transferts neutralisés — arrondi à 0,1. */
  netFte: number;
  /** Net en nombre de personnes (entrées − sorties), distinct du net ETP en cas de temps partiel. */
  netHeadcount: number;
  /** Mouvements abandonnés présents dans la liste mais exclus du bilan. */
  abandonedCount: number;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function movementNetBalance(movements: WorkforceMovement[]): MovementNetBalance {
  const flow = (): MovementFlow => ({ count: 0, fte: 0 });
  const entries = flow();
  const exits = flow();
  const transfersIn = flow();
  const transfersOut = flow();
  let netFte = 0;
  let abandonedCount = 0;

  for (const m of movements) {
    if (!isActiveMovement(m)) {
      abandonedCount += 1;
      continue;
    }
    const fte = m.lockedPlan?.fte ?? m.fte;
    const target =
      m.type === "Recrutement"
        ? entries
        : m.type === "Attrition" || m.type === "Départ forcé"
          ? exits
          : m.type === "Transfert entrant"
            ? transfersIn
            : transfersOut;
    target.count += 1;
    target.fte += fte;
    netFte += targetMovementFteImpact(m);
  }

  for (const f of [entries, exits, transfersIn, transfersOut]) f.fte = round1(f.fte);

  return {
    entries,
    exits,
    transfersIn,
    transfersOut,
    netFte: round1(netFte) || 0,
    netHeadcount: entries.count - exits.count,
    abandonedCount,
  };
}

/** Valeur signée : « +3 », « −2,5 », « 0 ». Format français par défaut ; passer la locale active
 *  (`useTranslation().locale`) pour le séparateur décimal de la langue affichée. */
export function formatSignedFr(value: number, locale: string = "fr-FR"): string {
  const abs = Math.abs(value).toLocaleString(locale, { maximumFractionDigits: 1 });
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}
