"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useToast } from "@/lib/hooks/useToast";
import { formatDateFr } from "@/lib/format";
import {
  canApproveLeverDeletion,
  canRequestLeverDeletion,
  leverDeletionRoles,
  type LeverDirectoryUser,
} from "@/lib/leversLogic";
import { useCompanyUsers } from "@/lib/hooks/useCompanyUsers";
import { isAnyAdmin } from "@/lib/roleProfiles";
import type { AuthUser, Lever, Workstream } from "@/types";

type DeletionActions = {
  workstreams: Workstream[];
  requestLeverDeletion: (id: string, reason?: string, users?: LeverDirectoryUser[]) => Lever;
  approveLeverDeletion: (id: string, users?: LeverDirectoryUser[]) => Promise<Lever>;
  cancelLeverDeletion: (id: string, users?: LeverDirectoryUser[]) => Lever;
};

/** L'utilisateur a-t-il quoi que ce soit à faire côté suppression sur ce levier (demander,
 *  confirmer/refuser, ou annuler sa propre demande) ? Sert à afficher le bouton poubelle. Un admin
 *  y a toujours accès : il peut tenir le rôle manquant (levier sans compte responsable de
 *  chantier, programme sans CTO) — le dialogue, qui charge l'annuaire, dit s'il peut agir. */
export function hasLeverDeletionAccess(
  lever: Lever,
  user: AuthUser | null | undefined,
  workstreams: Workstream[]
): boolean {
  const roles = leverDeletionRoles(lever, user, workstreams);
  return roles.cto || roles.sponsor || isAnyAdmin(user);
}

/**
 * Suppression d'un levier à double validation : le CTO OU le responsable de chantier du levier
 * demande, l'AUTRE rôle confirme (voir lib/leversLogic.ts::requestLeverDeletion). Le même
 * dialogue couvre les trois états : demander, confirmer/refuser (approbateur), annuler (demandeur).
 */
export function LeverDeletionDialog({
  lever,
  user,
  data,
  open,
  onOpenChange,
  onDeleted,
}: {
  lever: Lever | null;
  user: AuthUser | null | undefined;
  data: DeletionActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (lever: Lever) => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Annuaire : détecte l'absence de titulaire (responsable de chantier / CTO) qu'un admin peut
  // remplacer — toujours deux personnes différentes (voir leverDeletionRoles).
  const users = useCompanyUsers(user?.companyId);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!lever) return null;
  const req = lever.deletionRequest;
  const canRequest = canRequestLeverDeletion(lever, user, data.workstreams, users);
  const canApprove = canApproveLeverDeletion(lever, user, data.workstreams, users);
  const isRequester = !!req && req.requestedBy === user?.username;
  const roles = leverDeletionRoles(lever, user, data.workstreams, users);
  const actsAsAdmin = req
    ? canApprove && (req.requestedByRole === "cto" ? !roles.sponsor : !roles.cto)
    : canRequest && !roles.cto && !roles.sponsor;
  const approverLabel = req
    ? req.requestedByRole === "cto"
      ? t("leverDeletion.roleSponsor", "le responsable de chantier")
      : t("leverDeletion.roleCto", "le CTO")
    : roles.cto || (!roles.sponsor && roles.adminAsCto)
      ? t("leverDeletion.roleSponsor", "le responsable de chantier")
      : t("leverDeletion.roleCto", "le CTO");
  const adminNotice = actsAsAdmin ? (
    <p className="mt-2 text-[11px] text-tertiary">
      {t(
        "levers.approval.deletionAsAdmin",
        "Aucun titulaire pour ce rôle sur ce levier : vous agissez en tant qu'admin (la demande et la confirmation restent deux personnes différentes)."
      )}
    </p>
  ) : null;

  const run = async (fn: () => unknown | Promise<unknown>, title: string) => {
    setBusy(true);
    try {
      await fn();
      showToast(title, lever.name, "success");
      onOpenChange(false);
    } catch (err) {
      showToast(
        t("leverDeletion.error", "Action impossible"),
        err instanceof Error ? err.message : String(err),
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  let footer: React.ReactNode = (
    <Button variant="ghost" onClick={() => onOpenChange(false)}>
      {t("common.close", "Fermer")}
    </Button>
  );
  let body: React.ReactNode;

  if (!req) {
    body = canRequest ? (
      <>
        <p className="text-xs text-secondary">
          {t(
            "leverDeletion.requestIntro",
            "La suppression est définitive. Elle doit être confirmée par {approver} avant d'être effective."
          ).replace("{approver}", approverLabel)}
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            {t("leverDeletion.reason", "Motif (facultatif)")}
          </span>
          <textarea
            rows={3}
            className="w-full rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-black focus:outline-none"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {adminNotice}
      </>
    ) : (
      <p className="text-xs text-secondary">
        {t(
          "leverDeletion.notAllowed",
          "Seuls le CTO et le responsable de chantier du levier peuvent en demander la suppression."
        )}
      </p>
    );
    if (canRequest) {
      footer = (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel", "Annuler")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              run(
                () => data.requestLeverDeletion(lever.id, reason, users),
                t("leverDeletion.requested", "Demande de suppression envoyée")
              )
            }
          >
            <Trash2 size={13} /> {t("leverDeletion.request", "Demander la suppression")}
          </Button>
        </>
      );
    }
  } else {
    body = (
      <>
        <div className="rounded-sm border border-bp-coral/40 bg-bp-coral/5 px-3 py-2 text-xs text-primary">
          {t("leverDeletion.pendingInfo", "Suppression demandée par {name} ({role}) le {date}.")
            .replace("{name}", req.requestedByName)
            .replace(
              "{role}",
              req.requestedByRole === "cto"
                ? "CTO"
                : t("roles.sponsor.label", "Responsable de chantier")
            )
            .replace("{date}", formatDateFr(req.requestedAt))}
          {req.reason && (
            <div className="mt-1 text-secondary">
              {t("leverDeletion.reasonLabel", "Motif")} : {req.reason}
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-secondary">
          {canApprove
            ? t(
                "leverDeletion.approveIntro",
                "Confirmer supprimera définitivement le levier, son plan d'action et ses impacts."
              )
            : t("leverDeletion.waiting", "En attente de la confirmation de {approver}.").replace(
                "{approver}",
                approverLabel
              )}
        </p>
        {adminNotice}
      </>
    );
    if (canApprove) {
      footer = (
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(
                () => data.cancelLeverDeletion(lever.id, users),
                t("leverDeletion.refused", "Demande de suppression refusée")
              )
            }
          >
            {t("leverDeletion.refuse", "Refuser")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              run(
                async () => {
                  const deleted = await data.approveLeverDeletion(lever.id, users);
                  onDeleted?.(deleted);
                },
                t("leverDeletion.deleted", "Levier supprimé")
              )
            }
          >
            <Trash2 size={13} /> {t("leverDeletion.confirm", "Confirmer la suppression")}
          </Button>
        </>
      );
    } else if (isRequester) {
      footer = (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close", "Fermer")}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(
                () => data.cancelLeverDeletion(lever.id, users),
                t("leverDeletion.cancelled", "Demande de suppression annulée")
              )
            }
          >
            {t("leverDeletion.cancelRequest", "Annuler la demande")}
          </Button>
        </>
      );
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("leverDeletion.title", "Supprimer le levier « {name} »").replace(
        "{name}",
        lever.name
      )}
      maxWidth="520px"
      footer={footer}
    >
      {body}
    </Modal>
  );
}
