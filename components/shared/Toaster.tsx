"use client";

import { cn } from "@/lib/utils";
import { useToast } from "@/lib/hooks/useToast";

/** Zone d'affichage des toasts — porté depuis `.toast-zone` / `toast()` du prototype legacy. */
export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "min-w-[240px] max-w-[320px] rounded-md border-l-4 bg-white px-4 py-3 shadow-lg transition-opacity",
            t.variant === "success" && "border-rag-green",
            t.variant === "error" && "border-rag-red",
            t.variant === "default" && "border-bp-coral"
          )}
        >
          <div className="text-[13px] font-semibold text-primary">{t.title}</div>
          {t.message && <div className="mt-0.5 text-xs text-secondary">{t.message}</div>}
        </div>
      ))}
    </div>
  );
}
