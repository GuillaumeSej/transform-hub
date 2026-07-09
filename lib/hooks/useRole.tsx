"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { AuthUser, Role } from "@/types";

const USER_KEY = "betrack_user";

type RoleContextValue = {
  /** null = pas de session active, doit passer par /login */
  role: Role | null;
  /** Utilisateur de test connecté (identifiant + nom affiché), null si pas de session. */
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

function readStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  // Lecture synchrone (initialiseur paresseux) plutôt qu'un useEffect : AppShell vérifie `role`
  // dans son propre effet, qui s'exécute AVANT celui d'un useEffect ici (les enfants montent et
  // effectuent leurs effets avant le parent) — un useEffect ici arriverait trop tard et
  // provoquerait une redirection vers /login même avec une session déjà active.
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());

  const login = useCallback((next: AuthUser) => {
    setUser(next);
    window.localStorage.setItem(USER_KEY, JSON.stringify(next));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    window.localStorage.removeItem(USER_KEY);
  }, []);

  return (
    <RoleContext.Provider value={{ role: user?.role ?? null, user, login, logout }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole doit être utilisé dans un <RoleProvider>");
  return ctx;
}
