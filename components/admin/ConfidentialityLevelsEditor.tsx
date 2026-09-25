"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Pencil, X } from "lucide-react";
import type { Role } from "@/types";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { levelBelow, normalizeClearanceLevel } from "@/lib/confidentiality";
import { moveLevel, renameLevel } from "@/lib/companyOnboarding";

type RoleClearance = Partial<Record<Role, string | string[]>>;

/**
 * Éditeur de l'ÉCHELLE de confidentialité d'une entreprise (`Company.confidentialityLevels`),
 * ordonnée du moins au plus restreint : ajout, renommage, réordonnancement, retrait. Défini par
 * l'admin global à la mise en place ; qui accède à quel niveau reste la décision de l'admin
 * d'entreprise (matrice `roleClearance` / habilitations individuelles).
 *
 * `usage` (optionnel, voir lib/companyOnboarding.ts::countConfidentialityLevelUsage) : nombre
 * d'éléments/habilitations référençant chaque niveau. Les références ne sont PAS migrées lors
 * d'un retrait ou d'un renommage — un élément au niveau inconnu devient invisible pour tout profil
 * non-admin — d'où l'avertissement (et la confirmation explicite pour un retrait).
 */
export function ConfidentialityLevelsEditor({
  levels,
  roleClearance,
  usage,
  onChange,
}: {
  levels: string[];
  roleClearance: RoleClearance;
  usage?: Record<string, number>;
  onChange: (patch: { confidentialityLevels: string[]; roleClearance?: RoleClearance }) => void;
}) {
  const { t } = useTranslation();
  const [newLevel, setNewLevel] = useState("");
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const usageOf = (level: string) => usage?.[level] ?? 0;
  const usageText = (n: number) =>
    t("admin.onboarding.levels.usedBy", "Utilisé par {n} élément(s)").replace("{n}", String(n));

  const addLevel = () => {
    const level = newLevel.trim();
    if (!level || levels.includes(level)) return;
    onChange({ confidentialityLevels: [...levels, level] });
    setNewLevel("");
  };

  const removeLevel = (level: string) => {
    // Un rôle habilité au niveau supprimé est rétrogradé au niveau immédiatement inférieur (il
    // conserve l'accès à tout ce qu'il voyait déjà sous ce niveau), plutôt que de perdre tout accès.
    const nextClearance: Partial<Record<Role, string>> = {};
    for (const [role, stored] of Object.entries(roleClearance)) {
      const current = normalizeClearanceLevel(stored, levels);
      const next = current === level ? levelBelow(level, levels) : current;
      if (next) nextClearance[role as Role] = next;
    }
    setPendingRemoval(null);
    onChange({
      confidentialityLevels: levels.filter((l) => l !== level),
      roleClearance: nextClearance,
    });
  };

  const requestRemoval = (level: string) => {
    if (usageOf(level) > 0) setPendingRemoval(level);
    else removeLevel(level);
  };

  const commitRename = () => {
    if (!editing) return;
    if (editing.to.trim() === editing.from) {
      setEditing(null);
      return;
    }
    const result = renameLevel(levels, roleClearance, editing.from, editing.to);
    if (!result) return;
    onChange({ confidentialityLevels: result.levels, roleClearance: result.roleClearance });
    setEditing(null);
  };

  const renameInvalid =
    editing != null &&
    (editing.to.trim() === "" ||
      (editing.to.trim() !== editing.from && levels.includes(editing.to.trim())));

  const iconBtn =
    "inline-flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-bg-elevated hover:text-bp-coral disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary";

  return (
    <div id="company-confidentiality-levels" className="scroll-mt-4">
      <label className="text-xs font-medium text-text-secondary">
        {t(
          "adminCompanyFields.confidentialityLevelsLabel",
          "Niveaux de confidentialité (du moins au plus restreint)"
        )}
      </label>
      {levels.length === 0 ? (
        <p className="mt-1 rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
          {t(
            "adminCompanyFields.confidentialityEmpty",
            "La confidentialité n'est pas encore activée pour cette entreprise. Ajoutez un premier niveau ci-dessous (ex. Public, Confidentiel) pour pouvoir restreindre l'accès à certains leviers par rôle ou par utilisateur."
          )}
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-text-secondary">
            {t(
              "admin.onboarding.levels.orderHint",
              "Ordre = hiérarchie : un profil habilité à un niveau voit aussi les niveaux placés au-dessus. L'admin d'entreprise décidera ensuite qui accède à quel niveau."
            )}
          </p>
          <ol className="mt-2 max-w-xl divide-y divide-border rounded-lg border border-border bg-bg-surface">
            {levels.map((level, idx) => {
              const used = usageOf(level);
              const isEditing = editing?.from === level;
              return (
                <li key={level} className="px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-xs font-semibold text-text-secondary">
                      {idx + 1}
                    </span>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editing.to}
                        onChange={(e) => setEditing({ from: level, to: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === "Escape") {
                            setEditing(null);
                          }
                        }}
                        aria-label={t("admin.onboarding.levels.rename", "Renommer")}
                        className="min-w-0 flex-1 rounded border border-border bg-bg-elevated px-2 py-1 text-sm text-text-primary outline-none focus:border-bp-coral"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                        {level}
                      </span>
                    )}
                    {used > 0 && !isEditing && (
                      <span className="hidden shrink-0 rounded-full bg-bg-elevated px-2 py-0.5 text-[11px] text-text-secondary sm:inline">
                        {usageText(used)}
                      </span>
                    )}
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={commitRename}
                          disabled={renameInvalid}
                          className={iconBtn}
                          aria-label={t("common.save", "Enregistrer")}
                          title={t("common.save", "Enregistrer")}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className={iconBtn}
                          aria-label={t("common.cancel", "Annuler")}
                          title={t("common.cancel", "Annuler")}
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ confidentialityLevels: moveLevel(levels, idx, -1) })
                          }
                          disabled={idx === 0}
                          className={iconBtn}
                          aria-label={t("admin.onboarding.levels.moveUp", "Monter")}
                          title={t("admin.onboarding.levels.moveUp", "Monter")}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ confidentialityLevels: moveLevel(levels, idx, 1) })
                          }
                          disabled={idx === levels.length - 1}
                          className={iconBtn}
                          aria-label={t("admin.onboarding.levels.moveDown", "Descendre")}
                          title={t("admin.onboarding.levels.moveDown", "Descendre")}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingRemoval(null);
                            setEditing({ from: level, to: level });
                          }}
                          className={iconBtn}
                          aria-label={t("admin.onboarding.levels.rename", "Renommer")}
                          title={t("admin.onboarding.levels.rename", "Renommer")}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => requestRemoval(level)}
                          className={`${iconBtn} hover:!text-rag-red`}
                          aria-label={t("common.remove", "Retirer")}
                          title={t("common.remove", "Retirer")}
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                  </div>
                  {isEditing && used > 0 && (
                    <p className="ml-7 mt-1 flex items-start gap-1 text-xs text-rag-amber">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      {t(
                        "admin.onboarding.levels.renameWarning",
                        "{n} élément(s) portent ce niveau et ne seront pas renommés : ils deviendront invisibles pour les profils non-admin jusqu'à réaffectation."
                      ).replace("{n}", String(used))}
                    </p>
                  )}
                  {pendingRemoval === level && (
                    <div
                      role="alert"
                      className="ml-7 mt-1 space-y-1.5 rounded-lg border border-rag-red/40 bg-rag-red-light p-2 text-xs text-text-primary"
                    >
                      <p className="flex items-start gap-1">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rag-red" />
                        {t(
                          "admin.onboarding.levels.removeWarning",
                          "« {level} » est utilisé par {n} élément(s) (leviers, axes, chantiers, indicateurs ou habilitations). Après retrait, ces éléments deviendront invisibles pour les profils non-admin jusqu'à réaffectation d'un niveau."
                        )
                          .replace("{level}", level)
                          .replace("{n}", String(used))}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => removeLevel(level)}
                          className="rounded-lg bg-rag-red px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                        >
                          {t("admin.onboarding.levels.removeAnyway", "Retirer quand même")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingRemoval(null)}
                          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-surface"
                        >
                          {t("common.cancel", "Annuler")}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <div className="mt-2 flex gap-2">
        <input
          value={newLevel}
          onChange={(e) => setNewLevel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLevel();
            }
          }}
          placeholder={t("adminCompanyFields.newLevelPlaceholder", "Ex : Confidentiel")}
          className="w-full max-w-xs rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
        />
        <button
          type="button"
          onClick={addLevel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
        >
          {t("adminCompanyFields.addLevel", "Ajouter le niveau")}
        </button>
      </div>
    </div>
  );
}
