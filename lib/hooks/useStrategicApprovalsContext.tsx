"use client";

import { createContext, useContext } from "react";
import type { useStrategicApprovals } from "@/lib/hooks/useStrategicApprovals";

export type StrategicApprovalsApi = ReturnType<typeof useStrategicApprovals>;

const Ctx = createContext<StrategicApprovalsApi | null>(null);

/** Partage l'instance unique de `useStrategicApprovals` créée par AppShell (1 seul abonnement). */
export const StrategicApprovalsProvider = Ctx.Provider;

/** `null` hors AppShell / hors mode stratégique : les flux retombent sur l'action directe. */
export function useStrategicApprovalsApi(): StrategicApprovalsApi | null {
  return useContext(Ctx);
}
