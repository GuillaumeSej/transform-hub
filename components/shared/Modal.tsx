"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Modal générique — porté depuis `.modal` du prototype legacy, implémenté avec Radix Dialog. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
  maxWidth = "480px",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border-t-4 border-bp-coral bg-white shadow-2xl"
          style={{ maxWidth }}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="text-base font-bold text-primary">{title}</Dialog.Title>
            <Dialog.Close className="p-1 text-tertiary hover:text-primary hover:underline">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border bg-neutral-50 px-5 py-3.5">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
