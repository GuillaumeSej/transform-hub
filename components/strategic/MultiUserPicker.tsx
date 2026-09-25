"use client";

import { X } from "lucide-react";
import { UserPicker } from "@/components/strategic/UserPicker";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser } from "@/types";

/**
 * Sélecteur MULTI-personnes (ex. `ChantierAction.contributors`) : une puce par personne retenue
 * (retirable) + le `UserPicker` existant pour en ajouter une. Même convention de valeur que
 * `UserPicker` (`AuthUser.username`). `disabled` : lecture seule (puces sans croix, pas d'ajout),
 * `title` expliquant qui peut modifier.
 */
export function MultiUserPicker({
  users,
  value,
  onChange,
  label,
  id,
  disabled = false,
  title,
}: {
  users: AuthUser[];
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { t } = useTranslation();
  const nameOf = (username: string) => {
    const u = users.find((x) => x.username === username);
    return u ? u.name || `${u.firstName} ${u.lastName}`.trim() || username : username;
  };

  return (
    <div title={disabled ? title : undefined}>
      {label && (
        <label className="text-xs font-medium text-text-secondary" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {value.length === 0 && disabled && (
          <span className="text-[12px] text-tertiary">
            {t("strategicFiche.contributors.none", "Aucun contributeur")}
          </span>
        )}
        {value.map((username) => (
          <span
            key={username}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-[12px] font-medium text-primary"
          >
            {nameOf(username)}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((u) => u !== username))}
                aria-label={`${t("strategicFiche.contributors.remove", "Retirer")} ${nameOf(username)}`}
                className="rounded-full text-tertiary hover:text-bp-coral"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="mt-1.5">
          <UserPicker
            users={users}
            value={undefined}
            exclude={value}
            onChange={(username) => {
              if (username && !value.includes(username)) onChange([...value, username]);
            }}
            placeholder={t("strategicFiche.contributors.add", "+ Ajouter un contributeur")}
            id={id}
          />
        </div>
      )}
    </div>
  );
}
