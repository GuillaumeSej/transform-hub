import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Boutons BearingPoint : le primaire est NOIR (la marque est monochrome, type-led — le rouge
// est réservé au surlignage graphique et au danger). Hover : noir → gris-800, outline se
// remplit de gris-100. Texte toujours noir ou blanc, jamais coloré.
const VARIANTS = {
  primary: "bg-black text-white hover:bg-neutral-700",
  dark: "bg-neutral-900 text-white hover:bg-neutral-700",
  danger: "bg-bp-coral text-white hover:bg-bp-red-brick",
  outline: "border border-black bg-white text-primary hover:bg-neutral-100",
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
