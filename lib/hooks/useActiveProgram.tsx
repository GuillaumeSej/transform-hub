"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { subscribePrograms } from "@/lib/firestore/admin";
import { resolveProgramType } from "@/lib/axisLogic";
import { getConsolidatedPerformancePrograms } from "@/lib/consolidatedProgramAccess";
import { useRole } from "@/lib/hooks/useRole";
import type { Program, ProgramType } from "@/types";

/**
 * Valeur sentinelle de `activeProgramId`/`setActiveProgramId` qui active le mode "vue consolidée"
 * (fondation chantier CTO multi-programmes) : au lieu d'un programme unique, les pages consommatrices
 * (dashboard exécutif, page leviers, dashboard RH) doivent alors agréger TOUS les programmes de
 * `consolidatedPrograms` ci-dessous plutôt que de lire `activeProgram`. Choisie plutôt qu'un
 * `id: null` (déjà utilisé pour "aucune sélection restaurée") ou un objet `Program` factice, pour
 * rester une simple `string` — persistable telle quelle dans le MÊME localStorage que les vrais ids
 * de programme (voir `storageKey` plus bas), sans schéma de stockage distinct à gérer. Le préfixe
 * `__`/suffixe `__` évite toute collision avec un id Firestore réel (générés `p${Date.now()}` par
 * `ProgramsPanel.tsx`, jamais sous cette forme).
 */
export const CONSOLIDATED_PROGRAM_ID = "__consolidated__";

/**
 * Contexte global "programme actif" — le programme sélectionné détermine désormais la NATURE des
 * pages affichées (Plan Performance vs Plan Stratégique), pas seulement le périmètre de données
 * du dashboard exécutif. Il doit donc vivre au-dessus des pages (monté dans
 * `app/(app)/layout.tsx`), et non dans l'état local du dashboard comme c'était le cas avant.
 *
 * Sélection : le programme actif est mémorisé par `activeProgramId` ; en l'absence de sélection
 * explicite (premier chargement, ou programme devenu invalide après suppression), on retombe sur
 * le PREMIER programme de l'entreprise de l'utilisateur — même repli que le sélecteur historique
 * du dashboard, pour que rien ne change pour un utilisateur mono-programme.
 *
 * `programType` est le champ réellement consommé par la nav (`lib/nav-config.ts`) et les routeurs
 * de page : il vaut "performance" tant qu'aucun programme n'est résolu, de sorte qu'un incident de
 * chargement dégrade vers le comportement historique plutôt que vers un écran stratégique vide.
 */
type ActiveProgramContextValue = {
  /** Tous les programmes visibles par l'utilisateur courant (son entreprise, ou tous si admin). */
  programs: Program[];
  /** Programme actif résolu, ou null tant qu'aucun programme n'est disponible OU que la vue
   *  consolidée (`isConsolidatedView`) est active — dans ce dernier cas, lire `consolidatedPrograms`
   *  à la place. */
  activeProgram: Program | null;
  /** `CONSOLIDATED_PROGRAM_ID` quand la vue consolidée est sélectionnée, l'id d'un programme réel,
   *  ou `null` tant qu'aucune sélection n'est restaurée. */
  activeProgramId: string | null;
  /** Type du programme actif — "performance" par défaut (voir `resolveProgramType`), y compris en
   *  vue consolidée (qui ne porte QUE sur les programmes "performance", voir
   *  `getConsolidatedPerformancePrograms`). */
  programType: ProgramType;
  /** Sélectionne un programme par id, ou `CONSOLIDATED_PROGRAM_ID` pour activer la vue consolidée. */
  setActiveProgramId: (id: string | null) => void;
  /** true tant que la première réponse Firestore n'est pas arrivée. */
  loading: boolean;
  /** true quand `CONSOLIDATED_PROGRAM_ID` est sélectionné pour un utilisateur rattaché à une
   *  entreprise (jamais true pour un admin global, même contexte qu'`activeProgram` ci-dessus). */
  isConsolidatedView: boolean;
  /** Programmes "performance" en périmètre de la vue consolidée pour l'utilisateur courant (voir
   *  `lib/consolidatedProgramAccess.ts::getConsolidatedPerformancePrograms`). Tableau VIDE tant que
   *  `isConsolidatedView` est `false` — ne pas lire ce champ sans avoir vérifié `isConsolidatedView`
   *  d'abord, un tableau vide n'y signifie pas "aucun programme accessible". */
  consolidatedPrograms: Program[];
};

const ActiveProgramContext = createContext<ActiveProgramContextValue | null>(null);

/** Clé localStorage PAR ENTREPRISE (pas une clé globale unique) — le même navigateur sert à
 *  tester plusieurs entreprises de démo, un choix de programme de l'une ne doit pas fuiter vers
 *  une autre. Sans cette persistance, un simple rechargement de page (ou l'ouverture d'un lien
 *  direct vers /kpi) retombait sur le premier programme de l'entreprise — presque toujours un
 *  Plan Performance — ce qui masquait aussitôt la nav stratégique et redirigeait /kpi vers le
 *  dashboard exécutif sans explication. */
function storageKey(companyId: string): string {
  return `betrack:activeProgramId:${companyId}`;
}

