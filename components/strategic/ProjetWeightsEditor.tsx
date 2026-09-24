"use client";

import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierAction } from "@/types";

/**
 * Pondération DÉCLARATIVE des projets d'un chantier (`ChantierAction.chantierWeightPct`, round
 * "projet weighting") — mirroir de `components/shared/ActionWeightsEditor.tsx` pour le MOTIF
 * D'INTERACTION (liste + input par ligne + bouton "Répartir équitablement" + retour visuel), mais
 * PAS pour la sémantique de validation : `ActionWeightsEditor` impose un mode "tout ou rien" (soit
 * aucun poids, soit TOUS pondérés ET somme = 100, sinon état "invalide" affiché en rouge), alors que
 * `chantierWeightPct` suit la sémantique DÉCLARATIVE de `Lever.workstreamWeightPct` (voir son
 * commentaire, types/index.ts, et `lib/axisLogic.ts::chantierDeclaredProgress`) : les poids n'ont
 * PAS besoin de sommer à 100, un projet sans poids déclaré reçoit simplement une part implicite du
 * reste — jamais d'état "invalide" à bloquer ici, seulement un texte informatif.
 *
 * Autorisation RÉELLE (contrairement au placeholder Performance, volontairement permissif — voir le
 * doc-comment de `canEditWorkstreamWeight` dans `components/shared/LeverForm.tsx`) : `canEdit` doit
 * être calculé par l'appelant à partir du VRAI propriétaire nommé du chantier (`Chantier.pilote`) ou
 * d'un admin, jamais "quiconque peut éditer ce levier" — voir `ChantierDetailPanel.tsx`, qui suit le
 * même motif que `readOnly`/`isReadOnlyUser` (lib/roleProfiles.ts) déjà utilisé pour le reste de la
 * fiche chantier, affiné par la propriété nommée.
 */
export function ProjetWeightsEditor({
  actions,
  onChange,
  canEdit = true,
}: {
  actions: ChantierAction[];
  onChange: (next: ChantierAction[]) => void;
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  if (actions.length === 0) return null;

  const hasAnyDeclared = actions.some((a) => typeof a.chantierWeightPct === "number");
  const declaredTotal = round1(
    actions.reduce(
      (sum, a) => sum + (typeof a.chantierWeightPct === "number" ? a.chantierWeightPct : 0),
      0
    )
  );

  const setWeight = (id: string, raw: string) =>
    onChange(
      actions.map((a) =>
        a.id === id
          ? {
              ...a,
              chantierWeightPct: raw === "" ? undefined : Math.min(100, Math.max(0, Number(raw))),
            }
          : a
      )
    );

  const distributeEvenly = () => {
    const even = round1(100 / actions.length);
    onChange(actions.map((a) => ({ ...a, chantierWeightPct: even })));
  };

  const clearWeights = () => onChange(actions.map((a) => ({ ...a, chantierWeightPct: undefined })));

  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          {t("projetWeights.title", "Pondération des projets")}
        </span>
        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={distributeEvenly}
              className="rounded-sm bg-bp-coral/10 px-2 py-0.5 text-[11px] font-semibold text-bp-coral hover:bg-bp-coral/20"
            >
              {t("projetWeights.even", "Répartir équitablement")}
            </button>
            {hasAnyDeclared && (
              <button
                type="button"
                onClick={clearWeights}
                className="text-[11px] font-semibold text-tertiary hover:text-bp-coral"
              >
                {t("projetWeights.clear", "Non pondéré")}
              </button>
            )}
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {actions.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              disabled={!canEdit}
              value={a.chantierWeightPct ?? ""}
              onChange={(e) => setWeight(a.id, e.target.value)}
              className="w-20 rounded-sm border border-border px-2 py-1 text-right text-[12px] disabled:bg-neutral-100"
              aria-label={`${t("projetWeights.weight", "Poids (%)")} ${a.name}`}
            />
            <span className="text-tertiary">%</span>
          </li>
        ))}
      </ul>
      {declaredTotal > 100 && (
        <p className="mt-2 text-[11px] font-semibold text-rag-red" role="alert">
          {t(
            "projetWeights.overTotalWarning",
            "Le total déclaré dépasse 100 % : les poids sont normalisés au calcul, et les projets non pondérés reçoivent le poids moyen déclaré."
          )}
        </p>
      )}
      <div className="mt-2 text-[11px] font-semibold text-secondary">
        {hasAnyDeclared
          ? `${t("projetWeights.declaredTotal", "Poids déclaré")} : ${declaredTotal} %` +
            (declaredTotal < 100
              ? ` · ${t("projetWeights.remainingHint", "le reste est réparti également entre les projets non pondérés")}`
              : "")
          : t("projetWeights.unweighted", "Non pondéré (poids implicite égal entre les projets)")}
      </div>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
