"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Garde de navigation "modifications non enregistrées" — évite qu'un utilisateur ne quitte
 * silencieusement une page sur laquelle il a un formulaire en cours d'édition non sauvegardé.
 *
 * Fonctionnement :
 *  - Chaque composant "éditable" (LifecycleEditor, CompanyDetailClient, page /finance, ...)
 *    appelle `useRegisterUnsavedChanges("mon-scope-id", isDirty)` : quand `isDirty === true`,
 *    son scope est marqué comme "sale" (dirty).
 *  - `isAnyDirty` agrège toutes les zones sales : si au moins une l'est, toute navigation
 *    doit passer par `confirmDiscard()`.
 *  - `confirmDiscard()` retourne une `Promise<boolean>` : `true` = OK on quitte, `false` = on
 *    reste sur la page. Une modale `<UnsavedChangesConfirmModal>` (montée dans le layout) est
 *    affichée pour laisser l'utilisateur trancher.
 *  - Un handler `beforeunload` est câblé automatiquement pour couvrir le cas fermeture d'onglet
 *    / rafraîchissement (le navigateur affiche alors son propre prompt générique).
 *
 * Ce provider est monté dans `app/(app)/layout.tsx` — la garde ne s'applique donc qu'aux pages
 * protégées (l'écran de login n'a pas de formulaire "à sauvegarder" au sens métier).
 */

type PendingConfirm = {
  resolve: (proceed: boolean) => void;
};

type UnsavedChangesContextValue = {
  /** Vrai si au moins un scope enregistré est actuellement "sale". */
  isAnyDirty: boolean;
  /** Enregistre/met à jour l'état "dirty" d'un scope. Utiliser un id stable par composant. */
  setScopeDirty: (id: string, isDirty: boolean) => void;
  /** Retire un scope (à appeler dans le cleanup d'un `useEffect`). */
  removeScope: (id: string) => void;
  /** Ouvre la modale de confirmation. Résout `true` si l'utilisateur choisit "Quitter". */
  confirmDiscard: () => Promise<boolean>;
  /** Utilisé par `<UnsavedChangesConfirmModal>` — ne pas appeler depuis les pages. */
  _pendingConfirm: PendingConfirm | null;
  /** Utilisé par `<UnsavedChangesConfirmModal>` — ne pas appeler depuis les pages. */
  _resolvePendingConfirm: (proceed: boolean) => void;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  // Map<scopeId, isDirty> — on ne stocke dans le state React que le compte des scopes sales
  // pour éviter des re-renders inutiles (l'identité de la Map ne change qu'à chaque mutation).
  const scopesRef = useRef<Map<string, boolean>>(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const recomputeCount = useCallback(() => {
    let n = 0;
    scopesRef.current.forEach((v) => {
      if (v) n += 1;
    });
    setDirtyCount(n);
  }, []);

  const setScopeDirty = useCallback(
    (id: string, isDirty: boolean) => {
      const prev = scopesRef.current.get(id) ?? false;
      if (prev === isDirty) return;
      scopesRef.current.set(id, isDirty);
      recomputeCount();
    },
    [recomputeCount]
  );

  const removeScope = useCallback(
    (id: string) => {
      if (!scopesRef.current.has(id)) return;
      scopesRef.current.delete(id);
      recomputeCount();
    },
    [recomputeCount]
  );

  const confirmDiscard = useCallback((): Promise<boolean> => {
    // Rien de sale ? On laisse passer immédiatement.
    if (dirtyCount === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setPendingConfirm({ resolve });
    });
  }, [dirtyCount]);

  const resolvePendingConfirm = useCallback(
    (proceed: boolean) => {
      if (pendingConfirm) {
        pendingConfirm.resolve(proceed);
      }
      setPendingConfirm(null);
    },
    [pendingConfirm]
  );

  // Fermeture d'onglet / rafraîchissement : on ne peut pas afficher notre propre modale ici
  // (le navigateur ne le permet pas), on se contente de déclencher le prompt natif via
  // `preventDefault()` + `returnValue`. Uniquement câblé quand quelque chose est sale.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // La chaîne retournée est ignorée par les navigateurs modernes mais reste requise pour
      // Chrome anciens ; peu importe le contenu, le prompt est générique côté navigateur.
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  const value = useMemo<UnsavedChangesContextValue>(
    () => ({
      isAnyDirty: dirtyCount > 0,
      setScopeDirty,
      removeScope,
      confirmDiscard,
      _pendingConfirm: pendingConfirm,
      _resolvePendingConfirm: resolvePendingConfirm,
    }),
    [dirtyCount, setScopeDirty, removeScope, confirmDiscard, pendingConfirm, resolvePendingConfirm]
  );

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

/** Accès brut au contexte (utilisé par la modale et le router guardé). */
export function useUnsavedChanges(): UnsavedChangesContextValue {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) throw new Error("useUnsavedChanges doit être utilisé dans un <UnsavedChangesProvider>");
  return ctx;
}

/**
 * Sucre syntaxique pour les composants "éditables" : déclare un scope avec un id stable,
 * synchronise l'état `isDirty` à chaque render, et nettoie automatiquement au démontage.
 *
 * Exemple :
 * ```tsx
 * useRegisterUnsavedChanges("finance:capex", capexBudget !== savedCapexBudget);
 * ```
 */
export function useRegisterUnsavedChanges(scopeId: string, isDirty: boolean) {
  const ctx = useContext(UnsavedChangesContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setScopeDirty(scopeId, isDirty);
  }, [ctx, scopeId, isDirty]);
  useEffect(() => {
    if (!ctx) return;
    return () => ctx.removeScope(scopeId);
    // On ne veut nettoyer qu'au démontage du composant, pas à chaque changement de isDirty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId]);
}
