"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/shared/Button";
import {
  deleteChantierStaffing,
  saveChantierStaffing,
  subscribeChantierStaffing,
} from "@/lib/firestore/chantierStaffing";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing, StaffingFunction } from "@/types";

/**
 * Bloc « ETP mobilisés » d'une fiche chantier : la liste des lignes de staffing du chantier
 * (une fonction + un volume d'ETP par ligne) et le mini-formulaire d'ajout.
 *
 * Volontairement AUTONOME — il ne reçoit que les quatre identifiants de son contexte et gère
 * lui-même son abonnement Firestore et ses écritures. Motif : il est rendu à l'intérieur de la
 * pop-up de détail chantier (`components/strategic/AxisDetailClient.tsx`), qui est déjà un gros
 * composant à état ; y faire remonter une sixième collection et deux mutations de plus l'aurait
 * alourdi sans bénéfice, alors que le volume de données concerné (quelques lignes par chantier)
 * ne justifie aucune mutualisation d'abonnement.
 *
 * Édition : ajout + suppression seulement, pas de modification en place — une ligne n'a que deux
 * champs signifiants, la corriger revient à la ressaisir (même parti pris que
 * `useStrategicData.createStaffing`, qui n'expose pas non plus d'`updateStaffing`).
 */

/** Ordre d'affichage canonique des fonctions — partagé avec la page Effectifs
 *  (`app/(app)/effectifs/EffectifsPageClient.tsx`) pour que le sélecteur de saisie et les
 *  agrégats listent les fonctions dans le même ordre. "autre" reste en fin de liste. */
export const STAFFING_FUNCTIONS: StaffingFunction[] = [
  "rh",
  "finance",
  "it",
  "marketing",
  "commercial",
  "juridique",
  "operations",
  "achats",
  "autre",
];

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

/** Même politique d'id que `useStrategicData` (suffixe aléatoire) : jamais affiché, seulement une
 *  clé de document stable, et pas de lecture préalable de la collection pour trouver un numéro. */
function newStaffingId(): string {
  return `ST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Saisie numérique tolérante à la virgule décimale. `null` = invalide (vide compris) : un ETP
 *  doit être strictement positif, une ligne à 0 ETP n'aurait aucun sens dans les agrégats. */
function parseFte(raw: string): number | null {
  const parsed = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Formatage court : 1 et non 1.0, 0,5 et non 0.5 (locale d'affichage du navigateur). */
export function formatFte(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function ChantierStaffingEditor({
  companyId,
  programId,
  axisId,
  chantierId,
}: {
  companyId: string;
  programId: string;
  axisId: string;
  chantierId: string;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [all, setAll] = useState<ChantierStaffing[]>([]);
  const [loading, setLoading] = useState(true);
  const [functionDraft, setFunctionDraft] = useState<StaffingFunction>("rh");
  const [fteDraft, setFteDraft] = useState("1");
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Abonnement scopé entreprise côté serveur (comme toutes les collections stratégiques) ; le
  // filtrage chantier/programme est appliqué ci-dessous côté client.
  useEffect(() => {
    if (!companyId) {
      setAll([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeChantierStaffing(companyId, (entries) => {
      setAll(entries);
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  const entries = useMemo(
    () =>
      all
        .filter((e) => e.chantierId === chantierId && e.programId === programId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    [all, chantierId, programId]
  );

  const totalFte = entries.reduce((sum, e) => sum + (e.fte || 0), 0);

  const add = async () => {
    const fte = parseFte(fteDraft);
    if (fte === null) {
      showToast(t("staffing.fteInvalid"), "", "error");
      return;
    }
    const note = noteDraft.trim();
    setSaving(true);
    try {
      await saveChantierStaffing({
        id: newStaffingId(),
        companyId,
        programId,
        axisId,
        chantierId,
        function: functionDraft,
        fte,
        // Champ optionnel OMIS plutôt que passé à `undefined` : Firestore rejette `undefined`.
        ...(note !== "" ? { note } : {}),
        createdAt: new Date().toISOString().slice(0, 10),
      });
      setFteDraft("1");
      setNoteDraft("");
    } catch {
      showToast(t("staffing.saveError"), "", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteChantierStaffing(id);
    } catch {
      showToast(t("staffing.saveError"), "", "error");
    }
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

      {loading ? (
        <p className="text-[12px] text-tertiary">{t("staffing.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-tertiary">{t("staffing.empty")}</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded-md border border-border bg-white px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-primary">
                {t(`staffing.function.${entry.function}`)}
                {entry.note && <span className="ml-1.5 text-tertiary">· {entry.note}</span>}
              </span>
              <span className="whitespace-nowrap text-[12px] font-semibold text-primary">
                {formatFte(entry.fte)} {t("staffing.fteUnit")}
              </span>
              <button
                type="button"
                onClick={() => remove(entry.id)}
                aria-label={t("staffing.remove")}
                title={t("staffing.remove")}
                className="rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-bp-coral"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="block text-[11px] font-medium text-secondary">
            {t("staffing.function")}
            <select
              value={functionDraft}
              onChange={(e) => setFunctionDraft(e.target.value as StaffingFunction)}
              className={INPUT_CLASS}
            >
              {STAFFING_FUNCTIONS.map((fn) => (
                <option key={fn} value={fn}>
                  {t(`staffing.function.${fn}`)}
                </option>
              ))}
            </select>
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
        </div>
        <div className="flex items-end">
          <Button variant="outline" size="sm" onClick={add} disabled={saving}>
            <Plus size={12} /> {t("staffing.add")}
          </Button>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-tertiary">{t("staffing.hint")}</p>
    </div>
  );
}
