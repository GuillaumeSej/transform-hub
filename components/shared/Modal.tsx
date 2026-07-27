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
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border-t-4 border-bp-coral bg-white shadow-2xl sm:w-full"
          style={{ maxWidth }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5 sm:py-4">
            <Dialog.Title className="text-base font-bold text-primary">{title}</Dialog.Title>
            <Dialog.Close className="flex h-11 w-11 items-center justify-center text-tertiary hover:text-primary">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">{children}</div>
          {footer && (
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-neutral-50 px-4 py-3 sm:flex-row sm:justify-end sm:px-5 sm:py-3.5">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
