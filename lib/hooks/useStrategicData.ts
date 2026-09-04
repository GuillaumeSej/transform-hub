"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeStrategicAxes,
  saveStrategicAxis,
  deleteStrategicAxis,
} from "@/lib/firestore/strategicAxes";
import { subscribeChantiers, saveChantier, deleteChantier } from "@/lib/firestore/chantiers";
import {
  subscribeChantierActions,
  saveChantierAction,
  deleteChantierAction,
} from "@/lib/firestore/chantierActions";
import { subscribeIndicators, saveIndicator, deleteIndicator } from "@/lib/firestore/indicators";
import {
  subscribeIndicatorMeasurements,
  saveIndicatorMeasurement,
  deleteIndicatorMeasurement,
} from "@/lib/firestore/indicatorMeasurements";
import {
  subscribeChantierStaffing,
  saveChantierStaffing,
  deleteChantierStaffing,
} from "@/lib/firestore/chantierStaffing";
import { computeIndicatorStatus } from "@/lib/axisLogic";
import type {
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

/**
 * Point d'accès React unique aux données du Plan Stratégique (axes / chantiers / actions /
 * indicateurs / mesures / staffing), pour UNE entreprise et UN programme. Pendant stratégique de
 * `useBeTrackData` (lib/hooks/useStorage.ts), volontairement beaucoup plus simple : pas de seed,
 * pas de migration, pas de repli mockData — le Plan Stratégique est une fonctionnalité neuve, il
 * n'y a aucune donnée historique à rattraper.
 *
 * Scoping : les abonnements Firestore filtrent par `companyId` côté serveur (voir
 * `lib/firestore/strategicAxes.ts`), le filtrage par `programId` est appliqué ici côté client —
 * un utilisateur ne charge donc que sa propre entreprise, et bascule de programme sans re-souscrire.
 *
 * Les méthodes de mutation écrivent directement dans Firestore et laissent l'abonnement
 * `onSnapshot` rafraîchir l'état (pas de mise à jour optimiste, contrairement à `useBeTrackData` :
 * les volumes sont petits et les écrans stratégiques n'ont pas d'édition en rafale à absorber).
 */

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export type StrategicData = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  /** Lignes de staffing (ETP par fonction) des chantiers du programme actif. */
  staffing: ChantierStaffing[];
  /** true tant que les six abonnements n'ont pas tous répondu au moins une fois. */
  loading: boolean;

  // ── Mutations ──────────────────────────────────────────────────────────────────────────────
  createAxis: (
    input: Pick<StrategicAxis, "name" | "stage"> &
      Partial<Pick<StrategicAxis, "description" | "owner" | "color" | "confidentialityLevel">>
  ) => Promise<StrategicAxis>;
  updateAxis: (id: string, patch: Partial<StrategicAxis>) => Promise<void>;
  removeAxis: (id: string) => Promise<void>;

  createChantier: (
    input: Pick<Chantier, "axisId" | "name" | "stage"> &
      Partial<Pick<Chantier, "description" | "dependencies" | "confidentialityLevel">>
  ) => Promise<Chantier>;
  updateChantier: (id: string, patch: Partial<Chantier>) => Promise<void>;
  removeChantier: (id: string) => Promise<void>;

  createChantierAction: (
    input: Pick<ChantierAction, "chantierId" | "name" | "start" | "end" | "status"> &
      Partial<Pick<ChantierAction, "description" | "owner" | "deliverables">>
  ) => Promise<ChantierAction>;
  updateChantierAction: (id: string, patch: Partial<ChantierAction>) => Promise<void>;
  removeChantierAction: (id: string) => Promise<void>;

  createIndicator: (
    input: Pick<
      Indicator,
      "axisId" | "name" | "kind" | "frequency" | "objective" | "responsibleRoles"
    > &
      Partial<
        Pick<
          Indicator,
          | "chantierId"
          | "objectiveValue"
          | "direction"
          | "unit"
          | "additionalAuthorizedUserIds"
          | "confidentialityLevel"
        >
      >
  ) => Promise<Indicator>;
  updateIndicator: (id: string, patch: Partial<Indicator>) => Promise<void>;
  removeIndicator: (id: string) => Promise<void>;

  /** Ajoute une mesure ET recalcule/persiste le statut de l'indicateur concerné — la saisie d'une
   *  mesure est le SEUL évènement qui fait bouger `Indicator.status`. */
  addMeasurement: (
    input: Pick<IndicatorMeasurement, "indicatorId" | "period" | "reportedBy"> &
      Partial<Pick<IndicatorMeasurement, "value" | "note">>
  ) => Promise<IndicatorMeasurement>;
  removeMeasurement: (id: string) => Promise<void>;

  /** Ajoute une ligne de staffing sur un chantier. Pas d'`updateStaffing` : une ligne n'a que
   *  deux champs signifiants (fonction + ETP), on la corrige en la supprimant/ressaisissant. */
  createStaffing: (
    input: Pick<ChantierStaffing, "axisId" | "chantierId" | "function" | "fte"> &
      Partial<Pick<ChantierStaffing, "note">>
  ) => Promise<ChantierStaffing>;
  removeStaffing: (id: string) => Promise<void>;
};

