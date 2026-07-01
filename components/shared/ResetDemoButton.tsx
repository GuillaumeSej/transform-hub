"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";

/** Bouton discret de reset démo — remplace resetScenario() du prototype legacy, avec confirmation. */
export function ResetDemoButton({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();

  return (
    <>
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={() => setOpen(true)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-bp-coral hover:text-bp-coral"
              aria-label="Réinitialiser les données démo"
            >
              <RotateCcw size={14} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-[11px] text-white"
              sideOffset={6}
            >
              Réinitialiser les données démo
              <Tooltip.Arrow className="fill-neutral-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Réinitialiser les données démo ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onReset();
                setOpen(false);
                showToast("Données réinitialisées", "Retour au jeu de données de démo", "success");
              }}
            >
              Réinitialiser
            </Button>
          </>
        }
      >
        <p className="text-sm text-secondary">
          Toutes les modifications effectuées dans cette session (leviers, commentaires, alertes
          résolues, audit) seront définitivement perdues et remplacées par le jeu de données de démo
          initial.
        </p>
      </Modal>
    </>
  );
}
