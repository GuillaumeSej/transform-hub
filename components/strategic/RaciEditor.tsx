"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { UserPicker } from "@/components/strategic/UserPicker";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser, RaciAssignment, RaciLetter } from "@/types";

/**
 * Éditeur RACI (chantier ou livrable, round 4) : une ligne par assignation
 * (`UserPicker` + lettre R/A/C/I + suppression), plus un contrôle « + ajouter ». Entièrement
 * contrôlé (`value`/`onChange`), même contrat que `EffortScoringGrid` — aucun appel Firestore ici,
 * l'appelant (fiche chantier) persiste via `updateChantier`/`updateChantierAction` sur `blur`/submit
 * du formulaire englobant.
 *
 * Le nombre d'utilisateurs d'une entreprise cliente reste modeste (voir `UserPicker`), donc pas de
 * recherche/autocomplete : une ligne = un `<select>` natif, comme partout ailleurs sur ce plan.
 *
 * Indice doux (texte ambre, jamais une erreur) quand aucune ligne n'a la lettre « A » (Autorité) —
 * volontairement non bloquant : le PO n'a pas demandé de validation dure sur ce point (voir plan,
 * section RACI), juste un signal visuel léger. Pas de fonction dédiée dans `lib/axisLogic.ts`, un
 * simple `.some()` suffit.
 */

const LETTERS: RaciLetter[] = ["R", "A", "C", "I"];

const LETTER_LABEL_KEYS: Record<RaciLetter, string> = {
  R: "strategicChantierDetail.raci.responsible",
  A: "strategicChantierDetail.raci.accountable",
  C: "strategicChantierDetail.raci.consulted",
  I: "strategicChantierDetail.raci.informed",
};

const inputClass =
  "w-full rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-bp-coral";

export function RaciEditor({
  users,
  value,
  onChange,
}: {
  users: AuthUser[];
  value: RaciAssignment[];
  onChange: (next: RaciAssignment[]) => void;
}) {
  const { t } = useTranslation();

  const hasAccountable = value.some((a) => a.letter === "A");

  const updateRow = (index: number, patch: Partial<RaciAssignment>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...value, { userId: users[0]?.username ?? "", letter: "R" }]);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-xs text-text-secondary">{t("strategicChantierDetail.raci.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {value.map((row, index) => (
            <li
              // eslint-disable-next-line react/no-array-index-key -- `RaciAssignment` n'a pas d'id propre,
              // l'index de ligne est stable pour ce composant entièrement contrôlé (pas de tri/filtre local).
              key={index}
              className="flex items-center gap-2 rounded-lg border border-border bg-bg-surface px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <UserPicker
                  users={users}
                  value={row.userId || undefined}
                  onChange={(username) => updateRow(index, { userId: username ?? "" })}
                />
              </div>
              <select
                aria-label={t("strategicChantierDetail.raci.letter")}
                value={row.letter}
                onChange={(e) => updateRow(index, { letter: e.target.value as RaciLetter })}
                className={`${inputClass} w-auto shrink-0`}
              >
                {LETTERS.map((letter) => (
                  <option key={letter} value={letter}>
                    {t(LETTER_LABEL_KEYS[letter])}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeRow(index)}
                aria-label={t("strategicChantierDetail.raci.removeRow")}
                title={t("strategicChantierDetail.raci.removeRow")}
                className="shrink-0 rounded p-1 text-text-secondary transition hover:bg-neutral-100 hover:text-bp-coral"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus size={12} /> {t("strategicChantierDetail.raci.addRow")}
      </Button>

      {!hasAccountable && (
        <p className="text-[11px] font-medium text-rag-amber">
          {t("strategicChantierDetail.raci.noAccountableHint")}
        </p>
      )}
    </div>
  );
}
