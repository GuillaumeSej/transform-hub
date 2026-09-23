"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getAuthInstance } from "@/lib/firebase";
import { accountSlugFromEmail, resolveAuthUserProfile } from "@/lib/auth";
import type { AuthUser, ProfileAssignment, Role } from "@/types";

type RoleContextValue = {
  /** Round multi-profils : le "premier" rôle métier de l'utilisateur, pour l'affichage simple
   *  (ex. libellé dans la Sidebar) uniquement — PAS pour des vérifications de permission (un
   *  utilisateur peut avoir 0, 1 ou 2 profils ; utiliser `profiles`/`isGlobalAdmin`/
   *  `isCompanyAdmin`, ou `lib/roleProfiles.ts`, pour toute décision d'accès).
   *  null = pas de session active, doit passer par /login, OU utilisateur sans profil métier
   *  (ex. compte admin_entreprise pur). */
  role: Role | null;
  /** Tous les profils métier de l'utilisateur (round multi-profils — voir types/index.ts). */
  profiles: ProfileAssignment[];
  /** Super-admin global (toutes entreprises). */
  isGlobalAdmin: boolean;
  /** Admin de sa propre entreprise (additif aux profils métier). */
  isCompanyAdmin: boolean;
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
    const unsub = onAuthStateChanged(getAuthInstance(), async (firebaseUser) => {
      if (!firebaseUser?.email) {
        setUser(null);
        setLoading(false);
        return;
      }
      // L'accountSlug (= id du document adminUsers) n'est pas stocké tel quel sur le compte
      // Firebase : on le retrouve depuis la partie locale de l'e-mail synthétique (voir
      // accountSlugFromEmail/usernameToSyntheticEmail, lib/auth.ts).
      const slug = accountSlugFromEmail(firebaseUser.email);
      try {
        const profile = await resolveAuthUserProfile(slug);
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
    void signOut(getAuthInstance());
  }, []);

  return (
    <RoleContext.Provider
      value={{
        role: user?.profiles?.[0]?.role ?? null,
        profiles: user?.profiles ?? [],
        isGlobalAdmin: !!user?.isGlobalAdmin,
        isCompanyAdmin: !!user?.isCompanyAdmin,
        user,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole doit être utilisé dans un <RoleProvider>");
  return ctx;
}
