import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-bp-coral text-white hover:bg-bp-red-brick hover:shadow-md",
  dark: "bg-neutral-900 text-white hover:bg-bp-coral",
  outline:
    "border border-border-strong bg-white text-primary hover:border-bp-coral hover:text-bp-coral",
  ghost: "bg-transparent text-secondary hover:bg-neutral-100 hover:text-primary",
};

const SIZES = {
  sm: "px-2.5 py-1.5 text-[11px]",
  md: "px-4 py-2 text-[13px]",
  lg: "px-5 py-2.5 text-sm",
};

/** Bouton générique — porte les styles `.btn` du prototype legacy. */
export function Button({
  variant = "outline",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  );
}
