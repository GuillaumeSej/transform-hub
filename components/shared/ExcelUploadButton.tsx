"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import {
  parseLeverExcelRow,
  parseSubLeverExcelRow,
  type LeverImportInput,
  type SubLeverImportInput,
} from "@/lib/leverExcel";
import type { useBeTrackData } from "@/lib/hooks/useStorage";
import type { Lever } from "@/types";

type PreviewRow = { rowNumber: number; values: LeverImportInput | null; warnings: string[] };
type SubLeverPreviewRow = {
  rowNumber: number;
  values: SubLeverImportInput | null;
  warnings: string[];
};

type PreviewData = {
  leverRows: PreviewRow[];
  subLeverRows: SubLeverPreviewRow[];
};

export function ExcelUploadButton({ data, companyId }: { data: ReturnType<typeof useBeTrackData>; companyId?: string | null }) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [fileName, setFileName] = useState("");

  const handleFile = async (file: File) => {
    const workbook = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });

    const leverSheetName = workbook.SheetNames[0];
    const leverRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[leverSheetName],
      { defval: "" }
    );
    const parsedLevers = leverRows.map((row, i) => {
      const { values, warnings } = parseLeverExcelRow(row, data, i + 2);
      const withCompany = values && companyId ? { ...values, companyId } as LeverImportInput : values;
      return { rowNumber: i + 2, values: withCompany, warnings };
    });

    const slSheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("sous-levier"));
    let parsedSubLevers: SubLeverPreviewRow[] = [];
    if (slSheetName) {
      const slRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[slSheetName],
        { defval: "" }
      );
      const validParsedLevers = parsedLevers.filter((r) => r.values !== null);
      const virtualLeversForPreview = validParsedLevers.map((r, idx) => {
        const v = r.values!;
        return { ...v, id: `__preview_${idx}`, createdAt: "", lastUpdate: "" } as Lever;
      });
      const dataWithVirtualLevers = {
        ...data,
        levers: [...data.levers, ...virtualLeversForPreview],
      };
      parsedSubLevers = slRows.map((row, i) => {
        const { values, warnings } = parseSubLeverExcelRow(row, dataWithVirtualLevers, i + 2);
        return { rowNumber: i + 2, values, warnings };
      });
    }

    setFileName(file.name);
    setPreview({ leverRows: parsedLevers, subLeverRows: parsedSubLevers });
  };

  const validLevers = preview?.leverRows.filter((r) => r.values !== null) ?? [];
  const invalidLevers = preview?.leverRows.filter((r) => r.values === null) ?? [];
  const validSubLevers = preview?.subLeverRows.filter((r) => r.values !== null) ?? [];
  const invalidSubLevers = preview?.subLeverRows.filter((r) => r.values === null) ?? [];
  const warningCount =
    (preview?.leverRows.reduce((s, r) => s + r.warnings.length, 0) ?? 0) +
    (preview?.subLeverRows.reduce((s, r) => s + r.warnings.length, 0) ?? 0);
  const totalValid = validLevers.length + validSubLevers.length;

  const confirmImport = () => {
    if (!preview) return;
    let created = 0;
    let updated = 0;
    const upsertedLevers = new Map<string, Lever>();
    preview.leverRows.forEach((row) => {
      if (!row.values) return;
      const { lever, created: wasCreated } = data.upsertLeverByCode(row.values as LeverImportInput);
      upsertedLevers.set(lever.code.toLowerCase(), lever);
      if (wasCreated) created += 1;
      else updated += 1;
    });
    let slCreated = 0;
    let slUpdated = 0;
    preview.subLeverRows.forEach((row) => {
      if (!row.values) return;
      const sl = row.values;
      const lever =
        upsertedLevers.get(sl.leverCode.toLowerCase()) ??
        data.levers.find((l) => l.code.toLowerCase() === sl.leverCode.toLowerCase());
      if (!lever) return;
      const existing = data.subLevers.find(
        (s) => s.leverId === lever.id && s.name.toLowerCase() === sl.name.toLowerCase()
      );
      if (existing) {
        data.updateSubLever(existing.id, {
          expensePost: sl.expensePost,
          businessUnit: sl.businessUnit,
          pnlMap: sl.pnlMap,
          grossSavings: sl.grossSavings,
          netSavings: sl.netSavings,
          opexOneOff: sl.opexOneOff,
          opexRec: sl.opexRec,
          capex: sl.capex,
          fteImpact: sl.fteImpact,
          popImpacted: sl.popImpacted,
          start: sl.start,
          end: sl.end,
          status: sl.status,
          priority: sl.priority,
          risk: sl.risk,
          dependencies: sl.dependencies,
        });
        slUpdated += 1;
      } else {
        data.createSubLever({
          leverId: lever.id,
          name: sl.name,
          owner: sl.owner || lever.owner,
          ownerInit: sl.owner
            ? sl.owner
                .split(" ")
                .map((x) => x[0])
                .join("")
                .slice(0, 2)
            : lever.ownerInit,
          expensePost: sl.expensePost,
          businessUnit: sl.businessUnit,
          pnlMap: sl.pnlMap,
          grossSavings: sl.grossSavings,
          netSavings: sl.netSavings,
          opexOneOff: sl.opexOneOff,
          opexRec: sl.opexRec,
          capex: sl.capex,
          fteImpact: sl.fteImpact,
          popImpacted: sl.popImpacted,
          start: sl.start,
          end: sl.end,
          status: sl.status,
          priority: sl.priority,
          risk: sl.risk,
          companyId: lever.companyId,
          dependencies: sl.dependencies,
          actions: [],
        });
        slCreated += 1;
      }
    });
    const totalInvalid = invalidLevers.length + invalidSubLevers.length;
    const slMsg =
      preview.subLeverRows.length > 0
        ? ` · ${slCreated + slUpdated} sous-levier(s) (${slCreated} créé(s), ${slUpdated} mis à jour)`
        : "";
    showToast(
      "Import Excel terminé",
      `${created} créé(s), ${updated} mis à jour, ${totalInvalid} ignoré(s)${slMsg}`,
      "success"
    );
    setPreview(null);
    setFileName("");
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        <Upload size={13} /> Importer Excel
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={`Prévisualisation de l'import — ${fileName}`}
        maxWidth="640px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Annuler
            </Button>
            <Button variant="primary" disabled={totalValid === 0} onClick={confirmImport}>
              Confirmer l&apos;import ({totalValid})
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{validLevers.length}</strong> levier(s) valide(s)
          </span>
          <span>
            <strong className="text-rag-red">{invalidLevers.length}</strong> levier(s) ignoré(s)
          </span>
          {preview && preview.subLeverRows.length > 0 && (
            <>
              <span>
                <strong className="text-rag-green-dark">{validSubLevers.length}</strong> sous-levier(s) valide(s)
              </span>
              <span>
                <strong className="text-rag-red">{invalidSubLevers.length}</strong> sous-levier(s) ignoré(s)
              </span>
            </>
          )}
          <span>
            <strong className="text-rag-amber">{warningCount}</strong> avertissement(s)
          </span>
        </div>
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview &&
          preview.leverRows.every((r) => r.warnings.length === 0) &&
          preview.subLeverRows.every((r) => r.warnings.length === 0) ? (
            <p className="text-tertiary">Aucune anomalie détectée.</p>
          ) : (
            preview &&
            [
              ...preview.leverRows.flatMap((r) => r.warnings),
              ...preview.subLeverRows.flatMap((r) => r.warnings),
            ].map((w, i) => (
              <div key={i} className="text-secondary">
                {w}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
