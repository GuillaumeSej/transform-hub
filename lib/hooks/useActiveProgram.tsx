"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { subscribePrograms } from "@/lib/firestore/admin";
import { resolveProgramType } from "@/lib/axisLogic";
import { getConsolidatedPerformancePrograms } from "@/lib/consolidatedProgramAccess";
import {
  CONSOLIDATED_PROGRAM_ID,
  readProgramParam,
  resolveActiveSelection,
  selectablePrograms,
  stripProgramParam,
} from "@/lib/activeProgramSelection";
import { getAuthorizedPrograms } from "@/lib/roleProfiles";
import { useRole } from "@/lib/hooks/useRole";
import type { Program, ProgramType } from "@/types";
import { setFormatCurrency } from "@/lib/format";

/**
 * Valeur sentinelle de `activeProgramId`/`setActiveProgramId` qui active le mode "vue consolidée"
 * (fondation chantier CTO multi-programmes) : au lieu d'un programme unique, les pages consommatrices
 * (dashboard exécutif, page leviers, dashboard RH, finance) agrègent alors TOUS les programmes de
 * `consolidatedPrograms` ci-dessous plutôt que de lire `activeProgram`. Simple `string` persistable
 * dans le MÊME localStorage que les vrais ids (voir `storageKey` plus bas). Définie dans le module
 * pur `lib/activeProgramSelection.ts` (testé), ré-exportée ici pour les appelants historiques.
 */
export { CONSOLIDATED_PROGRAM_ID };

/**
 * Contexte global "programme actif" — le programme sélectionné détermine désormais la NATURE des
 * pages affichées (Plan Performance vs Plan Stratégique), pas seulement le périmètre de données
 * du dashboard exécutif. Il doit donc vivre au-dessus des pages (monté dans
 * `app/(app)/layout.tsx`), et non dans l'état local du dashboard comme c'était le cas avant.
 *
 * SOURCE UNIQUE (décision PO, audit fix #1) : ce contexte est LE programme actif de toute l'app,
 * piloté par le sélecteur du Topbar (`ProgramSwitcher`). Aucune page ne choisit plus son programme
 * elle-même (plus de sélecteur local indépendant, plus de `?program=` lu par une page).
 *
 * Sélection : le programme actif est mémorisé par `activeProgramId` ; seuls les programmes
 * AUTORISÉS (`getAuthorizedPrograms`) sont sélectionnables, la vue consolidée seulement si
 * l'utilisateur y a droit (`getConsolidatedPerformancePrograms`) — voir `resolveActiveSelection`
 * (lib/activeProgramSelection.ts). Sans sélection valide (premier chargement, programme supprimé,
 * droit retiré), on retombe sur le PREMIER programme autorisé.
 *
 * Lien entrant `?program=<id>` (ex. anciens liens `/dashboard?program=…`) : lu au chargement, il
 * POSE le programme actif (s'il est sélectionnable) puis est retiré de l'URL — le Topbar reste
 * ensuite seul maître de la sélection.
 *
 * `programType` est le champ réellement consommé par la nav (`lib/nav-config.ts`) et les routeurs
 * de page : il vaut "performance" tant qu'aucun programme n'est résolu, de sorte qu'un incident de
 * chargement dégrade vers le comportement historique plutôt que vers un écran stratégique vide.
 */
