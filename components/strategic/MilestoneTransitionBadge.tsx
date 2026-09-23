"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { displayMilestoneId, type MilestoneTransitionState } from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser, MilestoneId } from "@/types";

/**
 * Pastilles d'état de TRANSITION de jalon d'un projet (round "passage de jalon explicite") — voir
 * `milestoneTransitionState` (lib/axisLogic.ts). Partagées par la carte projet de "Projets du
 * chantier", la check-list du projet (`MilestoneChecklistPanel`) et la carte du tableau jalons
 * (`ProjetMilestoneBoard`), pour qu'un même état se lise pareil partout :
 *  - `"pending"` → « En attente de confirmation » (corail-rose, horloge) + qui/quand ;
 *  - `"ready"`   → « Check-list J1 complète » (le passage en J2 reste à demander).
 * Rien n'est rendu pour `"in_progress"`/`"final"`.
 */

function displayName(username: string, users?: Pick<AuthUser, "username" | "name">[]): string {
  return users?.find((u) => u.username === username)?.name || username;
}

export function formatPendingMeta(
  t: (key: string, fallback?: string) => string,
  locale: string,
  state: Extract<MilestoneTransitionState, { status: "pending" }>,
  users?: Pick<AuthUser, "username" | "name">[]
): string {
  let date = state.requestedAt;
  try {
    date = new Date(state.requestedAt).toLocaleDateString(locale);
  } catch {
    // date ISO brute en repli
  }
  return t(
    "strategicChantierDetail.milestones.transition.requestedMeta",
    "Demandé par {user} le {date}"
  )
    .replace("{user}", displayName(state.requestedBy, users))
    .replace("{date}", date);
}

/** Libellé court « En attente de confirmation · J2 » (réutilisé en infobulle Gantt). */
export function pendingTransitionLabel(
  t: (key: string, fallback?: string) => string,
  to: MilestoneId
): string {
  return `${t("strategicChantierDetail.milestones.transition.pending", "En attente de confirmation")} · ${displayMilestoneId(to)}`;
}

export function MilestoneTransitionBadge({
  state,
  users,
  compact = false,
}: {
  state: MilestoneTransitionState;
  users?: Pick<AuthUser, "username" | "name">[];
  /** `true` : pastille seule, qui/quand en infobulle (cartes denses). */
  compact?: boolean;
}) {
  const { t, locale } = useTranslation();
  if (state.status === "pending") {
    const meta = formatPendingMeta(t, locale, state, users);
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span
          title={meta}
          className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-bp-coral-pink px-2 py-0.5 text-[10.5px] font-semibold text-bp-deep-red"
        >
          <Clock size={11} aria-hidden />
          {pendingTransitionLabel(t, state.to)}
        </span>
        {!compact && <span className="text-[10.5px] text-tertiary">{meta}</span>}
      </span>
    );
  }
  if (state.status === "ready") {
    return (
      <span
        title={t(
          "strategicChantierDetail.milestones.transition.readyHint",
          "Le passage en {milestone} peut être demandé"
        ).replace("{milestone}", displayMilestoneId(state.to))}
        className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-rag-green bg-rag-green-light px-2 py-0.5 text-[10.5px] font-semibold text-rag-green-dark"
      >
        <CheckCircle2 size={11} aria-hidden />
        {t(
          "strategicChantierDetail.milestones.transition.ready",
          "Check-list {milestone} complète"
        ).replace("{milestone}", displayMilestoneId(state.from))}
      </span>
    );
  }
  return null;
}
