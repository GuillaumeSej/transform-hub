"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { formatFte, parseFte } from "@/components/strategic/ChantierStaffingEditor";
import { colorForDepartment } from "@/lib/axisLogic";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useTranslation } from "@/lib/i18n/useTranslation";

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

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

export function StaffingDraftTable({
  companyId,
  rows,
  onChange,
}: {
  companyId: string;
  /** Lignes déjà ajoutées — possédées par l'appelant (`ChantierActionForm`), pas par ce composant :
   *  il doit survivre à un `submit()` du formulaire sans perdre son contenu tant que celui-ci n'a
   *  pas réellement réussi. */
  rows: StaffingDraftRow[];
  onChange: (rows: StaffingDraftRow[]) => void;
}) {
  const { t } = useTranslation();
  const { departmentNames } = useCompanyDepartments(companyId);

  const [functionDraft, setFunctionDraft] = useState("");
  const [fteDraft, setFteDraft] = useState("1");
  const [noteDraft, setNoteDraft] = useState("");
  const [startDateDraft, setStartDateDraft] = useState("");
  const [endDateDraft, setEndDateDraft] = useState("");

  // Même présélection que `ChantierStaffingEditor` : dès que la base ETP répond avec au moins une
  // équipe, et seulement tant que l'utilisateur n'a rien choisi lui-même.
  useEffect(() => {
    if (!functionDraft && departmentNames.length > 0) setFunctionDraft(departmentNames[0]);
  }, [departmentNames, functionDraft]);

  const totalFte = rows.reduce((sum, r) => sum + (r.fte || 0), 0);
  const parsedFteDraft = parseFte(fteDraft);
  const canAdd = functionDraft !== "" && parsedFteDraft !== null;

  const add = () => {
    if (!canAdd || parsedFteDraft === null) return;
    const note = noteDraft.trim();
    const startDate = startDateDraft.trim();
    const endDate = endDateDraft.trim();
    onChange([
      ...rows,
      {
        id: newDraftRowId(),
        function: functionDraft,
        fte: parsedFteDraft,
        ...(note !== "" ? { note } : {}),
        ...(startDate !== "" ? { startDate } : {}),
        ...(endDate !== "" ? { endDate } : {}),
      },
    ]);
    setFteDraft("1");
    setNoteDraft("");
    setStartDateDraft("");
    setEndDateDraft("");
  };

  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));

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
                <th className="px-2.5 py-2" aria-hidden />
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="block text-[11px] font-medium text-secondary">
            {t("staffing.function")}
            {departmentNames.length > 0 ? (
              <select
                value={functionDraft}
                onChange={(e) => setFunctionDraft(e.target.value)}
                className={INPUT_CLASS}
              >
                {departmentNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <p className={`${INPUT_CLASS} bg-neutral-50 text-tertiary`}>
                {t("staffing.noDepartments")}
              </p>
            )}
          </label>
          <label className="block text-[11px] font-medium text-secondary">
            {t("staffing.fte")}
            <input
              value={fteDraft}
              onChange={(e) => setFteDraft(e.target.value)}
              inputMode="decimal"
              placeholder="1"
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-[11px] font-medium text-secondary">
            {t("staffing.note")}
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t("staffing.notePlaceholder")}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-[11px] font-medium text-secondary">
            {t("staffing.startDate")}
            <input
              type="date"
              value={startDateDraft}
              onChange={(e) => setStartDateDraft(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-[11px] font-medium text-secondary">
            {t("staffing.endDate")}
            <input
              type="date"
              value={endDateDraft}
              onChange={(e) => setEndDateDraft(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={!canAdd}
          >
            <Plus size={12} /> {t("staffing.add")}
          </Button>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-tertiary">{t("staffing.draftHint")}</p>
    </div>
  );
}
