import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import type { Chantier, ChantierStaffing } from "@/types";
import { StaffingImportButton } from "../StaffingImportButton";

/**
 * Import Effectifs — lot 5, point 1 : tant que l'aperçu contient une erreur, « Confirmer
 * l'import » est désactivé et un bandeau l'explique (même règle que l'import leviers). Avant, la
 * confirmation restait possible et les lignes en erreur étaient abandonnées sans le dire.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `vi.mock` est remonté avant les imports : la fonction simulée est créée par `vi.hoisted`.
const { readSpreadsheetFile } = vi.hoisted(() => ({ readSpreadsheetFile: vi.fn() }));
vi.mock("@/lib/excelFileRead", () => ({
  readSpreadsheetFile: (file: File) => readSpreadsheetFile(file),
}));
vi.mock("@/lib/hooks/useRole", () => ({ useRole: () => ({ user: { username: "admin" } }) }));
vi.mock("@/lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/i18n/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock("@/lib/strategicApprovals", () => ({ isPilotOrAdmin: () => true }));

const chantier = {
  id: "CH1",
  companyId: "C1",
  programId: "P1",
  axisIds: ["AX1"],
  name: "Refonte achats",
  stage: "planned",
  dependencies: [],
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
} as Chantier;

function workbook(rows: Record<string, unknown>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "ETP");
  return wb;
}
const validRow = {
  Chantier: "Refonte achats",
  Fonction: "RH",
  ETP: 1,
  "Date début": "2026-01-01",
  "Date fin": "2026-06-30",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onImport = vi.fn(async (entries: ChantierStaffing[]) => void entries);

async function importFile(rows: Record<string, unknown>[]) {
  readSpreadsheetFile.mockResolvedValue(workbook(rows));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <StaffingImportButton
        companyId="C1"
        programId="P1"
        chantiers={[chantier]}
        chantierActions={[]}
        staffing={[]}
        knownDepartments={["RH"]}
        fteByDept={{ RH: 10 }}
        onImport={onImport}
      />
    )
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["x"], "effectifs.xlsx");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const confirmButton = () =>
  Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent === "staffingImport.confirmButton"
  )!;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  onImport.mockClear();
});

describe("StaffingImportButton — import bloqué tant que le fichier contient des erreurs", () => {
  it("une ligne valide + une ligne en erreur : bouton désactivé, bandeau affiché, rien d'écrit", async () => {
    await importFile([validRow, { ...validRow, Fonction: "Astrologie" }]);
    expect(document.body.textContent).toContain(
      "Import impossible tant que le fichier contient des erreurs"
    );
    const button = confirmButton();
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(onImport).not.toHaveBeenCalled();
  });

  it("fichier sans erreur : confirmation possible", async () => {
    await importFile([validRow]);
    expect(document.body.textContent).not.toContain("Import impossible");
    const button = confirmButton();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toHaveLength(1);
  });
});
