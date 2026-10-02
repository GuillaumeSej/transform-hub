import { describe, expect, it, vi } from "vitest";
import {
  assertMeasurementPeriodNotFuture,
  FutureMeasurementPeriodError,
  futurePeriodMessage,
  isFuturePeriod,
} from "@/lib/kpiHistory";
import { baselinePeriod } from "@/lib/strategicExcelImport";
import { directGate, editKpiValueFlow, submitKpiValueFlow } from "@/lib/strategicApprovalFlows";
import {
  applyApprovedPayload,
  type StrategicApproval,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import type { AuthUser, Indicator, IndicatorFrequency, IndicatorMeasurement } from "@/types";

/**
 * Lot 3 — mesure KPI sur une période FUTURE : une valeur 2027-03 saisie en octobre 2026 devenait
 * la « dernière valeur » (avancement 9 690 %, année 2027 par défaut, rappel Mon espace disparu).
 * Refusée à la saisie, à la correction et à la validation ; l'import Excel ne peut pas en produire.
 */

const OCT_2026 = new Date(2026, 9, 2); // 2 octobre 2026 (heure locale)

describe("isFuturePeriod", () => {
  it("mensuel : la période en cours et les passées sont acceptées, les suivantes refusées", () => {
    expect(isFuturePeriod("2026-09", "monthly", OCT_2026)).toBe(false);
    expect(isFuturePeriod("2026-10", "monthly", OCT_2026)).toBe(false);
    expect(isFuturePeriod("2026-11", "monthly", OCT_2026)).toBe(true);
    expect(isFuturePeriod("2027-03", "monthly", OCT_2026)).toBe(true);
  });
  it("selon la fréquence de l'indicateur (trimestre, semestre, année en cours acceptés)", () => {
    expect(isFuturePeriod("2026-Q4", "quarterly", OCT_2026)).toBe(false);
    expect(isFuturePeriod("2027-Q1", "quarterly", OCT_2026)).toBe(true);
    expect(isFuturePeriod("2026-S2", "semiannual", OCT_2026)).toBe(false);
    expect(isFuturePeriod("2027-S1", "semiannual", OCT_2026)).toBe(true);
    expect(isFuturePeriod("2026", "annual", OCT_2026)).toBe(false);
    expect(isFuturePeriod("2027", "annual", OCT_2026)).toBe(true);
  });
  it("tolère les formats non canoniques ; texte non reconnu : jamais « futur »", () => {
    expect(isFuturePeriod("3/2027", "monthly", OCT_2026)).toBe(true);
    expect(isFuturePeriod("T1 2027", "quarterly", OCT_2026)).toBe(true);
    expect(isFuturePeriod("Budget révisé", "monthly", OCT_2026)).toBe(false);
  });
  it("assert + message dédié (clé kpi.periodFuture)", () => {
    expect(() => assertMeasurementPeriodNotFuture("2027-03", "monthly", OCT_2026)).toThrow(
      FutureMeasurementPeriodError
    );
    expect(() => assertMeasurementPeriodNotFuture("2026-10", "monthly", OCT_2026)).not.toThrow();
    // Fréquence inconnue : pas de contrôle (rien à comparer).
    expect(() => assertMeasurementPeriodNotFuture("2027-03", undefined, OCT_2026)).not.toThrow();
    const t = vi.fn((key: string, fallback?: string) =>
      key === "kpi.periodFuture" ? "X {period} {current}" : (fallback ?? key)
    );
    expect(futurePeriodMessage(t, { period: "2027-03", current: "2026-10" })).toBe(
      "X 2027-03 2026-10"
    );
  });
});

const admin = {
  username: "root",
  name: "Root",
  profiles: [],
  isCompanyAdmin: true,
} as unknown as AuthUser;
const kpi = { id: "IND1", name: "NPS", frequency: "monthly" as const };

describe("saisie / correction : période future refusée AVANT toute écriture ou demande", () => {
  it("submitKpiValueFlow lève, addMeasurement jamais appelé", async () => {
    const add = vi.fn(async () => undefined);
    await expect(
      submitKpiValueFlow(
        directGate(admin, "P1"),
        kpi,
        { indicatorId: "IND1", period: "2099-03", reportedBy: "root", value: 9690 },
        add
      )
    ).rejects.toThrow(FutureMeasurementPeriodError);
    expect(add).not.toHaveBeenCalled();
  });
  it("editKpiValueFlow (correction vers une période future) lève, rien n'est corrigé", async () => {
    const update = vi.fn(async () => undefined);
    await expect(
      editKpiValueFlow(
        directGate(admin, "P1"),
        kpi,
        { id: "IM1", period: "2026-01", value: 1 },
        { period: "2099-03" },
        update
      )
    ).rejects.toThrow(FutureMeasurementPeriodError);
    expect(update).not.toHaveBeenCalled();
  });
  it("période passée : comportement inchangé (publiée)", async () => {
    const add = vi.fn(async () => undefined);
    await expect(
      submitKpiValueFlow(
        directGate(admin, "P1"),
        kpi,
        { indicatorId: "IND1", period: "2020-03", reportedBy: "root", value: 1 },
        add
      )
    ).resolves.toBe("applied");
    expect(add).toHaveBeenCalledOnce();
  });
});

describe("validation : une demande kpi_value sur une période future n'est pas appliquée", () => {
  const indicator = {
    id: "IND1",
    companyId: "c",
    programId: "P1",
    axisId: "AX1",
    name: "NPS",
    kind: "quantitative",
    frequency: "monthly",
    objective: "",
    objectiveValue: 50,
    direction: "up",
    responsibleRoles: [],
    status: "on_track",
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
  } as unknown as Indicator;
  const data: StrategicApprovalData = {
    axes: [],
    chantiers: [],
    chantierActions: [],
    indicators: [indicator],
    measurements: [] as IndicatorMeasurement[],
  };
  const approval = (period: string): StrategicApproval => ({
    id: "A1",
    companyId: "c",
    programId: "P1",
    kind: "kpi_value",
    targetType: "indicateur",
    targetId: "IND1",
    payload: { period, value: 9690 },
    requestedBy: "carl",
    requestedAt: "2026-10-01T09:00:00Z",
    approverRole: "strategic_lead",
    approverUsernames: ["lea"],
    status: "approved",
    decidedAt: "2026-10-02T09:00:00Z",
  });
  it("2027-03 décidé en octobre 2026 : lève (la demande reste en attente)", () => {
    expect(() => applyApprovedPayload(approval("2027-03"), data)).toThrow(
      FutureMeasurementPeriodError
    );
  });
  it("2026-10 (période en cours) : publiée", () => {
    expect(applyApprovedPayload(approval("2026-10"), data).saveMeasurements).toHaveLength(1);
  });
  it("suppression d'une mesure future existante : toujours possible", () => {
    const future: IndicatorMeasurement = {
      id: "IM9",
      companyId: "c",
      indicatorId: "IND1",
      period: "2027-03",
      value: 9690,
      reportedBy: "carl",
      reportedAt: "2026-09-30T00:00:00Z",
    };
    const effects = applyApprovedPayload(
      {
        ...approval("2027-03"),
        payload: { period: "2027-03", measurementId: "IM9", remove: true },
      },
      { ...data, measurements: [future] }
    );
    expect(effects.deleteMeasurementIds).toEqual(["IM9"]);
  });
});

describe("import Excel : la mesure de référence n'est jamais future", () => {
  it("baselinePeriod = période précédente, quelle que soit la fréquence et la date", () => {
    const frequencies: IndicatorFrequency[] = ["monthly", "quarterly", "semiannual", "annual"];
    for (const month of [0, 2, 5, 6, 9, 11]) {
      const now = new Date(2026, month, 15);
      for (const f of frequencies) {
        expect(isFuturePeriod(baselinePeriod(f, now), f, now)).toBe(false);
      }
    }
  });
});
