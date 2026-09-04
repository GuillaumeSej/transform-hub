"use client";

import type { AuthUser } from "@/types";

/**
 * Sélecteur de personne, réutilisé partout où le Plan Stratégique référence un utilisateur nommé
 * (round 4) : owner/sponsor d'action, sponsor/pilote de chantier, lignes RACI. Value/onChange
 * portent l'`AuthUser.username` (jamais l'uid Firebase ni le nom affiché) — même convention que
 * `Indicator.additionalAuthorizedUserIds` (voir `canFillIndicator`, lib/axisLogic.ts) : c'est la
 * clé "métier" déjà utilisée partout ailleurs dans l'app pour référencer une personne.
 *
 * Volontairement un simple `<select>` HTML (comme `ChantierForm`/`AxisForm`), pas un composant de
 * recherche : les entreprises clientes de ce plan comptent au plus quelques dizaines
 * d'utilisateurs, un menu déroulant natif reste la solution la plus simple et la plus accessible.
 *
 * Défensif à l'égard des valeurs saisies AVANT la conversion round 4 de `owner` (texte libre → ce
 * sélecteur) : une `value` qui ne correspond à AUCUN `AuthUser.username` connu (texte libre
 * historique, ou utilisateur depuis retiré de l'entreprise) n'a normalement AUCUNE `<option>`
 * correspondante — un `<select>` HTML retombe alors silencieusement sur la première option
 * (`placeholder`), ce qui EFFACERAIT la valeur stockée au premier `onChange` déclenché par un tout
 * autre champ du formulaire, sans que l'utilisateur l'ait demandé. On injecte donc une option
 * supplémentaire portant la valeur brute telle quelle (préfixée pour rester lisible), plutôt que de
 * planter ou de la faire disparaître silencieusement.
 */
export function UserPicker({
  users,
  value,
  onChange,
  placeholder,
  label,
  id,
}: {
  users: AuthUser[];
  /** `AuthUser.username`, ou `undefined` pour "non assigné". */
  value: string | undefined;
  onChange: (username: string | undefined) => void;
  /** Libellé de l'option vide — par défaut "Non assigné" (voir `strategicAxes.unassigned`, seul
   *  précédent de ce libellé dans l'app). */
  placeholder?: string;
  /** Libellé de champ optionnel — omis quand `UserPicker` est monté sans son propre `<label>`
   *  (ex. une cellule de tableau RACI, où le contexte de la colonne suffit). */
  label?: string;
  id?: string;
}) {
  const knownValue = value ? users.some((u) => u.username === value) : true;

  return (
    <div>
      {label && (
        <label className="text-xs font-medium text-text-secondary" htmlFor={id}>
          {label}
        </label>
      )}
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
        className={`${label ? "mt-1 " : ""}w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral`}
      >
        <option value="">{placeholder ?? "Non assigné"}</option>
        {!knownValue && value && <option value={value}>{value} (non reconnu)</option>}
        {users.map((u) => (
          <option key={u.username} value={u.username}>
            {u.name || `${u.firstName} ${u.lastName}`.trim()}
          </option>
        ))}
      </select>
    </div>
  );
}
