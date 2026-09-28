"use client";

import { FolderKanban } from "lucide-react";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { resolveProgramType } from "@/lib/axisLogic";
import type { ProgramType } from "@/types";

/**
 * Message affiché par une page réservée à UN type de plan (ex. dashboard RH : Plan Performance)
 * quand le programme actif du Topbar est de l'autre type (programme actif unique, décision PO
 * audit fix #1). Plutôt que de choisir silencieusement un autre programme dans le dos du Topbar,
 * la page l'explique et propose de BASCULER le programme actif global (boutons = programmes
 * sélectionnables du bon type, mêmes droits que le Topbar).
 */
export function ProgramTypeMismatchNotice({
  expected,
  title,
}: {
  expected: ProgramType;
  title: string;
}) {
  const { t } = useTranslation();
  const { authorizedPrograms, setActiveProgramId } = useActiveProgram();
  const { confirmDiscard } = useUnsavedChanges();
  const candidates = authorizedPrograms.filter((p) => resolveProgramType(p) === expected);
  const expectedLabel = t(`programType.${expected}`);

  const switchTo = async (id: string) => {
    const proceed = await confirmDiscard();
    if (proceed) setActiveProgramId(id);
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-5">
        <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
          {title}
        </h1>
      </div>
      <div className="rounded-lg border border-border bg-white p-8 text-center">
        <p className="mx-auto max-w-md text-sm text-secondary">
          {t(
            "programScope.typeMismatch",
            "Cette page concerne les programmes de type « {type} », mais le programme actif (sélecteur en haut de page) est d'un autre type."
          ).replace("{type}", expectedLabel)}
        </p>
        {candidates.length > 0 ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void switchTo(p.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-black"
              >
                <FolderKanban size={13} aria-hidden />
                {t("programScope.switchTo", "Basculer sur {program}").replace("{program}", p.name)}
              </button>
            ))}
          </div>
        ) : (
          <p className="mx-auto mt-3 max-w-md text-[12.5px] text-tertiary">
            {t(
              "programScope.noProgramOfType",
              "Aucun programme de ce type ne vous est accessible."
            )}
          </p>
        )}
      </div>
    </div>
  );
}
