"use client";

import { Avatar } from "@/components/shared/Avatar";
import { Tooltip } from "@/components/shared/Tooltip";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser, RaciAssignment, RaciLetter } from "@/types";

/**
 * Affichage RACI compact en lecture seule (round 4) : une ligne par lettre R/A/C/I (omise si
 * vide), avatars empilés des personnes assignées. Compagnon de `RaciEditor` pour les contextes en
 * « coup d'œil » (ex. résumé d'en-tête) plutôt que la liste éditable complète.
 *
 * Aucune interaction ici — l'édition passe toujours par `RaciEditor`.
 */

const LETTERS: RaciLetter[] = ["R", "A", "C", "I"];

const LETTER_LABEL_KEYS: Record<RaciLetter, string> = {
  R: "strategicChantierDetail.raci.responsible",
  A: "strategicChantierDetail.raci.accountable",
  C: "strategicChantierDetail.raci.consulted",
  I: "strategicChantierDetail.raci.informed",
};

/** Mêmes règles que `Topbar.tsx` (2 initiales max, majuscules) — pas de helper partagé exporté
 *  côté `Topbar`, on réplique ici plutôt que d'introduire un couplage vers un composant de layout. */
function initialsFor(user: AuthUser): string {
  const display = user.name || `${user.firstName} ${user.lastName}`.trim();
  return (
    display
      .split(" ")
      .map((x) => x[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function RaciChips({ users, value }: { users: AuthUser[]; value: RaciAssignment[] }) {
  const { t } = useTranslation();

  const byUsername = new Map(users.map((u) => [u.username, u]));

  const rows = LETTERS.map((letter) => ({
    letter,
    // Une cible supprimée (utilisateur retiré de l'entreprise) est silencieusement ignorée —
    // jamais d'exception, même parti pris que `canStartAction` pour les cibles disparues.
    people: value
      .filter((a) => a.letter === letter)
      .flatMap((a) => {
        const user = byUsername.get(a.userId);
        return user ? [user] : [];
      }),
  })).filter((row) => row.people.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-1">
      {rows.map(({ letter, people }) => (
        <div key={letter} className="flex items-center gap-1.5">
          <span
            title={t(LETTER_LABEL_KEYS[letter])}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-neutral-50 text-[10px] font-bold text-text-secondary"
          >
            {letter}
          </span>
          <div className="flex -space-x-1.5">
            {people.map((user) => (
              <Tooltip key={user.username} text={user.name || user.username}>
                <Avatar initials={initialsFor(user)} size="sm" className="ring-2 ring-white" />
              </Tooltip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
