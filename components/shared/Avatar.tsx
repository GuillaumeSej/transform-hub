import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-[22px] w-[22px] text-[9px]",
  md: "h-[26px] w-[26px] text-[10px]",
  lg: "h-9 w-9 text-xs",
};

/** Avatar rond avec initiales — porté depuis `.avatar` du prototype legacy. */
export function Avatar({
  initials,
  size = "md",
  variant = "coral",
  className,
}: {
  initials: string;
  size?: keyof typeof SIZES;
  variant?: "coral" | "brown" | "dark";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white",
        SIZES[size],
        {
          "bg-bp-coral": variant === "coral",
          "bg-bp-warm-brown": variant === "brown",
          "bg-neutral-900": variant === "dark",
        },
        className
      )}
    >
      {initials}
    </span>
  );
}
