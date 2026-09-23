"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  DEFAULT_STAFFING_THRESHOLDS,
  STAFFING_THRESHOLD_MAX,
  validateStaffingThresholds,
  type StaffingThresholds,
} from "@/lib/staffingRate";
import { useTranslation } from "@/lib/i18n/useTranslation";

type Draft = { tense: string; over: string };

const toDraft = (t: StaffingThresholds): Draft => ({
  tense: String(t.tense),
  over: String(t.over),
});
const parse = (d: Draft): StaffingThresholds => ({
  tense: d.tense.trim() === "" ? NaN : Number(d.tense.replace(",", ".")),
  over: d.over.trim() === "" ? NaN : Number(d.over.replace(",", ".")),
});

/**
 * Bouton « Seuils » + popover d'édition des seuils du taux de staffing (tendu / sur-staffé).
 * Aperçu en direct : tant que le popover est ouvert et la saisie valide, `onPreview` reçoit les
 * seuils saisis (le parent recolore graphique / heatmap / popup) ; `onPreview(null)` à la
 * fermeture. `onSave` persiste (profil utilisateur, voir useStaffingThresholds).
 */
export function StaffingThresholdsControl({
  value,
  onSave,
  onPreview,
  saving = false,
}: {
  value: StaffingThresholds;
  onSave: (next: StaffingThresholds) => Promise<unknown> | void;
  onPreview?: (next: StaffingThresholds | null) => void;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const rootRef = useRef<HTMLDivElement>(null);

  const parsed = parse(draft);
  const error = validateStaffingThresholds(parsed);

  const close = () => {
    setOpen(false);
    onPreview?.(null);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Fermeture au clic extérieur / Échap (même comportement que components/shared/Popover).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const update = (next: Draft) => {
    setDraft(next);
    const p = parse(next);
    if (validateStaffingThresholds(p) === null) onPreview?.(p);
  };

  const toggle = () => {
    if (open) close();
    else {
      setDraft(toDraft(value));
      setOpen(true);
    }
  };

  const submit = async () => {
    if (error !== null) return;
    await onSave(parsed);
    close();
  };

  const errorText =
    error === null
      ? null
      : t(`effectifs.staffingRate.thresholds.error.${error}`).replace(
          "{max}",
          String(STAFFING_THRESHOLD_MAX)
        );

  const inputClass =
    "h-8 w-20 rounded-sm border border-border bg-white px-2 text-right text-[12px] tabular-nums text-primary focus:border-black focus:outline-none";

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("effectifs.staffingRate.thresholds.title", "Seuils du taux de staffing")}
        className={`inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${open ? "border-black bg-neutral-100 text-primary" : "border-border bg-white text-secondary hover:border-black hover:text-primary"}`}
      >
        <SlidersHorizontal size={12} />
        {t("effectifs.staffingRate.thresholds.button", "Seuils")}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("effectifs.staffingRate.thresholds.title", "Seuils du taux de staffing")}
          className="absolute right-0 z-40 mt-1.5 w-[280px] rounded-md border border-border bg-white p-3 text-left shadow-lg"
        >
          <p className="mb-2 text-[12px] font-bold text-primary">
            {t("effectifs.staffingRate.thresholds.title", "Seuils du taux de staffing")}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="mb-2 flex items-center justify-between gap-2 text-[12px] text-secondary">
              {t("effectifs.staffingRate.thresholds.tense", "Seuil « tendu » (%)")}
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={STAFFING_THRESHOLD_MAX}
                step={1}
                value={draft.tense}
                onChange={(e) => update({ ...draft, tense: e.target.value })}
                aria-invalid={error === "tenseRange" || error === "order"}
                className={inputClass}
              />
            </label>
            <label className="mb-2 flex items-center justify-between gap-2 text-[12px] text-secondary">
              {t("effectifs.staffingRate.thresholds.over", "Seuil « sur-staffé » (%)")}
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={STAFFING_THRESHOLD_MAX}
                step={1}
                value={draft.over}
                onChange={(e) => update({ ...draft, over: e.target.value })}
                aria-invalid={error === "overMax" || error === "order"}
                className={inputClass}
              />
            </label>
            {errorText ? (
              <p role="alert" className="mb-2 text-[11px] font-semibold text-bp-coral">
                {errorText}
              </p>
            ) : (
              <p className="mb-2 text-[11px] text-tertiary">
                {t(
                  "effectifs.staffingRate.thresholds.hint",
                  "Enregistrés sur votre profil. Aperçu en direct sur le graphique et la heatmap."
                )}
              </p>
            )}
            <button
              type="button"
              onClick={() => update(toDraft(DEFAULT_STAFFING_THRESHOLDS))}
              className="mb-3 text-[11px] font-semibold text-secondary underline-offset-2 hover:text-primary hover:underline"
            >
              {t("effectifs.staffingRate.thresholds.reset", "Réinitialiser ({tense} % / {over} %)")
                .replace("{tense}", String(DEFAULT_STAFFING_THRESHOLDS.tense))
                .replace("{over}", String(DEFAULT_STAFFING_THRESHOLDS.over))}
            </button>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="h-7 rounded-sm border border-border bg-white px-3 text-[12px] font-semibold text-secondary hover:border-black hover:text-primary"
              >
                {t("effectifs.staffingRate.thresholds.cancel", "Annuler")}
              </button>
              <button
                type="submit"
                disabled={error !== null || saving}
                className="h-7 rounded-sm bg-black px-3 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("effectifs.staffingRate.thresholds.save", "Enregistrer")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
