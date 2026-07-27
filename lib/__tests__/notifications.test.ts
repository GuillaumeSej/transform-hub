import { describe, expect, it } from "vitest";
import { deriveAlertRecipients, targetAlerts } from "@/lib/notifications";
import type { Alert, AuthUser, BeTrackData, Company, Lever } from "@/types";

const lever = {
  id: "L1",
  code: "L1",
  type: "Test",
  name: "Lever",
  ws: "WS1",
  owner: "Pierre Bernard",
  ownerInit: "PB",
  sponsor: "Marie Martin",
  sponsorInit: "MM",
  geography: "France",
  country: "France",
  entity: "A",
  function: "Ops",
  costCenter: "CC",
  pnlMap: "P",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "in_progress",
  progress: 20,
  priority: "medium",
  risk: "low",
  grossSavings: 2,
  netSavings: 1,
  opexOneOff: 0,
  opexRec: 0,
  capex: 0,
  fteImpact: 0,
  popImpacted: 0,
  dependencies: [],
  description: "",
  createdAt: "2026-01-01",
  lastUpdate: "2026-07-01",
  companyId: "c1",
} satisfies Lever;

const data = {
  program: {
    id: "P",
    name: "P",
    sponsor: "S",
    target: 1,
    currency: "EUR",
    fyStart: "2026-01-01",
    fyEnd: "2026-12-31",
    baselineEBIT: 1,
    revenue: 1,
  },
  workstreams: [{ id: "WS1", name: "WS", sponsor: "Marie Martin", color: "#000", target: 1 }],
  leverStatuses: [],
  riskLevels: [],
  priorityLevels: [],
  leverTypes: [],
  geographies: [],
  functions: [],
  pnlAccounts: [],
  levers: [lever],
  subLevers: [],
  workforce: {
    totalFTE: 0,
    massSalary: 0,
    budgetSalary: 0,
    departments: [],
    employees: [],
    movements: [],
  },
  operations: {
    lines: [],
    kpisBaseline: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
    kpisTarget: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
    kpisActual: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
  },
  alerts: [],
  audit: [],
  comments: {},
} satisfies BeTrackData;

const users: AuthUser[] = [
  {
    username: "admin",
    password: "x",
    role: "admin",
    firstName: "A",
    lastName: "A",
    name: "Admin",
    companyId: null,
  },
  {
    username: "cto",
    password: "x",
    role: "cto",
    firstName: "C",
    lastName: "C",
    name: "CTO",
    companyId: "c1",
  },
  {
    username: "owner",
    password: "x",
    role: "lever",
    firstName: "P",
    lastName: "B",
    name: "Pierre Bernard",
    companyId: "c1",
  },
  {
    username: "other",
    password: "x",
    role: "lever",
    firstName: "O",
    lastName: "O",
    name: "Other",
    companyId: "c1",
  },
  {
    username: "foreign",
    password: "x",
    role: "cto",
    firstName: "F",
    lastName: "F",
    name: "Foreign",
    companyId: "c2",
  },
];
const companies: Company[] = [
  { id: "c1", name: "C1", industry: "", createdAt: "", fyStart: "", fyEnd: "" },
];
const alert: Alert = {
  id: "A",
  type: "red",
  ts: "",
  scope: "L1",
  title: "T",
  desc: "D",
  actorRole: "lever",
  companyId: "c1",
};

describe("notifications", () => {
  it("targets admins, the company CTO and the authorized lever owner", () => {
    expect(deriveAlertRecipients(alert, users, data, companies)).toEqual(["admin", "cto", "owner"]);
  });

  it("returns only notifications targeted to the current user", () => {
    expect(targetAlerts([alert], users[2], users, data, companies)).toHaveLength(1);
    expect(targetAlerts([alert], users[3], users, data, companies)).toHaveLength(0);
  });
});
