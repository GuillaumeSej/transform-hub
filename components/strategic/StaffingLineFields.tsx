"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  STAFFING_LINE_MESSAGES,
  type StaffingLineInput,
  type StaffingLineValidation,
} from "@/lib/staffingLineValidation";

/**
 * Champs du mini-formulaire d'une ligne « ETP mobilisés » (équipe, ETP, précision, début, fin),
 * partagés par `ChantierStaffingEditor.tsx` (ajout ET édition d'une ligne persistée) et
 * `StaffingDraftTable.tsx` (brouillon de création de projet) — mêmes règles partout, voir
 * `lib/staffingLineValidation.ts`.
 *
 * Contrôlé (`value`/`onChange`) ; seul l'état « champ touché » est local : un message d'erreur
 * n'apparaît qu'une fois le champ quitté (ou modifié) pour ne pas afficher un formulaire vierge
 * tout en rouge. Pour le réinitialiser après un enregistrement, l'appelant change la `key` React.
 */

export type StaffingLineFormValue = StaffingLineInput & { note: string };

export const EMPTY_STAFFING_LINE: StaffingLineFormValue = {
  team: "",
  fte: "",
  note: "",
  startDate: "",
  endDate: "",
};

const INPUT_CLASS =
  "mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

export function StaffingLineFields({
  value,
  onChange,
  validation,
  departmentNames,
  showAllErrors = false,
  extraFields,
}: {
  value: StaffingLineFormValue;
  onChange: (next: StaffingLineFormValue) => void;
  validation: StaffingLineValidation;
  departmentNames: string[];
  /** Affiche d'emblée toutes les erreurs (ex. édition d'une ligne existante sans dates). */
  showAllErrors?: boolean;
  /** Champs supplémentaires propres à l'appelant (ex. sélecteur « Projet concerné »). */
  extraFields?: ReactNode;
}) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState<Partial<Record<keyof StaffingLineFormValue, boolean>>>({});

  const touch = (field: keyof StaffingLineFormValue) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const set = (field: keyof StaffingLineFormValue, v: string) => {
    onChange({ ...value, [field]: v });
    // Un champ modifié est « touché » dès que sa valeur n'est plus vide (on attend le blur sinon).
    if (v !== "") touch(field);
  };

  const errorFor = (field: keyof StaffingLineInput): string | null => {
    const code = validation.errors[field];
    if (!code || !(showAllErrors || touched[field])) return null;
    const [key, fallback] = STAFFING_LINE_MESSAGES[code];
    return t(key, fallback);
  };

  const inputClass = (field: keyof StaffingLineInput) =>
    `${INPUT_CLASS} ${errorFor(field) ? "border-red-400" : "border-border"}`;

  const errorNode = (field: keyof StaffingLineInput) => {
    const msg = errorFor(field);
    return msg ? (
      <span role="alert" className="mt-0.5 block text-[11px] font-normal text-red-600">
        {msg}
      </span>
    ) : null;
  };

  const required = (
    <span aria-hidden className="text-bp-coral">
      {" "}
      *
    </span>
  );

  const outside = validation.warnings.includes("outsideProject");

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <label className="block text-[11px] font-medium text-secondary">
        {t("staffing.function")}
        {required}
        {departmentNames.length > 0 ? (
          <select
            value={value.team}
            onChange={(e) => set("team", e.target.value)}
            onBlur={() => touch("team")}
            required
            aria-invalid={Boolean(errorFor("team"))}
            className={`${inputClass("team")} ${value.team === "" ? "text-tertiary" : ""}`}
          >
            <option value="">{t("staffing.teamPlaceholder", "À définir")}</option>
            {/* Équipe d'une ligne existante qui n'est plus dans la base ETP : gardée sélectionnable
                pour ne pas la perdre silencieusement en éditant. */}
            {value.team !== "" && !departmentNames.includes(value.team) && (
              <option value={value.team}>{value.team}</option>
            )}
            {departmentNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <p className={`${INPUT_CLASS} border-border bg-neutral-50 text-tertiary`}>
            {t("staffing.noDepartments")}
          </p>
        )}
        {departmentNames.length > 0 && errorNode("team")}
      </label>
      <label className="block text-[11px] font-medium text-secondary">
        {t("staffing.fte")}
        {required}
        <input
          value={value.fte}
          onChange={(e) => set("fte", e.target.value)}
          onBlur={() => touch("fte")}
          inputMode="decimal"
          required
          aria-invalid={Boolean(errorFor("fte"))}
          placeholder={t("staffing.ftePlaceholder", "ex. 0,5")}
          className={inputClass("fte")}
        />
        {errorNode("fte")}
      </label>
      <label className="block text-[11px] font-medium text-secondary">
        {t("staffing.note")}
        <input
          value={value.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder={t("staffing.notePlaceholder")}
          className={`${INPUT_CLASS} border-border`}
        />
      </label>
      <label className="block text-[11px] font-medium text-secondary">
        {t("staffing.startDate")}
        {required}
        <input
          type="date"
          value={value.startDate}
          onChange={(e) => set("startDate", e.target.value)}
          onBlur={() => touch("startDate")}
          required
          aria-invalid={Boolean(errorFor("startDate"))}
          className={inputClass("startDate")}
        />
        {errorNode("startDate")}
      </label>
      <label className="block text-[11px] font-medium text-secondary">
        {t("staffing.endDate")}
        {required}
        <input
          type="date"
          value={value.endDate}
          min={value.startDate || undefined}
          onChange={(e) => set("endDate", e.target.value)}
          onBlur={() => touch("endDate")}
          required
          aria-invalid={Boolean(errorFor("endDate"))}
          className={inputClass("endDate")}
        />
        {errorNode("endDate")}
      </label>
      {extraFields}
      {outside && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 sm:col-span-3">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {t(...STAFFING_LINE_MESSAGES.outsideProject)}
        </p>
      )}
    </div>
  );
}

/** Badge affiché à la place des dates d'une ligne existante qui n'en a pas (données antérieures à
 *  la règle « dates obligatoires »). */
export function MissingDatesBadge({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  const label = t("staffing.datesMissing", "Dates à compléter");
  const cls =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:bg-amber-100`}>
      <AlertTriangle size={10} /> {label}
    </button>
  ) : (
    <span className={cls}>
      <AlertTriangle size={10} /> {label}
    </span>
  );
}
