"use client";

import { useCallback } from "react";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { approvalErrorToast } from "@/lib/strategicApprovalUi";

/**
 * Toast d'erreur d'un flux de validation stratégique (`lib/strategicApprovalFlows.ts`) :
 * `ApprovalRetryError` → « Données en cours de chargement, réessayez » ; refus / porte absente /
 * autre → message de l'erreur. Renvoie la nature de l'erreur (voir `approvalErrorKind`).
 */
export function useApprovalErrorToast() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  return useCallback(
    (error: unknown) => {
      const toast = approvalErrorToast(error, {
        title: t("leverDetail.approval.error", "Action impossible"),
        retryTitle: t("strategicFiche.retry.title", "Données en cours de chargement"),
        retry: t(
          "strategicFiche.retry.message",
          "Les données sont en cours de chargement : réessayez dans un instant."
        ),
        fallback: t("strategicFiche.error.generic", "L'action n'a pas pu être effectuée."),
      });
      if (toast.kind === "other")
        console.error("[betrack] échec d'une action stratégique :", error);
      showToast(toast.title, toast.message, "error");
      return toast.kind;
    },
    [t, showToast]
  );
}
