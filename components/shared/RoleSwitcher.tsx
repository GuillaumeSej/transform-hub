"use client";

import { useRole } from "@/lib/hooks/useRole";
import { roles } from "@/lib/nav-config";
import type { Role } from "@/types";

/** Sélecteur de persona — remplace l'écran de login du prototype legacy (pas d'auth réelle). */
export function RoleSwitcher() {
  const { role, setRole } = useRole();

  return (
    <select
      value={role}
      onChange={(e) => setRole(e.target.value as Role)}
      className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-primary focus:border-bp-coral focus:outline-none focus:ring-2 focus:ring-bp-coral/20"
      aria-label="Changer de persona"
    >
      {Object.entries(roles).map(([key, def]) => (
        <option key={key} value={key}>
          {def.label}
        </option>
      ))}
    </select>
  );
}
