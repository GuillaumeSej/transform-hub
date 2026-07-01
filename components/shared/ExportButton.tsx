"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";

/** Stub d'export — "Export COPIL deck" (PPTX) / "Export Excel", avec toast de confirmation. */
export function ExportButton({ type = "excel" }: { type?: "excel" | "pptx" }) {
  const { showToast } = useToast();
  const label = type === "excel" ? "Export Excel" : "Export COPIL deck";
  const Icon = type === "excel" ? FileSpreadsheet : FileText;

  return (
    <Button
      variant="outline"
      onClick={() =>
        showToast(
          "Export en cours de préparation",
          type === "excel"
            ? "Génération du fichier Excel..."
            : "Génération du support PowerPoint..."
        )
      }
    >
      <Icon size={13} /> {label}
    </Button>
  );
}
