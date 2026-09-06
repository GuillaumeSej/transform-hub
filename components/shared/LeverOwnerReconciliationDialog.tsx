"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import {
  matchLeverOwner,
  type OwnerMatchCandidate,
  type OwnerMatchResult,
} from "@/lib/leverOwnerReconciliation";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser } from "@/types";

/** Une ligne (levier) importée nécessitant une décision de réconciliation propriétaire — le strict
 *  minimum requis par ce composant, indépendant de la forme exacte de `LeverImportRow`. */
export type ReconciliationLeverRow = { code: string; name: string; owner: string };

/** Décision résolue pour un levier — `owner`/`ownerUsername` prêts à réappliquer directement sur la
 *  ligne d'import correspondante (voir doc-comment `Lever.owner`/`Lever.ownerUsername`,
 *  types/index.ts : "aucun compte" vide `owner` plutôt que de garder le texte libre d'origine). */
export type OwnerReconciliationDecision = { owner: string; ownerUsername?: string };

function candidatesToOwnerFields(candidate: OwnerMatchCandidate): OwnerReconciliationDecision {
  return { owner: candidate.name, ownerUsername: candidate.username };
}

const NONE_DECISION: OwnerReconciliationDecision = { owner: "", ownerUsername: undefined };

export type PendingReconciliationItem = {
  row: ReconciliationLeverRow;
  match: OwnerMatchResult;
  /** Décision courante de l'admin pour cette ligne — `undefined` = pas encore décidée. */
  decision?: OwnerReconciliationDecision;
  /** Pour le cas "unique" refusé ("Non") : bascule sur le sélecteur manuel plutôt que de revenir à
   *  Oui/Non indéfiniment. */
  manualPickerOpen?: boolean;
};

/**
 * Construit la liste des leviers nécessitant une décision de réconciliation à partir d'un aperçu
 * d'import — skip silencieusement les lignes sans texte de propriétaire (rien à rapprocher, voir
 * doc-comment `matchLeverOwner`). Exporté pour que l'appelant (`LeverImportButton`) décide d'ouvrir
 * ou non ce dialogue AVANT de le monter (liste vide = pas besoin de réconciliation du tout, on
 * écrit directement).
 */
export function buildReconciliationQueue(
  rows: ReconciliationLeverRow[],
  companyUsers: AuthUser[]
): PendingReconciliationItem[] {
  const candidates: OwnerMatchCandidate[] = companyUsers.map((u) => ({
    username: u.username,
    name: u.name,
  }));
  return rows
    .filter((row) => row.owner.trim() !== "")
    .map((row) => ({ row, match: matchLeverOwner(row.owner, candidates) }));
}

/**
 * Dialogue de réconciliation propriétaire, affiché après validation de l'aperçu d'import Excel et
 * AVANT l'écriture finale (voir `components/shared/LeverImportButton.tsx`) — round "ownership réel"
 * (voir doc-comment `Lever.ownerUsername`, types/index.ts). Liste TOUS les leviers de l'import ayant
 * un texte de propriétaire non vide (un par ligne, défilable — gère aussi bien 1 que 30 leviers en
 * une seule fois) et fait choisir l'admin, levier par levier :
 *  - "unique" : Oui (accepte le candidat) / Non (bascule sur le sélecteur manuel).
 *  - "homonyms" : liste de candidats (nom + username) + "Aucun de ceux-là".
 *  - "none" : message d'absence de correspondance + sélecteur manuel (tous les comptes de
 *    l'entreprise) + "Laisser vide".
 * Ne se ferme (bouton "Confirmer") que lorsque CHAQUE ligne a une décision — `onResolve` reçoit
 * alors la décision par code de levier, à réappliquer par l'appelant sur `LeverImportPreview.toUpsert`
 * avant `data.importLevers(rows)`.
 */
