import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useStableValue } from "../useStableChartData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Régression "animation interrompue au survol" : les données d'un graphique Recharts doivent
 *  garder la même référence tant que leur contenu ne change pas (Recharts 3 relance l'animation
 *  d'entrée à chaque nouvelle référence). */
describe("useStableValue", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderWith(values: unknown[]) {
    const seen: unknown[] = [];
    function Probe({ value }: { value: unknown }) {
      seen.push(useStableValue(value));
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    for (const v of values) act(() => root!.render(<Probe value={v} />));
    return seen;
  }

  it("garde la même référence pour un contenu identique recréé", () => {
    const seen = renderWith([[{ name: "A", value: 1 }], [{ name: "A", value: 1 }]]);
    expect(seen[1]).toBe(seen[0]);
  });

  it("renvoie la nouvelle référence quand le contenu change", () => {
    const next = [{ name: "A", value: 2 }];
    const seen = renderWith([[{ name: "A", value: 1 }], next]);
    expect(seen[1]).toBe(next);
  });
});
