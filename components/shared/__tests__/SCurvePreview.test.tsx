import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n/useTranslation";
import { SCurvePreview, type SCurvePoint } from "../charts/SCurveChart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels = { actual: "Réalisé", planned: "Plan initial", reforecast: "Réactualisé" };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: React.ReactElement): string {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<I18nProvider>{ui}</I18nProvider>));
  return host.textContent ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("SCurvePreview — aperçu au survol de la trajectoire des économies", () => {
  it("affiche plan, réactualisé, réalisé, l'écart décomposé et les principaux leviers", () => {
    const point: SCurvePoint = {
      month: "Sep 2026",
      planned: 14,
      reforecast: 13,
      actual: 12,
      gap: { total: -2, late: 0, cancelled: 0, other: 0, adjustment: -1, delay: -1 },
    };
    const text = render(
      <SCurvePreview
        point={point}
        clickable
        labels={labels}
        contributors={[
          { id: "L005", name: "Pooling achats transport", value: -1.2 },
          { id: "L010", name: "Pricing optimization B2B", value: 0.6 },
          { id: "L002", name: "Renégociation fournisseurs IT", value: -0.4 },
          { id: "L009", name: "Maintenance préventive", value: -0.1 },
        ]}
      />
    );
    expect(text).toContain("Sep 2026");
    expect(text).toContain("Plan initial");
    expect(text).toContain("Écart réalisé − plan");
    expect(text).toContain("dont réajustement du plan");
    expect(text).toContain("dont écart d'exécution");
    expect(text).toContain("Pooling achats transport");
    // Trois leviers au plus.
    expect(text).not.toContain("Maintenance préventive");
    expect(text).toContain("Cliquer pour le détail");
  });

  it("en période future, compare le réactualisé au plan, sans liste de leviers", () => {
    const text = render(
      <SCurvePreview
        point={{ month: "Dec 2026", planned: 30, reforecast: 28, actual: null }}
        clickable={false}
        labels={labels}
      />
    );
    expect(text).toContain("Prévision");
    expect(text).toContain("Écart prévu (réactualisé − plan)");
    expect(text).not.toContain("Principaux écarts");
    expect(text).not.toContain("Cliquer pour le détail");
  });
});
