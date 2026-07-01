"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Role } from "@/types";

const ROLE_KEY = "betrack_role";

type RoleContextValue = {
  /** null = pas de session active, doit passer par /login */
  role: Role | null;
  login: (role: Role) => void;
  logout: () => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  // Lecture synchrone (initialiseur paresseux) plutôt qu'un useEffect : AppShell vérifie `role`
  // dans son propre effet, qui s'exécute AVANT celui d'un useEffect ici (les enfants montent et
  // effectuent leurs effets avant le parent) — un useEffect ici arriverait trop tard et
  // provoquerait une redirection vers /login même avec une session déjà active.
  const [role, setRoleState] = useState<Role | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ROLE_KEY) as Role | null;
  });

  const login = useCallback((next: Role) => {
    setRoleState(next);
    window.localStorage.setItem(ROLE_KEY, next);
  }, []);

  const logout = useCallback(() => {
    setRoleState(null);
    window.localStorage.removeItem(ROLE_KEY);
  }, []);

  return <RoleContext.Provider value={{ role, login, logout }}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole doit être utilisé dans un <RoleProvider>");
  return ctx;
}
