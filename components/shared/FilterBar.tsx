"use client";

import { useMemo } from "react";
import { X } from "lucide-react";

export type FilterDef<T> = {
  key: string;
  label: string;
  getValue: (item: T) => string;
};

export type ActiveFilters = Record<string, string[]>;

export function FilterBar<T>({
  items,
  defs,
  active,
  onChange,
}: {
  items: T[];
  defs: FilterDef<T>[];
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
}) {
  const optionsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const def of defs) {
      map[def.key] = Array.from(
        new Set(items.map((i) => def.getValue(i)).filter(Boolean))
      ).sort();
    }
    return map;
  }, [items, defs]);

  const activeKeys = new Set(Object.keys(active));

  const toggleFilter = (key: string) => {
    if (activeKeys.has(key)) {
      const next = { ...active };
      delete next[key];
      onChange(next);
    } else {
      onChange({ ...active, [key]: optionsMap[key] ?? [] });
    }
  };

  const toggleValue = (key: string, value: string) => {
    const current = active[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    if (next.length === 0) {
      const updated = { ...active };
      delete updated[key];
      onChange(updated);
    } else {
      onChange({ ...active, [key]: next });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {defs.map((def) => {
          const isActive = activeKeys.has(def.key);
          return (
            <button
              key={def.key}
              onClick={() => toggleFilter(def.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? "border-bp-coral bg-bp-coral text-white"
                  : "border-border bg-white text-secondary hover:border-black"
              }`}
            >
              {def.label}
            </button>
          );
        })}

        {activeKeys.size > 0 && (
          <button
            onClick={() => onChange({})}
            className="text-xs font-medium text-bp-coral hover:underline"
          >
            Tout effacer
          </button>
        )}
      </div>

      {activeKeys.size > 0 && (
        <div className="space-y-2 border-t border-border pt-2">
          {defs
            .filter((def) => activeKeys.has(def.key))
            .map((def) => {
              const selected = active[def.key] ?? [];
              const options = optionsMap[def.key] ?? [];
              return (
                <div key={def.key} className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-[90px] text-xs font-medium text-tertiary">
                    {def.label} :
                  </span>
                  {options.map((opt) => {
                    const isSelected = selected.includes(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => toggleValue(def.key, opt)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          isSelected
                            ? "border-bp-coral/40 bg-bp-coral/[0.07] text-primary font-medium"
                            : "border-border bg-white text-secondary hover:border-black"
                        }`}
                      >
                        {opt}
                        {isSelected && <X size={10} className="text-tertiary" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
