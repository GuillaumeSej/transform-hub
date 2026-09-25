import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SIDEBAR_COLLAPSED_STORAGE_KEY, useSidebarCollapsed } from "../useSidebarCollapsed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useSidebarCollapsed", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let current: ReturnType<typeof useSidebarCollapsed> | null = null;

  function Probe() {
    current = useSidebarCollapsed();
    return null;
  }

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe />));
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    current = null;
    vi.useRealTimers();
  });

  it("est dépliée par défaut", () => {
    mount();
    expect(current!.collapsed).toBe(false);
  });

  it("restaure la préférence mémorisée", () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "1");
    mount();
    expect(current!.collapsed).toBe(true);
  });

  it("mémorise la bascule et émet un resize après la transition", () => {
    mount();
    const onResize = vi.fn();
    window.addEventListener("resize", onResize);
    act(() => current!.toggle());
    expect(current!.collapsed).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("1");
    expect(onResize).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onResize).toHaveBeenCalledTimes(1);
    act(() => current!.toggle());
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("0");
    window.removeEventListener("resize", onResize);
  });
});
