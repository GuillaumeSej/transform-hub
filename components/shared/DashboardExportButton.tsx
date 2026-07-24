"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import pptxgen from "pptxgenjs";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";

/** Sélecteur du conteneur de grille (voir `app/(app)/dashboard/page.tsx`) et des widgets qu'il
 * contient — ne référence AUCUN type de widget précis : que ce soit un widget du registre actuel
 * ou un widget ajouté plus tard par le futur "custom widget builder", tant qu'il respecte ce
 * contrat d'attributs (posé par `renderWidgetShell`), il est automatiquement inclus dans l'export.
 * C'est ce qui garantit "si on ajoute un nouveau graphique, il doit se retrouver dans l'export"
 * sans jamais retoucher ce fichier. Personnalisable via la prop `gridSelector` (voir plus bas) pour
 * que le Dashboard RH puisse réutiliser ce même composant sur SON conteneur de grille
 * (`data-hr-dashboard-widget-grid`) sans dupliquer la logique de capture/génération PPTX.
 * `DEFAULT_GRID_SELECTOR` reste le comportement historique du dashboard exécutif, inchangé. */
const DEFAULT_GRID_SELECTOR = "[data-dashboard-widget-grid]";
const WIDGET_SELECTOR = "[data-widget-id]";

const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const IMAGE_MAX_W_IN = 12.5;
const IMAGE_MAX_H_IN = 6.2;
const IMAGE_TOP_IN = 1.0;

function loadImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || 1200, height: img.naturalHeight || 800 });
    img.onerror = () => resolve({ width: 1200, height: 800 });
    img.src = dataUrl;
  });
}

// Délai max accordé à la capture d'UN widget avant de l'abandonner et de passer au suivant —
// `html-to-image` tente d'intégrer les polices/ressources référencées par les feuilles de style,
// ce qui peut rester bloqué indéfiniment si une ressource ne répond jamais (réseau restreint,
// police externe indisponible...). Un widget en échec ne doit jamais empêcher l'export des autres.
const WIDGET_CAPTURE_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Capture de "${label}" abandonnée après ${ms}ms`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Export PowerPoint RÉEL du dashboard exécutif : un slide par widget actuellement affiché
 * (fond blanc, capturé en image depuis le DOM via `html-to-image`), assemblé en .pptx via
 * `pptxgenjs` (les deux entièrement côté client, aucun backend). Contrairement à l'ancien stub
 * (`ExportButton` type="pptx"), cette version parcourt dynamiquement les nœuds `[data-widget-id]`
 * présents dans la grille au moment du clic — jamais une liste figée de types de widgets — donc
 * un widget ajouté plus tard (custom widget builder à venir) apparaît dans l'export sans y
 * toucher.
 */
export function DashboardExportButton({
  layout,
  gridSelector = DEFAULT_GRID_SELECTOR,
  coverTitle = "BeTrack — Executive Dashboard",
  fileNamePrefix = "betrack_dashboard",
}: {
  /** Layout actuellement affiché — seul `.length` est utilisé (désactive l'export si vide) ; type
   *  élargi à `{ length: number }` pour rester utilisable tel quel avec `HrWidgetInstance[]` (voir
   *  `app/(app)/hr/page.tsx`) sans coupler ce composant partagé à un type de widget précis. */
  layout: { length: number };
  /** Conteneur de grille à scanner pour les nœuds `[data-widget-id]` — par défaut celui du
   *  dashboard exécutif, inchangé pour son propre usage. */
  gridSelector?: string;
  coverTitle?: string;
  fileNamePrefix?: string;
}) {
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);
  const disabled = exporting || layout.length === 0;

  const handleExport = async () => {
    if (disabled) return;

    const grid = document.querySelector<HTMLElement>(gridSelector);
    const nodes = grid ? Array.from(grid.querySelectorAll<HTMLElement>(WIDGET_SELECTOR)) : [];
    if (nodes.length === 0) {
      showToast(
        "Export impossible",
        "Aucun widget affiché sur le dashboard à exporter pour le moment.",
        "error"
      );
      return;
    }

    setExporting(true);
    try {
      const pptx = new pptxgen();
      pptx.defineLayout({ name: "BETRACK_WIDE", width: SLIDE_WIDTH_IN, height: SLIDE_HEIGHT_IN });
      pptx.layout = "BETRACK_WIDE";

      const cover = pptx.addSlide();
      cover.background = { color: "111111" };
      cover.addText(coverTitle, {
        x: 0.6,
        y: 3.0,
        w: SLIDE_WIDTH_IN - 1.2,
        h: 1,
        fontSize: 32,
        bold: true,
        color: "FFFFFF",
      });
      cover.addText(new Date().toLocaleDateString("fr-FR"), {
        x: 0.6,
        y: 3.9,
        w: SLIDE_WIDTH_IN - 1.2,
        h: 0.5,
        fontSize: 14,
        color: "CBD5E1",
      });

      let failures = 0;
      for (const node of nodes) {
        const title = node.getAttribute("data-widget-title") || "Widget";
        try {
          const dataUrl = await withTimeout(
            toPng(node, {
              backgroundColor: "#ffffff",
              pixelRatio: 2,
              cacheBust: true,
              skipFonts: true,
            }),
            WIDGET_CAPTURE_TIMEOUT_MS,
            title
          );
          const { width: naturalW, height: naturalH } = await loadImageSize(dataUrl);

          const slide = pptx.addSlide();
          slide.addText(title, {
            x: 0.5,
            y: 0.3,
            w: SLIDE_WIDTH_IN - 1,
            h: 0.5,
            fontSize: 20,
            bold: true,
            color: "1F2937",
          });

          const ratio = naturalW / naturalH || 1;
          let w = IMAGE_MAX_W_IN;
          let h = w / ratio;
          if (h > IMAGE_MAX_H_IN) {
            h = IMAGE_MAX_H_IN;
            w = h * ratio;
          }
          const x = (SLIDE_WIDTH_IN - w) / 2;
          const y = IMAGE_TOP_IN + (IMAGE_MAX_H_IN - h) / 2;
          slide.addImage({ data: dataUrl, x, y, w, h });
        } catch (err) {
          failures += 1;
          console.error(`[betrack] échec de capture du widget "${title}" :`, err);
        }
      }

      await pptx.writeFile({
        fileName: `${fileNamePrefix}_${new Date().toISOString().slice(0, 10)}.pptx`,
      });

      if (failures > 0) {
        showToast(
          "Export PowerPoint généré (partiel)",
          `${nodes.length - failures} / ${nodes.length} widgets exportés, ${failures} en échec`,
          "default"
        );
      } else {
        showToast(
          "Export PowerPoint généré",
          `${nodes.length} widget${nodes.length > 1 ? "s" : ""} exporté${nodes.length > 1 ? "s" : ""}`,
          "success"
        );
      }
    } catch (err) {
      console.error("[betrack] échec de l'export PowerPoint :", err);
      showToast(
        "Échec de l'export",
        "Impossible de générer le support PowerPoint. Réessayez.",
        "error"
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleExport} disabled={disabled} title="Export COPIL deck">
      {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
      {exporting ? "Export en cours..." : "Export COPIL deck"}
    </Button>
  );
}
