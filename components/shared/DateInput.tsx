"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateFr, parseDateFr } from "@/lib/format";

/**
 * Saisie de date au format français JJ/MM/AAAA, quelle que soit la langue du navigateur — un
 * `<input type="date">` natif s'affiche au format de l'OS (MM/DD/YYYY sur un poste en anglais),
 * ce que les utilisateurs ne veulent pas. Valeur échangée en ISO `YYYY-MM-DD` (même contrat que
 * l'input natif : `value`/`onChange` restent interchangeables), chaîne vide = pas de date.
 * Le bouton calendrier ouvre le sélecteur natif (input date masqué) pour choisir à la souris.
 */
export function DateInput({
  value,
  onChange,
  className,
  min,
  max,
  required,
  disabled,
  invalid,
  id,
  onBlur,
  title,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** Bordure rouge (champ obligatoire manquant ou incohérent). */
  invalid?: boolean;
  id?: string;
  onBlur?: () => void;
  title?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}) {
  const [text, setText] = useState(() => formatDateFr(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  // Resynchronise le texte quand la valeur change de l'extérieur (ex. sélection au calendrier,
  // réinitialisation du formulaire) — sans écraser une saisie partielle en cours.
  useEffect(() => {
    if (parseDateFr(text) !== value) setText(formatDateFr(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleText = (raw: string) => {
    // Masque JJ/MM/AAAA : on ne garde que les chiffres et on replace les « / ».
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let next = digits;
    if (digits.length > 4) next = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) next = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(next);
    if (!digits) {
      onChange("");
      return;
    }
    const iso = parseDateFr(next);
    if (iso) onChange(iso);
  };

  const incomplete = text !== "" && !parseDateFr(text);

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="JJ/MM/AAAA"
        aria-label={ariaLabel}
        title={title}
        aria-invalid={invalid || ariaInvalid || incomplete || undefined}
        required={required}
        disabled={disabled}
        className={cn(
          className,
          "pr-8",
          (invalid || ariaInvalid || incomplete) && "border-bp-coral focus:border-bp-coral"
        )}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onBlur={() => {
          // Saisie incomplète abandonnée : on revient à la dernière date valide.
          if (incomplete) setText(formatDateFr(value));
          onBlur?.();
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-hidden
        onClick={() => {
          const picker = pickerRef.current;
          if (!picker) return;
          try {
            picker.showPicker();
          } catch {
            picker.focus();
          }
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-tertiary hover:text-primary disabled:opacity-50"
      >
        <CalendarDays size={14} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
