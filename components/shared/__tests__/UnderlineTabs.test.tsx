import { describe, it, expect, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UnderlineTabs, underlineTabId } from "../UnderlineTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Id = "a" | "b" | "c";

function Harness() {
  const [value, setValue] = useState<Id>("a");
  return (
    <UnderlineTabs<Id>
      label="Vues"
      panelId="p"
      value={value}
      onChange={setValue}
      items={[
        { id: "a", label: "À valider", count: 2 },
        { id: "b", label: "Mes demandes", count: 0 },
        { id: "c", label: "Historique" },
      ]}
      actions={<select aria-label="filtre" />}
    />
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness />));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const tabs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const key = (el: HTMLElement, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

describe("UnderlineTabs", () => {
  it("expose tablist/tab, aria-selected, focus itinérant et compteurs", () => {
    const c = mount();
    expect(c.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Vues");
    const [a, b, cTab] = tabs(c);
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(a.tabIndex).toBe(0);
    expect(b.tabIndex).toBe(-1);
    expect(a.id).toBe(underlineTabId("p", "a"));
    expect(a.getAttribute("aria-controls")).toBe("p");
    expect(a.textContent).toBe("À valider2");
    expect(cTab.textContent).toBe("Historique");
    expect(c.querySelector('select[aria-label="filtre"]')).not.toBeNull();
  });

  it("change d'onglet au clic et au clavier (flèches, Début, Fin, bouclage)", () => {
    const c = mount();
    act(() => tabs(c)[1].click());
    expect(tabs(c)[1].getAttribute("aria-selected")).toBe("true");

    key(tabs(c)[1], "ArrowRight");
    expect(tabs(c)[2].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs(c)[2]);

    key(tabs(c)[2], "ArrowRight");
    expect(tabs(c)[0].getAttribute("aria-selected")).toBe("true");

    key(tabs(c)[0], "ArrowLeft");
    expect(tabs(c)[2].getAttribute("aria-selected")).toBe("true");

    key(tabs(c)[2], "Home");
    expect(tabs(c)[0].getAttribute("aria-selected")).toBe("true");

    key(tabs(c)[0], "End");
    expect(tabs(c)[2].getAttribute("aria-selected")).toBe("true");
  });
});
