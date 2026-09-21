"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Pop-up de confirmation de suppression (chantier ou projet) : conséquences, motif obligatoire,
 *  mention de l'approbation hiérarchique. `onConfirm(reason)` = handler `onRequestDelete...`. */
export function DeleteRequestModal({
  open,
  onOpenChange,
  kind,
  name,
  projetCount,
  milestoneCount,
  approvers,
  canApproveSelf,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "chantier" | "projet";
  name: string;
  projetCount: number;
  milestoneCount: number;
  approvers: string[];
  canApproveSelf: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isChantier = kind === "chantier";
  const approverRole = isChantier
    ? t("strategicDelete.approver.axis", "le responsable de l'axe")
    : t("strategicDelete.approver.chantier", "le responsable du chantier");

  const submit = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        isChantier
          ? t("strategicDelete.title.chantier", "Supprimer le chantier")
          : t("strategicDelete.title.projet", "Supprimer le projet")
      }
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={!reason.trim() || busy}>
            {canApproveSelf
              ? t("strategicDelete.confirm", "Supprimer définitivement")
              : t("strategicDelete.request", "Envoyer la demande d'approbation")}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-primary">
        {t("strategicDelete.intro", "Vous allez supprimer « {name} ».").replace("{name}", name)}
      </p>
      <p className="mt-2 text-[12.5px] text-secondary">
        {isChantier
          ? t(
              "strategicDelete.consequences.chantier",
              "Conséquences : {projets} projet(s) et {jalons} jalon(s) rattachés seront supprimés. Action irréversible."
            )
              .replace("{projets}", String(projetCount))
              .replace("{jalons}", String(milestoneCount))
          : t(
              "strategicDelete.consequences.projet",
              "Conséquences : le projet et ses {jalons} jalon(s) seront supprimés. Action irréversible."
            ).replace("{jalons}", String(milestoneCount))}
      </p>
      <label className="mt-3 block text-[12px] font-semibold text-secondary">
        {t("strategicDelete.reason", "Motif de la suppression")}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-border bg-white px-3 py-1.5 text-[12.5px] font-normal text-primary outline-none focus:border-bp-coral"
        />
      </label>
      <p className="mt-3 rounded-md border border-border bg-neutral-50 p-2 text-[12px] text-secondary">
        {canApproveSelf
          ? t(
              "strategicDelete.approval.self",
              "Vous êtes {role} : la suppression sera appliquée immédiatement."
            ).replace("{role}", approverRole)
          : t(
              "strategicDelete.approval.needed",
              "Une approbation de {role} est requise ({names}). La suppression ne sera effective qu'après validation."
            )
              .replace("{role}", approverRole)
              .replace("{names}", approvers.join(", "))}
      </p>
    </Modal>
  );
}
