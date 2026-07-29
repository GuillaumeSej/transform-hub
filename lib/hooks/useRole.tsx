"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { resolveAuthUserProfile } from "@/lib/auth";
import type { AuthUser, Role } from "@/types";

type RoleContextValue = {
  /** null = pas de session active, doit passer par /login */
  role: Role | null;
  /** Utilisateur connecté (identifiant + profil), null si pas de session. */
  user: AuthUser | null;
  /** true tant que Firebase n'a pas fini de résoudre une éventuelle session existante au premier
   *  chargement (onAuthStateChanged est asynchrone) — AppShell doit attendre ce délai avant de
   *  décider de rediriger vers /login, sous peine de rejeter un utilisateur déjà connecté. */
  loading: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Source de vérité de la session : Firebase Auth (via onAuthStateChanged), plus localStorage.
  // Au premier montage, Firebase n'a pas encore confirmé une éventuelle session persistée d'une
  // visite précédente — `loading` reste true jusqu'au premier appel du callback (voir AppShell,
  // qui n'agit sur `role` qu'une fois `loading` retombé à false).
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser?.email) {
        setUser(null);
        setLoading(false);
        return;
      }
      // Le username applicatif n'est pas stocké tel quel sur le compte Firebase : on le retrouve
      // depuis l'e-mail synthétique `${username}@betrack.local` (voir usernameToSyntheticEmail).
      const username = firebaseUser.email.split("@")[0];
      try {
        const profile = await resolveAuthUserProfile(username);
        setUser(profile);
      } catch {
        // Compte Firebase Auth valide mais sans profil Firestore correspondant (ou Firestore
        // injoignable) — pas de session applicative exploitable, retour à /login.
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  // La connexion Firebase (signInWithEmailAndPassword) a déjà eu lieu dans lib/auth.ts
  // (signInUser), appelé par app/login/page.tsx avant login(). login() ici ne fait donc que
  // pousser le profil déjà résolu dans l'état local, pour un affichage immédiat sans attendre le
  // prochain déclenchement (redondant mais plus lent) de l'effet onAuthStateChanged ci-dessus.
  const login = useCallback((next: AuthUser) => {
    setUser(next);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    void signOut(auth);
  }, []);

  return (
    <RoleContext.Provider value={{ role: user?.role ?? null, user, loading, login, logout }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole doit être utilisé dans un <RoleProvider>");
  return ctx;
}
