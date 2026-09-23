"use client";

import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Dropdown } from "@/components/shared/Dropdown";
import { MultiSelect } from "@/components/shared/MultiSelect";
import type {
  FilterDef,
  MultiActiveFilters,
  SingleActiveFilters,
} from "@/components/shared/FilterBar";

/**
 * === API MULTI-SÉLECTION (à adopter par la page Leviers) ===
 * Passer `multiple` : `active: Record<string, string[]>` (MultiActiveFilters), `onChange` reçoit
 * le même type. Sélection vide/absente = pas de filtre ; chaque dimension est un `MultiSelect`
 * (cases à cocher, "Tout sélectionner"/"Effacer", résumé "Statut (2)"). État + URL via
 * `useMultiFilterBarState(defs, { namespace? })` (lib/hooks/useMultiFilterBarState.ts, valeurs
 * sérialisées en virgules, anciennes valeurs simples relues). Filtrage : `matchesFilter(value,
 * selected)` de `lib/filterUtils.ts`. Sans `multiple`, l'ancien comportement mono-sélection
 * (`SingleActiveFilters`, `useFilterBarState`) est conservé tel quel pour compatibilité.
 * Ce qui suit est l'historique du composant mono-sélection.
 *
 * Remplaçant "drop-in" de `FilterBar.tsx` (chips empilées en deux rangées, jugées peu lisibles —
 * demande produit explicite : "pas clean, on s'y retrouve pas du tout, c'est assez compliqué") par
 * le même motif de `Dropdown` (bouton carte + panneau, `allowClear` → "Tous") déjà utilisé sur les
 * pages Plan Stratégique (voir `StrategicDashboardView.tsx`, section feuille de route programme).
 *
 * CHANGEMENT DE COMPORTEMENT (assumé, demande produit) : `FilterBar` autorisait plusieurs valeurs
 * cochées PAR dimension (chips multi-select, ex. Workstream = APAC + EMEA). `Dropdown` est un
 * composant à sélection UNIQUE (`value: string | null`) — on ne réplique donc PAS le multi-select
 * ici. Chaque dimension de `defs` devient UN `Dropdown` isolé, 0 ou 1 valeur active ("Tous" =
 * aucune restriction sur cette dimension). Plusieurs `Dropdown` combinés restent en ET logique,
 * comme les filtres Axe/Chantier/Responsable de la feuille de route Plan Stratégique. L'état
 * `active` change donc de forme : `Record<string, string[]>` (FilterBar) → `Record<string, string
 * | null>` (ici, voir `SingleActiveFilters` dans `FilterBar.tsx`) — les 4 pages appelantes ont été
 * migrées en conséquence (leur logique de filtrage downstream aussi).
 *
 * `defs`/`items` réutilisent exactement la forme déjà en place pour `FilterBar` (`FilterDef<T>` —
 * `key`/`label`/`getValue`) : les options de chaque `Dropdown` sont dérivées des valeurs présentes
 * dans `items` pour ce `getValue`, comme le faisait `FilterBar`.
 *
 * Rangée unique responsive (`flex-wrap`) : contrairement à `FilterBar` (qui était rendu deux fois
 * par page appelante — une version repliée sous bouton pour mobile, une version toujours visible
 * pour desktop, car la double rangée de chips prenait trop de place sur petit écran), un `Dropdown`
 * est déjà compact (bouton fixe ~200px) et n'a pas besoin de ce repli : un simple `flex-wrap` reste
 * lisible sur mobile (les dropdowns passent à la ligne).
 */
type Common<T> = {
  items: T[];
  defs: FilterDef<T>[];
  className?: string;
};
type SingleProps = {
  multiple?: false;
  active: SingleActiveFilters;
  onChange: (next: SingleActiveFilters) => void;
};
type MultiProps = {
  multiple: true;
  active: MultiActiveFilters;
  onChange: (next: MultiActiveFilters) => void;
};

export function DropdownFilterBar<T>(props: Common<T> & (SingleProps | MultiProps)) {
  const { items, defs, className } = props;
  const { t } = useTranslation();

  const optionsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const def of defs) {
      map[def.key] = Array.from(new Set(items.map((i) => def.getValue(i)).filter(Boolean))).sort();
    }
    return map;
  }, [items, defs]);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      {defs.map((def) => {
        const options = (optionsMap[def.key] ?? []).map((opt) => ({
          value: opt,
          label: def.formatValue ? def.formatValue(opt) : opt,
        }));
        if (props.multiple) {
          const { active, onChange } = props;
          return (
            <MultiSelect
              key={def.key}
              label={def.label}
              placeholder={t("kpi.filterAll", "Tous")}
              values={active[def.key] ?? []}
              onChange={(vals) => {
                const next = { ...active };
                if (vals.length === 0) delete next[def.key];
                else next[def.key] = vals;
                onChange(next);
              }}
              options={options}
            />
          );
        }
        const { active, onChange } = props;
        return (
          <Dropdown
            key={def.key}
            label={def.label}
            placeholder={t("kpi.filterAll", "Tous")}
            value={active[def.key] ?? null}
            onChange={(value) => {
              const next = { ...active };
              if (value === null) delete next[def.key];
              else next[def.key] = value;
              onChange(next);
            }}
            options={options}
            allowClear
          />
        );
      })}
    </div>
  );
}
