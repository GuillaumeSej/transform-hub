import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditableTable, type ColumnDef } from "../EditableTable";

// Attendu par react-dom/test-utils pour piloter React sans avertissement — sans emballage
// @testing-library/react ici (voir commentaire de fichier), on le déclare nous-mêmes.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Vérifie le comportement de commit de l'édition inline "façon Excel" — régression pour le bug
 * rapporté où les modifications (saisie texte, choix dans un select, saisie d'une valeur
 * personnalisée) ne s'appliquaient pas. Pas de @testing-library/react dans ce repo : on pilote
 * React directement via react-dom/client + react-dom/test-utils (déjà des dépendances directes),
 * ce qui reste léger et déterministe (pas de dépendance à un serveur/dev tools).
 */

type Row = { id: string; name: string; priority: string; team: string };

const columns: ColumnDef<Row>[] = [
  { key: "name", label: "Nom", editable: true, type: "text" },
  {
    key: "priority",
    label: "Priorité",
    editable: true,
    type: "select",
    options: ["low", "medium", "high"],
  },
  { key: "team", label: "Équipe", editable: true, options: ["Alpha", "Beta"], allowCustom: true },
];

const rows: Row[] = [{ id: "r1", name: "Alice", priority: "low", team: "Alpha" }];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

function render(onCellUpdate: (rowId: string, field: keyof Row, value: string | number) => void) {
  act(() => {
    root = createRoot(container);
    root.render(<EditableTable data={rows} columns={columns} onCellUpdate={onCellUpdate} />);
  });
}

function getCell(colIndex: number): HTMLTableCellElement {
  const tr = container.querySelector("table tbody tr")!;
  return tr.querySelectorAll("td")[colIndex] as HTMLTableCellElement;
}

function dblClick(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
  });
}

describe("EditableTable — commit de l'édition inline", () => {
  it("commit une saisie texte simple au blur", () => {
    const onCellUpdate = vi.fn();
    render(onCellUpdate);

    dblClick(getCell(0));
    const input = getCell(0).querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "Alice Dupont");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onCellUpdate).toHaveBeenCalledWith("r1", "name", "Alice Dupont");
    // Après commit, la cellule ne doit plus afficher l'input d'édition.
    expect(getCell(0).querySelector("input")).toBeNull();
  });

  it("commit immédiatement au choix d'une option du select, sans attendre le blur", () => {
    const onCellUpdate = vi.fn();
    render(onCellUpdate);

    dblClick(getCell(1));
    const select = getCell(1).querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value"
      )!.set!;
      setter.call(select, "high");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Le point central de la régression : le commit doit arriver sur le `change`, avant tout blur.
    expect(onCellUpdate).toHaveBeenCalledWith("r1", "priority", "high");
    expect(getCell(1).querySelector("select")).toBeNull();
  });

  it("passe en mode custom sur 'Autre...' puis commit la valeur saisie", () => {
    const onCellUpdate = vi.fn();
    render(onCellUpdate);

    dblClick(getCell(2));
    const select = getCell(2).querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value"
      )!.set!;
      setter.call(select, "__custom__");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Passage en mode custom : pas de commit prématuré, l'input de saisie libre apparaît.
    expect(onCellUpdate).not.toHaveBeenCalled();
    const input = getCell(2).querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "Gamma");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onCellUpdate).toHaveBeenCalledWith("r1", "team", "Gamma");
  });

  it("convertit en nombre pour une colonne type number", () => {
    const numericColumns: ColumnDef<Row & { budget: number }>[] = [
      { key: "budget" as keyof Row & string, label: "Budget", editable: true, type: "number" },
    ];
    const onCellUpdate = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(
        <EditableTable
          data={[{ ...rows[0], budget: 10 }]}
          columns={numericColumns as unknown as ColumnDef<Row>[]}
          onCellUpdate={onCellUpdate}
        />
      );
    });

    dblClick(getCell(0));
    const input = getCell(0).querySelector("input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "42");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onCellUpdate).toHaveBeenCalledWith("r1", "budget", 42);
  });
});
