import { Wrench } from "lucide-react";

/** Placeholder de module STRETCH — porté depuis le fallback `renderPage()` du prototype legacy. */
export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="animate-fade-up">
      <h1 className="relative mb-5 w-fit pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
        {title}
      </h1>
      <div className="rounded-lg border border-dashed border-border bg-white px-10 py-20 text-center text-secondary">
        <Wrench className="mx-auto mb-3 text-neutral-300" size={36} />
        <h3 className="mb-1.5 text-base font-semibold text-primary">Module à venir</h3>
        <p className="mx-auto max-w-md text-sm">{description}</p>
      </div>
    </div>
  );
}
