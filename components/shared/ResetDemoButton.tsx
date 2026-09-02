"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Bouton discret de reset démo — remplace resetScenario() du prototype legacy, avec confirmation. */
export function ResetDemoButton({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();
  const { t } = useTranslation();

  return (
    <>
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={() => setOpen(true)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black"
              aria-label={t("shared.resetDemoButton.label", "Réinitialiser les données démo")}
            >
              <RotateCcw size={14} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-[11px] text-white"
              sideOffset={6}
            >
              {t("shared.resetDemoButton.label", "Réinitialiser les données démo")}
              <Tooltip.Arrow className="fill-neutral-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("shared.resetDemoButton.confirmTitle", "Réinitialiser les données démo ?")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onReset();
                setOpen(false);
                showToast(
                  t("adminCompanyDb.toastResetSuccessTitle", "Données réinitialisées"),
                  t("shared.resetDemoButton.toastBody", "Retour au jeu de données de démo"),
                  "success"
                );
              }}
            >
              {t("dashboard.reset", "Réinitialiser")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-secondary">
          {t(
            "shared.resetDemoButton.body",
            "Toutes les modifications effectuées dans cette session (leviers, commentaires, alertes résolues, audit) seront définitivement perdues et remplacées par le jeu de données de démo initial."
          )}
        </p>
      </Modal>
    </>
  );
}
