"use client";

import { useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import {
  EMPTY_STAFFING_LINE,
  StaffingLineFields,
  type StaffingLineFormValue,
} from "@/components/strategic/StaffingLineFields";
import { colorForDepartment } from "@/lib/axisLogic";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { validateStaffingLine } from "@/lib/staffingLineValidation";

/**
 * Version « brouillon » de `ChantierStaffingEditor.tsx`, pour le formulaire de CRÉATION d'un projet
 * (round 29 — retour PO : « quand je crée un projet, il me faut le tableau ETP directement dans le
 * formulaire, pas juste un champ ETP consommés »). Mêmes colonnes visuelles que l'éditeur réel
 * (Personne/Précision, Équipe, Début, Fin, Taux ETP) — pas de colonne "Projet" : elle serait toujours
 * vide/redondante ici, exactement comme `ChantierStaffingEditor` la masque déjà quand
 * `scopedToActionId` est fourni.
 *
 * Diffère de `ChantierStaffingEditor` sur un point structurel : entièrement CONTRÔLÉ, état 100% en
 * mémoire (`rows`/`onChange`), AUCUN appel Firestore. Le projet n'existe pas encore au moment où ce
 * tableau est rempli (ni `chantierId`/`actionId` réels côté approbation en attente, ni même
 * l'`action.id` définitif côté création directe tant que `data.createChantierAction` n'a pas
 * répondu) — voir `ChantierDetailPanel.tsx` pour la conversion en vraies lignes `ChantierStaffing`
 * une fois le projet effectivement créé/approuvé.
 *
 * Mêmes règles de saisie que l'éditeur réel (`lib/staffingLineValidation.ts`) : équipe jamais
 * pré-remplie, ETP vide et obligatoire, dates de début/fin obligatoires (fin ≥ début), avertissement
 * non bloquant si hors des dates saisies pour le projet (`projectDates`).
 */

/** Ligne de brouillon — mêmes champs significatifs qu'une `ChantierStaffing`, moins tout ce qui
 *  dépend d'un projet déjà persisté (`id` réel, `companyId`/`programId`/`chantierId`/`actionId`,
 *  `createdAt`). `id` ici n'est qu'une clé React locale, jamais écrite telle quelle en base. */
export type StaffingDraftRow = {
  id: string;
  function: string;
  fte: number;
  note?: string;
  startDate?: string;
  endDate?: string;
};

function newDraftRowId(): string {
  return `SD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function StaffingDraftTable({
  companyId,
  rows,
  onChange,
  projectDates,
  readOnly = false,
  approvalHint,
}: {
  companyId: string;
  /** Lignes déjà ajoutées — possédées par l'appelant (`ChantierActionForm`), pas par ce composant :
   *  il doit survivre à un `submit()` du formulaire sans perdre son contenu tant que celui-ci n'a
   *  pas réellement réussi. */
  rows: StaffingDraftRow[];
  onChange: (rows: StaffingDraftRow[]) => void;
  /** Dates du projet en cours de création (champs Début/Fin du formulaire) — pour l'avertissement
   *  non bloquant « hors période du projet ». */
  projectDates?: { start?: string; end?: string };
  /** Pas de droit de staffing (`canEditStaffing`) : lignes affichées, ni ajout ni suppression. */
  readOnly?: boolean;
  /** « Les ETP seront validés par … » (lignes embarquées dans la demande de création). */
  approvalHint?: string;
}) {
  const { t } = useTranslation();
  const { departmentNames } = useCompanyDepartments(companyId);

  const [form, setForm] = useState<StaffingLineFormValue>(EMPTY_STAFFING_LINE);
  const [formKey, setFormKey] = useState(0);

  const totalFte = rows.reduce((sum, r) => sum + (r.fte || 0), 0);
  const validation = validateStaffingLine(form, projectDates ?? null);

  const add = () => {
    if (readOnly || !validation.valid || validation.fte === null) return;
    const note = form.note.trim();
    onChange([
      ...rows,
      {
        id: newDraftRowId(),
        function: form.team,
        fte: validation.fte,
        ...(note !== "" ? { note } : {}),
        startDate: form.startDate.trim(),
        endDate: form.endDate.trim(),
      },
    ]);
    setForm(EMPTY_STAFFING_LINE);
    setFormKey((k) => k + 1);
  };

  const remove = (id: string) => {
    if (!readOnly) onChange(rows.filter((r) => r.id !== id));
  };

  return (
    <div className="rounded-md border border-border bg-neutral-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-secondary">
          <Users size={13} /> {t("staffing.title")}
        </span>
        <span className="text-[11px] text-tertiary">
          {t("staffing.total")} : <strong className="text-primary">{formatFte(totalFte)}</strong>{" "}
          {t("staffing.fteUnit")}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-tertiary">{t("staffing.empty")}</p>
      ) : (
        <div className="mb-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[480px] text-left text-[12px]">
            <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              <tr>
                <th className="px-2.5 py-2">{t("staffing.columnPerson", "Personne/Précision")}</th>
                <th className="px-2.5 py-2">{t("staffing.function")}</th>
                <th className="px-2.5 py-2">{t("staffing.startDate")}</th>
                <th className="px-2.5 py-2">{t("staffing.endDate")}</th>
                <th className="px-2.5 py-2 text-right">{t("staffing.columnFte", "Taux ETP")}</th>
                {!readOnly && <th className="px-2.5 py-2" aria-hidden />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="bg-white text-primary">
                  <td className="px-2.5 py-1.5 font-medium">{row.note || "—"}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${colorForDepartment(row.function)}`}
                      />
                      {row.function}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-tertiary">{row.startDate || "—"}</td>
                  <td className="px-2.5 py-1.5 text-tertiary">{row.endDate || "—"}</td>
                  <td className="px-2.5 py-1.5 text-right font-semibold">
                    {formatFte(row.fte)} {t("staffing.fteUnit")}
                  </td>
                  {!readOnly && (
                    <td className="px-2.5 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(row.id)}
                        aria-label={t("staffing.remove")}
                        title={t("staffing.remove")}
                        className="rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-bp-coral"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <StaffingLineFields
            key={formKey}
            value={form}
            onChange={setForm}
            validation={validation}
            departmentNames={departmentNames}
          />
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={add}
              disabled={!validation.valid || departmentNames.length === 0}
            >
              <Plus size={12} /> {t("staffing.add")}
            </Button>
          </div>
        </div>
      )}
      {!readOnly && approvalHint && (
        <p className="mt-1.5 rounded-md border border-rag-amber-light bg-rag-amber-light/30 px-2 py-1 text-[11.5px] font-medium text-text-secondary">
          {approvalHint}
        </p>
      )}
      {!readOnly && <p className="mt-1.5 text-[11px] text-tertiary">{t("staffing.draftHint")}</p>}
    </div>
  );
}