/** Identifiant d'entité : suffixe aléatoire plutôt qu'un compteur `L###` comme côté leviers — il
 *  n'y a pas de code métier lisible attendu sur ces entités, et cela évite une lecture préalable
 *  de toute la collection pour trouver le prochain numéro libre. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useStrategicData(
  companyId: string | null | undefined,
  programId: string | null | undefined
): StrategicData {
  const [allAxes, setAllAxes] = useState<StrategicAxis[]>([]);
  const [allChantiers, setAllChantiers] = useState<Chantier[]>([]);
  const [allActions, setAllActions] = useState<ChantierAction[]>([]);
  const [allIndicators, setAllIndicators] = useState<Indicator[]>([]);
  const [allMeasurements, setAllMeasurements] = useState<IndicatorMeasurement[]>([]);
  const [allStaffing, setAllStaffing] = useState<ChantierStaffing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) {
      setAllAxes([]);
      setAllChantiers([]);
      setAllActions([]);
      setAllIndicators([]);
      setAllMeasurements([]);
      setAllStaffing([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // `loading` ne retombe qu'une fois les six collections arrivées : afficher un écran
    // partiellement peuplé (axes sans indicateurs) donnerait de faux compteurs "0 à risque".
    const pending = new Set([
      "axes",
      "chantiers",
      "actions",
      "indicators",
      "measurements",
      "staffing",
    ]);
    const settle = (key: string) => {
      pending.delete(key);
      if (pending.size === 0) setLoading(false);
    };

    const unsubs = [
      subscribeStrategicAxes(companyId, (v) => {
        setAllAxes(v);
        settle("axes");
      }),
      subscribeChantiers(companyId, (v) => {
        setAllChantiers(v);
        settle("chantiers");
      }),
      subscribeChantierActions(companyId, (v) => {
        setAllActions(v);
        settle("actions");
      }),
      subscribeIndicators(companyId, (v) => {
        setAllIndicators(v);
        settle("indicators");
      }),
      subscribeIndicatorMeasurements(companyId, (v) => {
        setAllMeasurements(v);
        settle("measurements");
      }),
      subscribeChantierStaffing(companyId, (v) => {
        setAllStaffing(v);
        settle("staffing");
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [companyId]);

  // ── Projections scopées au programme actif ────────────────────────────────────────────────
  const axes = useMemo(
    () => allAxes.filter((a) => a.programId === programId),
    [allAxes, programId]
  );
  const chantiers = useMemo(
    () => allChantiers.filter((c) => c.programId === programId),
    [allChantiers, programId]
  );
  const indicators = useMemo(
    () => allIndicators.filter((i) => i.programId === programId),
    [allIndicators, programId]
  );
  // Actions et mesures ne portent pas de `programId` (elles le tiennent de leur parent) : on les
  // rattache via l'ensemble des chantiers/indicateurs du programme.
  const chantierActions = useMemo(() => {
    const ids = new Set(chantiers.map((c) => c.id));
    return allActions.filter((a) => ids.has(a.chantierId));
  }, [allActions, chantiers]);
  const measurements = useMemo(() => {
    const ids = new Set(indicators.map((i) => i.id));
    return allMeasurements.filter((m) => ids.has(m.indicatorId));
  }, [allMeasurements, indicators]);
  // Le staffing porte son propre `programId` (comme axes/chantiers/indicateurs) : filtrage direct,
  // sans passer par la liste des chantiers — une ligne dont le chantier vient d'être supprimé
  // reste ainsi visible dans les agrégats plutôt que de disparaître silencieusement.
  const staffing = useMemo(
    () => allStaffing.filter((s) => s.programId === programId),
    [allStaffing, programId]
  );

  // Refs toujours à jour : les mutations doivent lire l'état le plus récent sans être recréées à
  // chaque rendu (même motivation que les refs de `useBeTrackData`).
  const indicatorsRef = useRef(allIndicators);
  indicatorsRef.current = allIndicators;
  const measurementsRef = useRef(allMeasurements);
  measurementsRef.current = allMeasurements;
  const axesRef = useRef(allAxes);
  axesRef.current = allAxes;
  const chantiersRef = useRef(allChantiers);
  chantiersRef.current = allChantiers;
  const actionsRef = useRef(allActions);
  actionsRef.current = allActions;

  // ── Mutations ─────────────────────────────────────────────────────────────────────────────

  const createAxis = useCallback<StrategicData["createAxis"]>(
    async (input) => {
      if (!companyId || !programId) throw new Error("createAxis: companyId/programId manquant");
      const axis: StrategicAxis = {
        ...input,
        id: newId("AX"),
        companyId,
        programId,
        createdAt: nowDate(),
        lastUpdate: nowDate(),
      };
      await saveStrategicAxis(axis);
      return axis;
    },
    [companyId, programId]
  );

  const updateAxis = useCallback<StrategicData["updateAxis"]>(async (id, patch) => {
    const existing = axesRef.current.find((a) => a.id === id);
    if (!existing) return;
    await saveStrategicAxis({ ...existing, ...patch, id, lastUpdate: nowDate() });
  }, []);

  const removeAxis = useCallback<StrategicData["removeAxis"]>(async (id) => {
    await deleteStrategicAxis(id);
  }, []);

  const createChantier = useCallback<StrategicData["createChantier"]>(
    async (input) => {
      if (!companyId || !programId) throw new Error("createChantier: companyId/programId manquant");
      const chantier: Chantier = {
        dependencies: [],
        ...input,
        id: newId("CH"),
        companyId,
        programId,
        createdAt: nowDate(),
        lastUpdate: nowDate(),
      };
      await saveChantier(chantier);
      return chantier;
    },
    [companyId, programId]
  );

  const updateChantier = useCallback<StrategicData["updateChantier"]>(async (id, patch) => {
    const existing = chantiersRef.current.find((c) => c.id === id);
    if (!existing) return;
    await saveChantier({ ...existing, ...patch, id, lastUpdate: nowDate() });
  }, []);

  const removeChantier = useCallback<StrategicData["removeChantier"]>(async (id) => {
    await deleteChantier(id);
  }, []);

  const createChantierAction = useCallback<StrategicData["createChantierAction"]>(
    async (input) => {
      if (!companyId) throw new Error("createChantierAction: companyId manquant");
      const action: ChantierAction = { ...input, id: newId("CA"), companyId };
      await saveChantierAction(action);
      return action;
    },
    [companyId]
  );

  const updateChantierAction = useCallback<StrategicData["updateChantierAction"]>(
    async (id, patch) => {
      const existing = actionsRef.current.find((a) => a.id === id);
      if (!existing) return;
      await saveChantierAction({ ...existing, ...patch, id });
    },
    []
  );

  const removeChantierAction = useCallback<StrategicData["removeChantierAction"]>(async (id) => {
    await deleteChantierAction(id);
  }, []);

  const createIndicator = useCallback<StrategicData["createIndicator"]>(
    async (input) => {
      if (!companyId || !programId)
        throw new Error("createIndicator: companyId/programId manquant");
      const indicator: Indicator = {
        ...input,
        id: newId("IND"),
        companyId,
        programId,
        // Un indicateur neuf n'a aucune mesure : "on_track" par construction (voir
        // computeIndicatorStatus — l'absence de mesure n'est pas un retard).
        status: "on_track",
        createdAt: nowDate(),
        lastUpdate: nowDate(),
      };
      await saveIndicator(indicator);
      return indicator;
    },
    [companyId, programId]
  );

  const updateIndicator = useCallback<StrategicData["updateIndicator"]>(async (id, patch) => {
    const existing = indicatorsRef.current.find((i) => i.id === id);
    if (!existing) return;
    const next: Indicator = { ...existing, ...patch, id, lastUpdate: nowDate() };
    // Modifier l'objectif/le sens/la nature change mécaniquement le verdict sur la dernière
    // mesure — on recalcule ici pour ne pas laisser un statut périmé en base.
    next.status = computeIndicatorStatus(next, measurementsRef.current);
    await saveIndicator(next);
  }, []);

  const removeIndicator = useCallback<StrategicData["removeIndicator"]>(async (id) => {
    await deleteIndicator(id);
  }, []);

  const addMeasurement = useCallback<StrategicData["addMeasurement"]>(
    async (input) => {
      if (!companyId) throw new Error("addMeasurement: companyId manquant");
      const measurement: IndicatorMeasurement = {
        ...input,
        id: newId("IM"),
        companyId,
        reportedAt: new Date().toISOString(),
      };
      await saveIndicatorMeasurement(measurement);

      // Recalcul du statut de l'indicateur sur la base incluant la mesure qu'on vient d'écrire :
      // l'abonnement Firestore n'a pas encore répondu à ce stade, on ne peut donc pas se contenter
      // de `measurementsRef.current`. `statusOverride` n'est jamais touché ici — la surcharge
      // manuelle du responsable reste prioritaire (voir resolveIndicatorStatus).
      const indicator = indicatorsRef.current.find((i) => i.id === input.indicatorId);
      if (indicator) {
        const status = computeIndicatorStatus(indicator, [...measurementsRef.current, measurement]);
        if (status !== indicator.status) {
          await saveIndicator({ ...indicator, status, lastUpdate: nowDate() });
        }
      }
      return measurement;
    },
    [companyId]
  );

  const removeMeasurement = useCallback<StrategicData["removeMeasurement"]>(async (id) => {
    await deleteIndicatorMeasurement(id);
  }, []);

  const createStaffing = useCallback<StrategicData["createStaffing"]>(
    async (input) => {
      if (!companyId || !programId) throw new Error("createStaffing: companyId/programId manquant");
      const { note, ...rest } = input;
      const entry: ChantierStaffing = {
        ...rest,
        id: newId("ST"),
        companyId,
        programId,
        createdAt: nowDate(),
        // `note` OMISE plutôt que passée à `undefined` : Firestore rejette `undefined` à
        // l'écriture (pas d'`ignoreUndefinedProperties` sur cette instance).
        ...(note && note.trim() !== "" ? { note: note.trim() } : {}),
      };
      await saveChantierStaffing(entry);
      return entry;
    },
    [companyId, programId]
  );

  const removeStaffing = useCallback<StrategicData["removeStaffing"]>(async (id) => {
    await deleteChantierStaffing(id);
  }, []);

  return {
    axes,
    chantiers,
    chantierActions,
    indicators,
    measurements,
    staffing,
    loading,
    createAxis,
    updateAxis,
    removeAxis,
    createChantier,
    updateChantier,
    removeChantier,
    createChantierAction,
    updateChantierAction,
    removeChantierAction,
    createIndicator,
    updateIndicator,
    removeIndicator,
    addMeasurement,
    removeMeasurement,
    createStaffing,
    removeStaffing,
  };
}
