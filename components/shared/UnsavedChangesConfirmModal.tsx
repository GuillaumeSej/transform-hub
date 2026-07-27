"use client";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";

/**
 * Modale globale de confirmation, montée une seule fois dans `app/(app)/layout.tsx`.
 * Elle s'ouvre dès que `confirmDiscard()` est appelé alors qu'un scope est "sale" — le résultat
 * (rester / quitter) est renvoyé au caller via la Promise résolue.
 */
export function UnsavedChangesConfirmModal() {
  const { _pendingConfirm, _resolvePendingConfirm } = useUnsavedChanges();
  const { t } = useTranslation();
  const open = _pendingConfirm !== null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // Fermeture "en dehors" (croix, Escape, clic sur l'overlay) = on reste sur la page.
        if (!next) _resolvePendingConfirm(false);
      }}
      title={t("unsavedChanges.title")}
      footer={
        <>
          <Button variant="ghost" onClick={() => _resolvePendingConfirm(false)}>
            {t("unsavedChanges.stay")}
          </Button>
          <Button variant="danger" onClick={() => _resolvePendingConfirm(true)}>
            {t("unsavedChanges.leave")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-secondary">{t("unsavedChanges.body")}</p>
    </Modal>
  );
}