type ActiveProgramContextValue = {
  /** Tous les programmes visibles par l'utilisateur courant (son entreprise, ou tous si admin). */
  programs: Program[];
  /** Programmes que l'utilisateur peut SÉLECTIONNER un à un (`getAuthorizedPrograms`, repli sur
   *  `programs` si aucun ne l'est explicitement) — seule liste à proposer dans un sélecteur. */
  authorizedPrograms: Program[];
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
  // `?program=` d'un lien entrant, prioritaire sur le choix mémorisé tant qu'il n'a pas été
  // validé/consommé (voir l'effet plus bas) — lu dans le MÊME effet que le localStorage, avant que
  // `restored` ne passe à true, pour que le garde-fou de routes d'AppShell ne décide jamais sur
  // l'ancien programme.
  const [urlProgramId, setUrlProgramId] = useState<string | null>(null);
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
      const fromUrl = readProgramParam(window.location.search);
      if (fromUrl) {
        setUrlProgramId(fromUrl);
        // Retire le paramètre de l'URL (Next 14.2 synchronise `history.replaceState` avec son
        // routeur) : un rechargement ultérieur ne doit pas réimposer ce programme par-dessus un
        // choix fait entre-temps dans le Topbar.
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${stripProgramParam(window.location.search)}${window.location.hash}`
        );
      }
    } catch {
      // URL illisible — sans effet, on s'en tient au choix mémorisé.
    }
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

  // Programmes sélectionnables et périmètre consolidé de l'utilisateur — la résolution ci-dessous
  // n'accepte QUE ceux-là (un id mémorisé ou reçu par l'URL hors périmètre est ignoré).
  const authorizedPrograms = useMemo(() => getAuthorizedPrograms(user, programs), [user, programs]);
  const selectable = useMemo(
    () => selectablePrograms(programs, authorizedPrograms),
    [programs, authorizedPrograms]
  );
  const consolidatablePrograms = useMemo(
    () => getConsolidatedPerformancePrograms(user, programs),
    [user, programs]
  );

  // Un admin global (companyId null) n'a pas de contexte "entreprise" : il ne faut jamais lui
  // attribuer arbitrairement le premier programme d'une entreprise au hasard (ni une vue
  // consolidée). Les pages qui dépendent de `activeProgram` savent déjà dégrader proprement en son
  // absence (cas déjà rencontré pour un utilisateur normal sans aucun programme).
  const selection = useMemo(
    () =>
      companyId
        ? resolveActiveSelection({
            candidates: [urlProgramId, selectedId],
            programs,
            authorizedPrograms,
            canConsolidate: consolidatablePrograms.length > 0,
          })
        : ({ kind: "none" } as const),
    [companyId, urlProgramId, selectedId, programs, authorizedPrograms, consolidatablePrograms]
  );

  const isConsolidatedView = selection.kind === "consolidated";
  const consolidatedPrograms = useMemo(
    () => (isConsolidatedView ? consolidatablePrograms : []),
    [isConsolidatedView, consolidatablePrograms]
  );
  // Vue consolidée : pas de programme unique actif — les pages lisent `consolidatedPrograms`.
  const activeProgram = selection.kind === "program" ? selection.program : null;

  const setActiveProgramId = useCallback(
    (id: string | null) => {
      // Un choix explicite l'emporte définitivement sur un `?program=` entrant.
      setUrlProgramId(null);
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

  // Consommation du `?program=` entrant une fois les programmes chargés : sélectionnable → devient
  // le choix mémorisé (comme un clic dans le Topbar) ; sinon ignoré (le choix mémorisé demeure).
  useEffect(() => {
    if (!urlProgramId || firestoreLoading || !companyId) return;
    const valid =
      urlProgramId === CONSOLIDATED_PROGRAM_ID
        ? consolidatablePrograms.length > 0
        : selectable.some((p) => p.id === urlProgramId);
    if (valid) setActiveProgramId(urlProgramId);
    else setUrlProgramId(null);
  }, [
    urlProgramId,
    firestoreLoading,
    companyId,
    selectable,
    consolidatablePrograms,
    setActiveProgramId,
  ]);

  const value = useMemo<ActiveProgramContextValue>(
    () => ({
      programs,
      authorizedPrograms: selectable,
      activeProgram,
      activeProgramId: isConsolidatedView ? CONSOLIDATED_PROGRAM_ID : (activeProgram?.id ?? null),
      programType: resolveProgramType(activeProgram),
      setActiveProgramId,
      loading,
      isConsolidatedView,
      consolidatedPrograms,
    }),
    [
      programs,
      selectable,
      activeProgram,
      setActiveProgramId,
      loading,
      isConsolidatedView,
      consolidatedPrograms,
    ]
  );

  // Devise par défaut des helpers de formatage (lib/format.ts, `engine.fmtCurr`) — posée pendant
  // le rendu (idempotent) pour que les enfants rendus dans ce même passage l'utilisent déjà.
  setFormatCurrency(activeProgram?.currency);

  return <ActiveProgramContext.Provider value={value}>{children}</ActiveProgramContext.Provider>;
}

export function useActiveProgram(): ActiveProgramContextValue {
  const ctx = useContext(ActiveProgramContext);
  if (!ctx) throw new Error("useActiveProgram doit être utilisé dans un <ActiveProgramProvider>");
  return ctx;
}