export function ActiveProgramProvider({ children }: { children: React.ReactNode }) {
  const { user } = useRole();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [firestoreLoading, setFirestoreLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Distinct de `firestoreLoading` : reste `false` tant que la lecture localStorage (ci-dessous)
  // n'a pas eu lieu pour l'entreprise courante. Sans cette distinction, `programType` retombe
  // brièvement sur "performance" (aucune sélection restaurée pour l'instant) pendant la fenêtre
  // entre le premier rendu et cet effet — assez pour que le garde-fou de routes d'AppShell (voir
  // ce fichier) redirige déjà hors de /kpi avant que la vraie sélection stratégique soit relue.
  const [restored, setRestored] = useState(false);

  const companyId = user?.companyId ?? null;

  // Lecture localStorage isolée dans un effet (jamais dans l'initialiseur de useState) : ce
  // composant est rendu côté serveur au premier passage (RSC), où `localStorage` n'existe pas —
  // le lire à l'initialisation casserait l'hydratation. Se déclenche aussi si `companyId` change
  // (changement de compte sans rechargement complet), pour relire la bonne clé.
  useEffect(() => {
    // Pas de retour anticipé sur `!companyId` qui marquerait `restored` à `true` : au tout premier
    // rendu d'une page rechargée, `useRole()` n'a pas encore fini de réhydrater la session Firebase
    // et `companyId` vaut donc `null` un court instant, AVANT la vraie valeur. Marquer `restored`
    // dès ce passage ferait passer `loading` à `false` prématurément sur cette fausse valeur — cet
    // effet se redéclenche de toute façon dès que `companyId` prend sa vraie valeur (il est dans le
    // tableau de dépendances). Pour un admin global (`companyId` durablement `null`), `restored`
    // reste `false` indéfiniment : sans effet visible, ses items de nav ne sont jamais filtrés par
    // `programType` de toute façon (voir lib/nav-config.ts).
    if (!companyId) return;
    setRestored(false);
    try {
      setSelectedId(window.localStorage.getItem(storageKey(companyId)));
    } catch {
      // Stockage indisponible (navigation privée, quota) — comportement de repli identique à
      // avant cette persistance : pas de sélection mémorisée, on retombe sur le 1er programme.
    } finally {
      setRestored(true);
    }
  }, [companyId]);

  useEffect(() => {
    const unsub = subscribePrograms((all) => {
      // Un admin global (companyId null) voit tous les programmes ; les autres sont scopés à leur
      // entreprise — même règle que partout ailleurs (voir useBeTrackData).
      setPrograms(companyId ? all.filter((p) => p.companyId === companyId) : all);
      setFirestoreLoading(false);
    }, companyId);
    return unsub;
  }, [companyId]);

  const loading = firestoreLoading || !restored;

  // Vue consolidée sélectionnée ? Même garde-fou `companyId` qu'`activeProgram` ci-dessous : un
  // admin global n'a pas de contexte "entreprise" cohérent pour agréger quoi que ce soit.
  const isConsolidatedView = !!companyId && selectedId === CONSOLIDATED_PROGRAM_ID;

  const consolidatedPrograms = useMemo(() => {
    if (!isConsolidatedView) return [];
    return getConsolidatedPerformancePrograms(user, programs);
  }, [isConsolidatedView, user, programs]);

  const activeProgram = useMemo(() => {
    // Un admin global (companyId null) n'a pas de contexte "entreprise" : il ne faut jamais lui
    // attribuer arbitrairement le premier programme d'une entreprise au hasard (voir le
    // sélecteur de programme, retiré du Topbar pour cette même raison). Les pages qui dépendent
    // de `activeProgram` savent déjà dégrader proprement en son absence (cas déjà rencontré pour
    // un utilisateur normal sans aucun programme).
    if (!companyId) return null;
    if (programs.length === 0) return null;
    // Vue consolidée : pas de programme unique actif — les pages consommatrices doivent lire
    // `consolidatedPrograms` à la place. Un simple `programs.find` échouerait silencieusement ici
    // (aucun programme ne porte l'id sentinelle) et retomberait sur `programs[0]` par le `??`
    // ci-dessous, ce qui masquerait la vue consolidée derrière un programme arbitraire — d'où ce
    // retour explicite.
    if (selectedId === CONSOLIDATED_PROGRAM_ID) return null;
    return programs.find((p) => p.id === selectedId) ?? programs[0];
  }, [companyId, programs, selectedId]);

  const setActiveProgramId = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (!companyId) return;
      try {
        if (id) window.localStorage.setItem(storageKey(companyId), id);
        else window.localStorage.removeItem(storageKey(companyId));
      } catch {
        // Idem — la sélection reste effective pour la session en cours via le state React, elle
        // ne survivra simplement pas à un rechargement.
      }
    },
    [companyId]
  );

  const value = useMemo<ActiveProgramContextValue>(
    () => ({
      programs,
      activeProgram,
      activeProgramId: isConsolidatedView ? CONSOLIDATED_PROGRAM_ID : (activeProgram?.id ?? null),
      programType: resolveProgramType(activeProgram),
      setActiveProgramId,
      loading,
      isConsolidatedView,
      consolidatedPrograms,
    }),
    [programs, activeProgram, setActiveProgramId, loading, isConsolidatedView, consolidatedPrograms]
  );

  return <ActiveProgramContext.Provider value={value}>{children}</ActiveProgramContext.Provider>;
}

export function useActiveProgram(): ActiveProgramContextValue {
  const ctx = useContext(ActiveProgramContext);
  if (!ctx) throw new Error("useActiveProgram doit être utilisé dans un <ActiveProgramProvider>");
  return ctx;
}
