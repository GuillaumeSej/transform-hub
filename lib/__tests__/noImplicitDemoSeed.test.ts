import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Verrouille la suppression des mécanismes d'auto-seed implicite ("ensure*Seeded") qui écrivaient
 * `data/mockData.ts` dans les documents Firestore de N'IMPORTE QUELLE entreprise comme simple
 * effet de bord d'un chargement de page (voir lib/hooks/useStorage.ts, lib/firestore/workforce.ts,
 * programConfig.ts, levers.ts, alerts.ts). Deux garanties :
 *  - les fonctions `ensure*Seeded` n'existent plus (régression : si quelqu'un les réintroduit,
 *    ce test échoue et documente pourquoi c'est un bug, pas une feature).
 *  - une entreprise flambant neuve (aucun document Firestore) obtient un état VIDE, jamais les
 *    données mock d'Acme, via les fonctions `subscribe*` et les utilitaires `forceReseed*`
 *    explicites qui restent (reset démo volontaire, jamais automatique).
 */

const onSnapshot = vi.fn();
const setDoc = vi.fn();
const getDoc = vi.fn();
const getDocs = vi.fn();
const writeBatch = vi.fn();
const doc = vi.fn((..._args: unknown[]) => ({ __doc: _args }));
const collection = vi.fn((..._args: unknown[]) => ({ __collection: _args }));
const query = vi.fn((...args: unknown[]) => ({ __query: args }));
const where = vi.fn((...args: unknown[]) => ({ __where: args }));

vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => doc(...args),
  collection: (...args: unknown[]) => collection(...args),
  query: (...args: unknown[]) => query(...args),
  where: (...args: unknown[]) => where(...args),
  onSnapshot: (...args: unknown[]) => onSnapshot(...args),
  setDoc: (...args: unknown[]) => setDoc(...args),
  getDoc: (...args: unknown[]) => getDoc(...args),
  getDocs: (...args: unknown[]) => getDocs(...args),
  writeBatch: (...args: unknown[]) => writeBatch(...args),
}));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/lib/firestore/listenerError", () => ({
  onListenerError: () => () => {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lib/firestore/workforce.ts — pas de seed implicite", () => {
  it("n'exporte plus ensureWorkforceSeeded", async () => {
    const mod = await import("@/lib/firestore/workforce");
    expect((mod as Record<string, unknown>).ensureWorkforceSeeded).toBeUndefined();
  });

  it("forceReseedWorkforce reste un utilitaire explicite exporté (reset démo volontaire)", async () => {
    const mod = await import("@/lib/firestore/workforce");
    expect(typeof mod.forceReseedWorkforce).toBe("function");
  });

  it("une entreprise flambant neuve (aucun document) reçoit un périmètre workforce vide, pas mockData", async () => {
    const mod = await import("@/lib/firestore/workforce");
    onSnapshot.mockImplementation((_ref, handler) => {
      handler({ exists: () => false, data: () => undefined });
      return () => {};
    });
    let received: unknown;
    mod.subscribeWorkforceMeta((meta) => {
      received = meta;
    }, "c-nouvelle-entreprise");
    expect(received).toBeNull();

    let employees: unknown;
    mod.subscribeEmployees((e) => {
      employees = e;
    }, "c-nouvelle-entreprise");
    expect(employees).toEqual([]);
  });
});

describe("lib/firestore/programConfig.ts — pas de seed implicite", () => {
  it("n'exporte plus ensureProgramSeeded", async () => {
    const mod = await import("@/lib/firestore/programConfig");
    expect((mod as Record<string, unknown>).ensureProgramSeeded).toBeUndefined();
  });

  it("forceReseedProgram reste un utilitaire explicite exporté (reset démo volontaire)", async () => {
    const mod = await import("@/lib/firestore/programConfig");
    expect(typeof mod.forceReseedProgram).toBe("function");
  });

  it("une entreprise flambant neuve (aucun document meta/program__*) reçoit null, pas mockData.program", async () => {
    const mod = await import("@/lib/firestore/programConfig");
    onSnapshot.mockImplementation((_ref, handler) => {
      handler({ exists: () => false });
      return () => {};
    });
    let received: unknown = "not-called";
    mod.subscribeProgramConfig((config) => {
      received = config;
    }, "c-nouvelle-entreprise");
    expect(received).toBeNull();
  });
});

describe("lib/firestore/levers.ts — pas de seed implicite", () => {
  it("n'exporte plus ensureLeversSeeded", async () => {
    const mod = await import("@/lib/firestore/levers");
    expect((mod as Record<string, unknown>).ensureLeversSeeded).toBeUndefined();
  });

  it("forceReseedLevers reste un utilitaire explicite exporté (reset dev/ops volontaire)", async () => {
    const mod = await import("@/lib/firestore/levers");
    expect(typeof mod.forceReseedLevers).toBe("function");
  });
});

describe("lib/firestore/alerts.ts — pas de seed implicite", () => {
  it("n'exporte plus ensureAlertsSeeded", async () => {
    const mod = await import("@/lib/firestore/alerts");
    expect((mod as Record<string, unknown>).ensureAlertsSeeded).toBeUndefined();
  });
});

describe("lib/hooks/useStorage.ts — plus aucun call site automatique vers ensure*Seeded", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const source = fs.readFileSync(path.resolve(__dirname, "..", "hooks", "useStorage.ts"), "utf-8");

  it("n'appelle plus aucune variante ensure*Seeded (les mentions restantes ne sont que des commentaires expliquant la suppression)", () => {
    expect(source).not.toMatch(/leversDb\.ensureLeversSeeded/);
    expect(source).not.toMatch(/workforceDb\.ensureWorkforceSeeded/);
    expect(source).not.toMatch(/programDb\.ensureProgramSeeded/);
    expect(source).not.toMatch(/alertsDb\.ensureAlertsSeeded/);
  });

  it("l'état initial des leviers/commentaires/audit n'est plus dérivé de mockData (démarre vide)", () => {
    expect(source).toMatch(/useState<Lever\[\]>\(\[\]\)/);
    expect(source).not.toMatch(/useState<Lever\[\]>\(\(\) => lockedSeed\(\)\.levers\)/);
  });
});