export function LeverOwnerReconciliationDialog({
  open,
  queue,
  companyUsers,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  queue: PendingReconciliationItem[];
  companyUsers: AuthUser[];
  onCancel: () => void;
  onConfirm: (decisions: Map<string, OwnerReconciliationDecision>) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PendingReconciliationItem[]>(queue);

  // Le contenu de `queue` ne change qu'à l'ouverture (un nouvel import) — resynchronise l'état
  // local uniquement quand la référence change, jamais à chaque rendu.
  useMemo(() => {
    setItems(queue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const sortedUsers = useMemo(
    () => [...companyUsers].sort((a, b) => a.name.localeCompare(b.name)),
    [companyUsers]
  );

  const setDecision = (index: number, decision: OwnerReconciliationDecision | undefined) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, decision } : item)));
  };

  const openManualPicker = (index: number) => {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, manualPickerOpen: true } : item))
    );
  };

  const allDecided = items.every((item) => item.decision !== undefined);

  const handleConfirm = () => {
    const decisions = new Map<string, OwnerReconciliationDecision>();
    items.forEach((item) => {
      if (item.decision) decisions.set(item.row.code, item.decision);
    });
    onConfirm(decisions);
  };

  const manualPicker = (index: number) => (
    <select
      className="w-full rounded-sm border border-border px-2 py-1.5 text-xs focus:border-black focus:outline-none"
      defaultValue=""
      onChange={(e) => {
        if (!e.target.value) {
          setDecision(index, NONE_DECISION);
          return;
        }
        const user = sortedUsers.find((u) => u.username === e.target.value);
        if (user)
          setDecision(index, candidatesToOwnerFields({ username: user.username, name: user.name }));
      }}
    >
      <option value="" disabled>
        {t("shared.leverOwnerReconciliation.pickUser", "Choisir un compte…")}
      </option>
      {sortedUsers.map((u) => (
        <option key={u.username} value={u.username}>
          {u.name} ({u.username})
        </option>
      ))}
    </select>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      title={t("shared.leverOwnerReconciliation.title", "Confirmation des propriétaires de levier")}
      maxWidth="720px"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel", "Annuler")}
          </Button>
          <Button variant="primary" disabled={!allDecided} onClick={handleConfirm}>
            {t("shared.leverOwnerReconciliation.confirmButton", "Valider et importer")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-secondary">
        {t(
          "shared.leverOwnerReconciliation.intro",
          "Les leviers doivent être rattachés à un compte utilisateur réel. Confirmez ou choisissez le compte pour chacun des leviers ci-dessous."
        )}
      </p>
      <div className="max-h-[420px] space-y-3 overflow-y-auto">
        {items.map((item, index) => {
          const { row, match, decision, manualPickerOpen } = item;
          const decided = decision !== undefined;
          return (
            <div
              key={row.code}
              className={`rounded-md border p-3 text-xs ${decided ? "border-rag-green-dark/40 bg-rag-green-dark/5" : "border-border bg-neutral-50"}`}
            >
              <div className="mb-2 font-semibold text-primary">
                {row.code} — {row.name}
              </div>

              {match.kind === "unique" && !manualPickerOpen && (
                <div className="space-y-1.5">
                  <p className="text-secondary">
                    {t(
                      "shared.leverOwnerReconciliation.uniqueQuestion",
                      'Le propriétaire "{owner}" est-il bien {name} ({username}) ?'
                    )
                      .replace("{owner}", row.owner)
                      .replace("{name}", match.candidate.name)
                      .replace("{username}", match.candidate.username)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={
                        decision?.ownerUsername === match.candidate.username ? "primary" : "outline"
                      }
                      onClick={() => setDecision(index, candidatesToOwnerFields(match.candidate))}
                    >
                      {t("common.yes", "Oui")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => openManualPicker(index)}>
                      {t("common.no", "Non")}
                    </Button>
                  </div>
                </div>
              )}

              {match.kind === "homonyms" && (
                <div className="space-y-1.5">
                  <p className="text-secondary">
                    {t(
                      "shared.leverOwnerReconciliation.homonymsQuestion",
                      'Plusieurs comptes correspondent à "{owner}" — lequel est le bon ?'
                    ).replace("{owner}", row.owner)}
                  </p>
                  <div className="space-y-1">
                    {match.candidates.map((candidate) => (
                      <label
                        key={candidate.username}
                        className="flex items-center gap-2 rounded-sm border border-border bg-white px-2 py-1.5"
                      >
                        <input
                          type="radio"
                          name={`homonym-${row.code}`}
                          checked={decision?.ownerUsername === candidate.username}
                          onChange={() => setDecision(index, candidatesToOwnerFields(candidate))}
                        />
                        {candidate.name} ({candidate.username})
                      </label>
                    ))}
                    <label className="flex items-center gap-2 rounded-sm border border-border bg-white px-2 py-1.5">
                      <input
                        type="radio"
                        name={`homonym-${row.code}`}
                        checked={decision !== undefined && decision.ownerUsername === undefined}
                        onChange={() => setDecision(index, NONE_DECISION)}
                      />
                      {t("shared.leverOwnerReconciliation.noneOfThem", "Aucun de ceux-là")}
                    </label>
                  </div>
                </div>
              )}

              {(match.kind === "none" || (match.kind === "unique" && manualPickerOpen)) && (
                <div className="space-y-1.5">
                  <p className="text-secondary">
                    {t(
                      "shared.leverOwnerReconciliation.noneQuestion",
                      'Aucun compte utilisateur ne correspond à "{owner}" pour cette entreprise.'
                    ).replace("{owner}", row.owner)}
                  </p>
                  {manualPicker(index)}
                  <label className="flex items-center gap-2 text-secondary">
                    <input
                      type="checkbox"
                      checked={decision !== undefined && decision.ownerUsername === undefined}
                      onChange={(e) =>
                        setDecision(index, e.target.checked ? NONE_DECISION : undefined)
                      }
                    />
                    {t("shared.leverOwnerReconciliation.leaveEmpty", "Laisser vide")}
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
