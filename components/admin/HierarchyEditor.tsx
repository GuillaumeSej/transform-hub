"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Plus,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  Download,
  Upload,
  FileSpreadsheet,
  GitBranch,
} from "lucide-react";
import type {
  Company,
  HierarchyDomain,
  HierarchyLevelDef,
  HierarchyNode,
  HierarchySemantic,
} from "@/types";
import {
  saveCompanyHierarchyLevels,
  subscribeHierarchyNodes,
  saveHierarchyNode,
  saveHierarchyNodesBatch,
  deleteHierarchyNode,
  deleteHierarchyNodesBatch,
} from "@/lib/firestore/admin";
import {
  buildHierarchyForest,
  buildHierarchyNodePayload,
  resolveHierarchyPath,
  type HierarchyTreeNode,
} from "@/lib/hierarchyLogic";
import {
  HIERARCHY_EXCEL_HEADERS,
  hierarchyNodeToExcelRow,
  validateHierarchyImportRows,
  type HierarchyImportPreview,
} from "@/lib/hierarchyExcel";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";

let nodeSeq = 0;
const EMPTY_NODE_FORM = {
  code: "",
  label: "",
  parentId: "",
  baseline: "",
  sign: "1" as const,
  computed: false,
  selectable: true,
};

function nextNodeId() {
  nodeSeq += 1;
  return `HN-${Date.now()}-${nodeSeq}`;
}

/** Chemin complet "Macro › … › maille" d'un nœud, utilisé pour désambiguïser le sélecteur de
 *  parent et l'affichage des nœuds dès que l'arbre a 3+ niveaux — sans ça, deux nœuds de même
 *  libellé sous des branches différentes (ex. deux "Procurement" sous deux BU distinctes) sont
 *  indiscernables dans une simple liste plate. */
function ancestryLabel(
  nodeId: string,
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): string {
  const path = resolveHierarchyPath(nodeId, nodes, levels);
  return path.map((p) => p.label).join(" › ");
}

function semantics(
  t: (key: string, fallback?: string) => string
): Record<HierarchyDomain, { value: HierarchySemantic; label: string }[]> {
  return {
    financial: [{ value: "pnl", label: t("adminHierarchy.semantic.pnl", "Ligne P&L") }],
    geographic: [
      { value: "continent", label: t("adminHierarchy.semantic.continent", "Continent") },
      { value: "region", label: t("adminHierarchy.semantic.region", "Région") },
      { value: "country", label: t("adminHierarchy.semantic.country", "Pays") },
      { value: "legal_entity", label: t("adminHierarchy.semantic.legalEntity", "Entité légale") },
    ],
  };
}

function TreeBranch({ node }: { node: HierarchyTreeNode }) {
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md border border-border bg-white px-2.5 py-2 text-xs">
        <code className="text-tertiary">{node.code}</code>
        <span className="font-semibold text-primary">{node.label}</span>
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 mt-1.5 space-y-1.5 border-l border-border pl-3">
          {node.children.map((child) => (
            <TreeBranch key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Édition de l'arborescence financière (niveaux + valeurs) pour UNE entreprise déjà sélectionnée.
 * Extrait de `admin/hierarchy/page.tsx` — cette page garde son propre sélecteur d'entreprise et
 * rend ce composant scopé ; le hub `/admin/companies/detail` le rend directement avec l'entreprise
 * du hub, sans sélecteur. Seule source de vérité pour ce CRUD.
 */
export function HierarchyEditor({
  companies,
  companyId,
  domain = "financial",
}: {
  companies: Company[];
  companyId: string;
  domain?: HierarchyDomain;
}) {
  const { t } = useTranslation();
  const SEMANTICS = semantics(t);
  const { showToast } = useToast();
  const [levels, setLevels] = useState<HierarchyLevelDef[]>([]);
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);
  const [nodeForm, setNodeForm] = useState<
    Record<
      string,
      {
        code: string;
        label: string;
        parentId: string;
        baseline: string;
        sign: "1" | "-1";
        computed: boolean;
        selectable: boolean;
      }
    >
  >({});
  const [importPreview, setImportPreview] = useState<HierarchyImportPreview | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [levelsDirty, setLevelsDirty] = useState(false);
  const [savingLevels, setSavingLevels] = useState(false);
  const [savingNodeKey, setSavingNodeKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const company = companies.find((c) => c.id === companyId);
    const configured =
      domain === "financial" ? company?.hierarchyLevels : company?.geographyHierarchyLevels;
    if (!levelsDirty) setLevels(configured ? structuredClone(configured) : []);
  }, [companies, companyId, domain, levelsDirty]);

  useEffect(() => {
    setLevelsDirty(false);
  }, [companyId, domain]);

  // Enregistre le scope dans la garde de navigation globale — si l'utilisateur essaie de
  // quitter alors que les niveaux ne sont pas sauvegardés, il verra la modale de confirmation.
  useRegisterUnsavedChanges(`admin:hierarchy:${domain}:${companyId}`, levelsDirty);

  useEffect(() => {
    if (!companyId) {
      setNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(companyId, setNodes, domain);
    return unsub;
  }, [companyId, domain]);

  const sortedLevels = useMemo(() => [...levels].sort((a, b) => a.order - b.order), [levels]);

  const nodesByLevel = useMemo(() => {
    const map = new Map<string, HierarchyNode[]>();
    for (const n of nodes) {
      const list = map.get(n.levelKey) ?? [];
      list.push(n);
      map.set(n.levelKey, list);
    }
    return map;
  }, [nodes]);
  const configuredLevelKeys = useMemo(
    () => new Set(sortedLevels.map((level) => level.key)),
    [sortedLevels]
  );
  const validNodes = useMemo(
    () => nodes.filter((node) => configuredLevelKeys.has(node.levelKey)),
    [nodes, configuredLevelKeys]
  );
  const orphanNodes = useMemo(
    () => nodes.filter((node) => !configuredLevelKeys.has(node.levelKey)),
    [nodes, configuredLevelKeys]
  );
  const forest = useMemo(
    () => buildHierarchyForest(validNodes, sortedLevels),
    [validNodes, sortedLevels]
  );

  const addLevel = () => {
    const order = levels.length;
    const key = `level_${order}_${Date.now()}`;
    setLevels((prev) => [
      ...prev,
      {
        key,
        label: t("adminHierarchy.newLevelName", "Niveau {n}").replace("{n}", String(order + 1)),
        order,
      },
    ]);
    setLevelsDirty(true);
  };

  const removeLevel = (key: string) => {
    setLevels((prev) => prev.filter((l) => l.key !== key).map((l, idx) => ({ ...l, order: idx })));
    setLevelsDirty(true);
  };

  const renameLevel = (key: string, label: string) => {
    setLevels((prev) => prev.map((l) => (l.key === key ? { ...l, label } : l)));
    setLevelsDirty(true);
  };

  const setLevelSemantic = (key: string, semantic: string) => {
    setLevels((current) =>
      current.map((level) => {
        const next = { ...level };
        if (level.key === key) {
          delete next.semantic;
          if (semantic) next.semantic = semantic as HierarchySemantic;
        } else if (semantic && level.semantic === semantic) {
          delete next.semantic;
        }
        return next;
      })
    );
    setLevelsDirty(true);
  };

  const moveLevel = (key: string, direction: "up" | "down") => {
    const ordered = [...levels].sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((l) => l.key === key);
    if (idx < 0) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    setLevels(ordered.map((l, i) => ({ ...l, order: i })));
    setLevelsDirty(true);
  };

  const saveLevels = async () => {
    if (!companies.some((company) => company.id === companyId)) return;
    setSavingLevels(true);
    try {
      const sanitized = sortedLevels.map((level) => {
        const next = {
          key: level.key,
          label: level.label.trim(),
          order: level.order,
        } as HierarchyLevelDef;
        if (level.semantic) next.semantic = level.semantic;
        return next;
      });
      await saveCompanyHierarchyLevels(companyId, domain, sanitized);
      setLevels(sanitized);
      setLevelsDirty(false);
      showToast(
        t("adminHierarchy.toastLevelsSavedTitle", "Structure enregistrée"),
        t(
          "adminHierarchy.toastLevelsSavedBody",
          "Les niveaux sont maintenant persistés dans Firebase."
        ),
        "success"
      );
    } catch (error) {
      console.error("[betrack] échec de sauvegarde des niveaux :", error);
      showToast(
        t("adminHierarchy.toastSaveFailedTitle", "Enregistrement impossible"),
        t(
          "adminHierarchy.toastLevelsSaveFailedBody",
          "La structure n'a pas été enregistrée dans Firebase."
        ),
        "error"
      );
    } finally {
      setSavingLevels(false);
    }
  };

  const setFormField = (levelKey: string, field: "code" | "label" | "parentId", value: string) => {
    setNodeForm((prev) => {
      const current = prev[levelKey] ?? EMPTY_NODE_FORM;
      return { ...prev, [levelKey]: { ...current, [field]: value } };
    });
  };

  const addNode = async (level: HierarchyLevelDef) => {
    const form = nodeForm[level.key];
    if (!form || !form.code.trim() || !form.label.trim()) return;
    const node = buildHierarchyNodePayload({
      id: nextNodeId(),
      companyId,
      domain,
      level,
      draft: form,
    });
    if (!node) return;
    setSavingNodeKey(level.key);
    try {
      await saveHierarchyNode(node);
      setNodeForm((prev) => ({ ...prev, [level.key]: { ...EMPTY_NODE_FORM } }));
      showToast(
        t("adminHierarchy.toastNodeSavedTitle", "Valeur enregistrée"),
        t("adminHierarchy.toastNodeSavedBody", "{name} est enregistrée dans Firebase.").replace(
          "{name}",
          node.label
        ),
        "success"
      );
    } catch (error) {
      console.error("[betrack] échec de sauvegarde du nœud :", error);
      showToast(
        t("adminHierarchy.toastSaveFailedTitle", "Enregistrement impossible"),
        t(
          "adminHierarchy.toastNodeSaveFailedBody",
          "La valeur n'a pas été enregistrée dans Firebase."
        ),
        "error"
      );
    } finally {
      setSavingNodeKey(null);
    }
  };

  const removeNode = async (id: string) => {
    try {
      await deleteHierarchyNode(id);
      showToast(
        t("adminHierarchy.toastNodeDeletedTitle", "Valeur supprimée"),
        t("adminHierarchy.toastNodeDeletedBody", "La suppression est enregistrée dans Firebase."),
        "success"
      );
    } catch (error) {
      console.error("[betrack] échec de suppression du nœud :", error);
      showToast(
        t("adminHierarchy.toastDeleteFailedTitle", "Suppression impossible"),
        t(
          "adminHierarchy.toastNodeDeleteFailedBody",
          "La valeur est toujours présente dans Firebase."
        ),
        "error"
      );
    }
  };

  const removeOrphanNodes = async () => {
    if (orphanNodes.length === 0) return;
    try {
      await deleteHierarchyNodesBatch(orphanNodes.map((node) => node.id));
      showToast(
        t("adminHierarchy.toastOrphansCleanedTitle", "Données orphelines nettoyées"),
        t(
          "adminHierarchy.toastOrphansCleanedBody",
          "{n} valeur(s) sans niveau enregistré ont été supprimées de Firebase."
        ).replace("{n}", String(orphanNodes.length)),
        "success"
      );
    } catch (error) {
      console.error("[betrack] échec de nettoyage des nœuds orphelins :", error);
      showToast(
        t("adminHierarchy.toastCleanupFailedTitle", "Nettoyage impossible"),
        t(
          "adminHierarchy.toastOrphansCleanupFailedBody",
          "Les valeurs orphelines sont toujours présentes dans Firebase."
        ),
        "error"
      );
    }
  };

  const parentLevel = (level: HierarchyLevelDef): HierarchyLevelDef | undefined =>
    sortedLevels.find((l) => l.order === level.order - 1);

  // --- Import / export Excel de l'arborescence (construction en masse) ---

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([[...HIERARCHY_EXCEL_HEADERS]]);
    XLSX.utils.book_append_sheet(wb, sheet, "Arborescence");
    XLSX.writeFile(wb, "template_arborescence.xlsx");
    showToast(
      t("adminHierarchy.toastTemplateDownloadedTitle", "Template téléchargé"),
      t(
        "adminHierarchy.toastTemplateDownloadedBody",
        'Une ligne par nœud : "Niveau" (libellé ou clé configuré(e)), "Code", "Libellé", "Code parent" (vide pour le niveau macro).'
      ),
      "success"
    );
  };

  const exportTree = () => {
    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const rows = nodes.map((n) => hierarchyNodeToExcelRow(n, sortedLevels, nodesById));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Arborescence");
    const company = companies.find((c) => c.id === companyId);
    XLSX.writeFile(wb, `arborescence_${company?.name ?? companyId}.xlsx`);
    showToast(
      t("adminHierarchy.toastExportGeneratedTitle", "Export Excel généré"),
      t("adminHierarchy.toastExportGeneratedBody", "{n} nœud(s) exporté(s)").replace(
        "{n}",
        String(rows.length)
      ),
      "success"
    );
  };

  const handleImportFile = async (file: File) => {
    if (sortedLevels.length === 0) return;
    const workbook = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
      defval: "",
    });
    const preview = validateHierarchyImportRows(rawRows, sortedLevels, nodes, companyId, domain);
    setImportFileName(file.name);
    setImportPreview(preview);
  };

  const confirmImport = async () => {
    if (!importPreview || importPreview.toCreate.length === 0) return;
    setImporting(true);
    try {
      await saveHierarchyNodesBatch(importPreview.toCreate);
      showToast(
        t("adminHierarchy.toastImportDoneTitle", "Import Excel terminé"),
        t("adminHierarchy.toastImportDoneBody", "{n} nœud(s) créé(s)").replace(
          "{n}",
          String(importPreview.toCreate.length)
        ) +
          (importPreview.errors.length > 0
            ? t("adminHierarchy.toastImportDoneErrorsSuffix", " · {n} ligne(s) ignorée(s)").replace(
                "{n}",
                String(importPreview.errors.length)
              )
            : ""),
        "success"
      );
      setImportPreview(null);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-text-secondary">
        {domain === "financial"
          ? t(
              "adminHierarchy.introFinancial",
              "Configurez les lignes du P&L puis les niveaux de maille financière jusqu'au centre de coût ou à la maille la plus fine. Le niveau marqué Ligne P&L alimente directement le module Finance."
            )
          : t(
              "adminHierarchy.introGeographic",
              "Configurez librement le découpage géographique de l'entreprise : continent, région, pays, entité légale ou tout autre niveau propre au client."
            )}
      </p>

      {/* Section 1 : niveaux */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-text-primary">
          {t("adminHierarchy.section1Title", "1. Niveaux de l'arborescence")}
        </h2>
        {/* Desktop/tablette (>= sm). En dessous de sm, remplacé par des cartes (voir plus bas) —
         * l'input libellé + la clé + les boutons de réordre/suppression ne tiennent pas sur une
         * ligne à 375px sans scroll horizontal. */}
        <div className="hidden rounded-xl border border-border overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-elevated border-b border-border">
                <th className="px-4 py-2.5 w-16 text-center text-xs font-semibold text-text-secondary">
                  {t("adminHierarchy.colOrder", "Ordre")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminHierarchy.colLabel", "Libellé")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminHierarchy.colStandardUsage", "Usage standard")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminHierarchy.colKey", "Clé")}
                </th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                  {t("adminHierarchy.colReorder", "Réordonner")}
                </th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                  {t("adminHierarchy.colActions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedLevels.map((level, idx) => (
                <tr key={level.key} className="border-b border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 text-center text-xs font-mono text-text-secondary">
                    {idx === 0
                      ? t("adminHierarchy.orderMacro", "Macro")
                      : idx === sortedLevels.length - 1
                        ? t("adminHierarchy.orderEnd", "Fin")
                        : level.order}
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      value={level.label}
                      onChange={(e) => renameLevel(level.key, e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={level.semantic ?? ""}
                      onChange={(e) => setLevelSemantic(level.key, e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-xs"
                    >
                      <option value="">
                        {t("adminHierarchy.semanticNoneDesktop", "Aucun / personnalisé")}
                      </option>
                      {SEMANTICS[domain].map((semantic) => (
                        <option key={semantic.value} value={semantic.value}>
                          {semantic.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <code className="rounded bg-bg-surface px-1.5 py-0.5 text-xs text-text-secondary">
                      {level.key}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => moveLevel(level.key, "up")}
                      disabled={idx === 0}
                      className="mr-1 text-text-secondary hover:text-bp-coral disabled:opacity-30"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => moveLevel(level.key, "down")}
                      disabled={idx === sortedLevels.length - 1}
                      className="text-text-secondary hover:text-bp-coral disabled:opacity-30"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => removeLevel(level.key)}
                      className="text-text-secondary hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {sortedLevels.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-text-secondary">
                    {t(
                      "adminHierarchy.noLevelsConfigured",
                      'Aucun niveau configuré — l\'entreprise utilise le champ texte libre "Centre de coût" historique.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile (< sm) : une carte par niveau. */}
        <div className="divide-y divide-border rounded-xl border border-border sm:hidden">
          {sortedLevels.map((level, idx) => (
            <div key={level.key} className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-secondary">
                <span className="font-mono">
                  {idx === 0
                    ? t("adminHierarchy.orderMacro", "Macro")
                    : idx === sortedLevels.length - 1
                      ? t("adminHierarchy.orderEnd", "Fin")
                      : level.order}
                </span>
                <code className="rounded bg-bg-surface px-1.5 py-0.5">{level.key}</code>
              </div>
              <input
                value={level.label}
                onChange={(e) => renameLevel(level.key, e.target.value)}
                className="mb-2 w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
              />
              <select
                value={level.semantic ?? ""}
                onChange={(e) => setLevelSemantic(level.key, e.target.value)}
                className="mb-2 w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm"
              >
                <option value="">
                  {t("adminHierarchy.semanticNoneMobile", "Usage personnalisé")}
                </option>
                {SEMANTICS[domain].map((semantic) => (
                  <option key={semantic.value} value={semantic.value}>
                    {semantic.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between">
                <div>
                  <button
                    onClick={() => moveLevel(level.key, "up")}
                    disabled={idx === 0}
                    className="mr-1 text-text-secondary hover:text-bp-coral disabled:opacity-30"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    onClick={() => moveLevel(level.key, "down")}
                    disabled={idx === sortedLevels.length - 1}
                    className="text-text-secondary hover:text-bp-coral disabled:opacity-30"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
                <button
                  onClick={() => removeLevel(level.key)}
                  className="text-text-secondary hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {sortedLevels.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-text-secondary">
              {t(
                "adminHierarchy.noLevelsConfigured",
                'Aucun niveau configuré — l\'entreprise utilise le champ texte libre "Centre de coût" historique.'
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={addLevel}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
          >
            <Plus size={14} /> {t("adminHierarchy.addLevel", "Ajouter un niveau")}
          </button>
          <button
            onClick={saveLevels}
            disabled={!companyId || !levelsDirty || savingLevels}
            className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-40"
          >
            <Save size={14} />{" "}
            {savingLevels
              ? t("adminHierarchy.saving", "Enregistrement…")
              : t("adminHierarchy.saveStructure", "Enregistrer la structure")}
          </button>
        </div>
      </section>

      {/* Section 2 : nœuds */}
      {sortedLevels.length > 0 && (
        <section className="space-y-4">
          {levelsDirty && (
            <div className="rounded-lg border border-rag-amber bg-rag-amber-light px-3 py-2 text-xs text-rag-amber">
              {t(
                "adminHierarchy.levelsDirtyWarning",
                "Enregistrez d'abord la structure des niveaux. Les valeurs ne peuvent pas être ajoutées à un niveau non persisté."
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-text-primary">
              {t("adminHierarchy.section2Title", "2. Valeurs de l'arborescence")}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadTemplate}>
                <Download size={13} /> {t("adminHierarchy.templateExcel", "Template Excel")}
              </Button>
              <Button variant="outline" onClick={exportTree} disabled={nodes.length === 0}>
                <FileSpreadsheet size={13} />{" "}
                {t("adminHierarchy.exportTree", "Exporter l'arborescence")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleImportFile(file);
                }}
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} /> {t("adminHierarchy.importFile", "Importer un fichier")}
              </Button>
            </div>
          </div>
          <p className="max-w-2xl text-xs text-text-secondary">
            {t(
              "adminHierarchy.importFileHint",
              'Le fichier contient une ligne par nœud avec les colonnes "Niveau" (libellé ou clé d\'un niveau configuré ci-dessus), "Code", "Libellé" et "Code parent" (code d\'un nœud du niveau immédiatement au-dessus — vide pour le niveau macro). L\'ordre des lignes importe peu : les parents sont résolus par code, quel que soit l\'ordre du fichier.'
            )}
          </p>
          {sortedLevels.map((level) => {
            const pLevel = parentLevel(level);
            const parentOptions = pLevel ? (nodesByLevel.get(pLevel.key) ?? []) : [];
            const levelNodes = nodesByLevel.get(level.key) ?? [];
            const form = nodeForm[level.key] ?? EMPTY_NODE_FORM;
            const isPnl = level.semantic === "pnl";
            return (
              <div key={level.key} className="rounded-xl border border-border">
                <div className="bg-bg-elevated border-b border-border px-4 py-2 text-xs font-semibold text-text-secondary">
                  {level.label}{" "}
                  {pLevel && (
                    <span className="font-normal text-text-tertiary">
                      (
                      {t("adminHierarchy.childOf", "enfant de {name}").replace(
                        "{name}",
                        pLevel.label
                      )}
                      )
                    </span>
                  )}
                </div>

                {/* Desktop/tablette (>= sm) : tableau. En dessous de sm, cartes (voir plus bas) —
                 * code + libellé + sélecteur parent + action ne tiennent pas sur une ligne étroite. */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">
                          {t("adminHierarchy.colCode", "Code")}
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">
                          {t("adminHierarchy.colLabel", "Libellé")}
                        </th>
                        {pLevel && (
                          <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">
                            {t("adminHierarchy.colParent", "Parent ({name})").replace(
                              "{name}",
                              pLevel.label
                            )}
                          </th>
                        )}
                        {isPnl && (
                          <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">
                            {t("adminHierarchy.colBaselineSign", "Baseline / signe")}
                          </th>
                        )}
                        <th className="px-4 py-2 text-center text-xs font-semibold text-text-secondary">
                          {t("adminHierarchy.colActions", "Actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {levelNodes.map((n) => (
                        <tr key={n.id} className="border-b border-border hover:bg-bg-elevated/50">
                          <td className="px-4 py-2 font-mono text-xs text-text-secondary">
                            {n.code}
                          </td>
                          <td className="px-4 py-2 text-text-primary">{n.label}</td>
                          {pLevel && (
                            <td className="px-4 py-2 text-text-secondary">
                              {n.parentId ? ancestryLabel(n.parentId, nodes, sortedLevels) : "—"}
                            </td>
                          )}
                          {isPnl && (
                            <td className="px-4 py-2 text-xs text-secondary">
                              {n.financial?.baseline ?? 0} €M ·{" "}
                              {n.financial?.sign === -1 ? "−" : "+"}
                              {n.financial?.computed
                                ? t("adminHierarchy.computedSuffix", " · Calculée")
                                : ""}
                            </td>
                          )}
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => removeNode(n.id)}
                              className="text-text-secondary hover:text-red-500"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="px-4 py-2">
                          <input
                            value={form.code}
                            onChange={(e) => setFormField(level.key, "code", e.target.value)}
                            placeholder={t("adminHierarchy.codePlaceholder", "Code")}
                            className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={form.label}
                            onChange={(e) => setFormField(level.key, "label", e.target.value)}
                            placeholder={t("adminHierarchy.labelPlaceholder", "Libellé")}
                            className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                          />
                        </td>
                        {pLevel && (
                          <td className="px-4 py-2">
                            <select
                              value={form.parentId}
                              onChange={(e) => setFormField(level.key, "parentId", e.target.value)}
                              className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                            >
                              <option value="">
                                {t("leverForm.selectPlaceholder", "Sélectionner…")}
                              </option>
                              {parentOptions.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {ancestryLabel(p.id, nodes, sortedLevels)} ({p.code})
                                </option>
                              ))}
                            </select>
                          </td>
                        )}
                        {isPnl && (
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                step="0.1"
                                placeholder={t("adminHierarchy.baselinePlaceholder", "Baseline €M")}
                                value={form.baseline}
                                onChange={(e) =>
                                  setNodeForm((prev) => ({
                                    ...prev,
                                    [level.key]: { ...form, baseline: e.target.value },
                                  }))
                                }
                                className="w-28 rounded-lg border border-border px-2 py-1 text-xs"
                              />
                              <select
                                value={form.sign}
                                onChange={(e) =>
                                  setNodeForm((prev) => ({
                                    ...prev,
                                    [level.key]: { ...form, sign: e.target.value as "1" | "-1" },
                                  }))
                                }
                                className="rounded-lg border border-border px-2 py-1 text-xs"
                              >
                                <option value="1">
                                  {t("adminHierarchy.signPositive", "Positif")}
                                </option>
                                <option value="-1">
                                  {t("adminHierarchy.signNegative", "Négatif")}
                                </option>
                              </select>
                              <label className="flex items-center gap-1 text-[10px] text-secondary">
                                <input
                                  type="checkbox"
                                  checked={form.selectable}
                                  onChange={(e) =>
                                    setNodeForm((prev) => ({
                                      ...prev,
                                      [level.key]: { ...form, selectable: e.target.checked },
                                    }))
                                  }
                                />{" "}
                                {t("adminHierarchy.selectableDesktop", "Imputable aux leviers")}
                              </label>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => addNode(level)}
                            disabled={levelsDirty || savingNodeKey === level.key}
                            className="rounded-lg bg-bp-coral px-2.5 py-1 text-xs font-semibold text-white hover:bg-bp-coral/90"
                          >
                            <Plus size={12} className="inline" />{" "}
                            {savingNodeKey === level.key
                              ? t("adminHierarchy.saving", "Enregistrement…")
                              : t("common.add", "Ajouter")}
                          </button>
                        </td>
                      </tr>
                      {levelNodes.length === 0 && (
                        <tr>
                          <td
                            colSpan={(pLevel ? 4 : 3) + (isPnl ? 1 : 0)}
                            className="px-4 py-3 text-center text-xs text-text-secondary"
                          >
                            {t(
                              "adminHierarchy.noValuesForLevel",
                              "Aucune valeur pour ce niveau pour le moment."
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile (< sm) : cartes empilées + formulaire d'ajout en pleine largeur. */}
                <div className="divide-y divide-border sm:hidden">
                  {levelNodes.map((n) => (
                    <div key={n.id} className="flex items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-bg-surface px-1.5 py-0.5 text-xs text-text-secondary">
                            {n.code}
                          </code>
                          <span className="truncate text-sm text-text-primary">{n.label}</span>
                        </div>
                        {pLevel && (
                          <div className="mt-0.5 text-xs text-text-secondary">
                            {t("adminHierarchy.parentPrefix", "Parent :")}{" "}
                            {n.parentId ? ancestryLabel(n.parentId, nodes, sortedLevels) : "—"}
                          </div>
                        )}
                        {isPnl && (
                          <div className="mt-1 text-xs text-secondary">
                            {t("adminHierarchy.baselinePrefix", "Baseline :")}{" "}
                            {n.financial?.baseline ?? 0} €M ·{" "}
                            {t("adminHierarchy.signPrefix", "signe")}{" "}
                            {n.financial?.sign === -1 ? "−" : "+"}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeNode(n.id)}
                        className="shrink-0 text-text-secondary hover:text-red-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {levelNodes.length === 0 && (
                    <div className="px-4 py-3 text-center text-xs text-text-secondary">
                      {t(
                        "adminHierarchy.noValuesForLevel",
                        "Aucune valeur pour ce niveau pour le moment."
                      )}
                    </div>
                  )}
                  <div className="space-y-2 p-3">
                    <input
                      value={form.code}
                      onChange={(e) => setFormField(level.key, "code", e.target.value)}
                      placeholder={t("adminHierarchy.codePlaceholder", "Code")}
                      className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
                    />
                    <input
                      value={form.label}
                      onChange={(e) => setFormField(level.key, "label", e.target.value)}
                      placeholder={t("adminHierarchy.labelPlaceholder", "Libellé")}
                      className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
                    />
                    {pLevel && (
                      <select
                        value={form.parentId}
                        onChange={(e) => setFormField(level.key, "parentId", e.target.value)}
                        className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
                      >
                        <option value="">
                          {t("leverForm.selectPlaceholder", "Sélectionner…")}
                        </option>
                        {parentOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {ancestryLabel(p.id, nodes, sortedLevels)} ({p.code})
                          </option>
                        ))}
                      </select>
                    )}
                    {isPnl && (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          step="0.1"
                          placeholder={t("adminHierarchy.baselinePlaceholder", "Baseline €M")}
                          value={form.baseline}
                          onChange={(e) =>
                            setNodeForm((prev) => ({
                              ...prev,
                              [level.key]: { ...form, baseline: e.target.value },
                            }))
                          }
                          className="w-full rounded-lg border border-border px-2 py-1.5 text-sm"
                        />
                        <select
                          value={form.sign}
                          onChange={(e) =>
                            setNodeForm((prev) => ({
                              ...prev,
                              [level.key]: { ...form, sign: e.target.value as "1" | "-1" },
                            }))
                          }
                          className="w-full rounded-lg border border-border px-2 py-1.5 text-sm"
                        >
                          <option value="1">
                            {t("adminHierarchy.signPositiveMobile", "Signe positif")}
                          </option>
                          <option value="-1">
                            {t("adminHierarchy.signNegativeMobile", "Signe négatif")}
                          </option>
                        </select>
                        <label className="col-span-2 flex items-center gap-1 text-xs text-secondary">
                          <input
                            type="checkbox"
                            checked={form.selectable}
                            onChange={(e) =>
                              setNodeForm((prev) => ({
                                ...prev,
                                [level.key]: { ...form, selectable: e.target.checked },
                              }))
                            }
                          />{" "}
                          {t("adminHierarchy.selectableMobile", "Ligne imputable aux leviers")}
                        </label>
                      </div>
                    )}
                    <button
                      onClick={() => addNode(level)}
                      disabled={levelsDirty || savingNodeKey === level.key}
                      className="w-full rounded-lg bg-bp-coral px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
                    >
                      <Plus size={12} className="inline" /> {t("common.add", "Ajouter")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="rounded-xl border border-border bg-neutral-50 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-primary">
          <GitBranch size={16} className="text-bp-coral" />{" "}
          {t("adminHierarchy.livePreviewTitle", "Aperçu live de l'arborescence")}
        </h2>
        {forest.length === 0 ? (
          <p className="text-xs text-secondary">
            {t("adminHierarchy.addValuesHint", "Ajoutez des valeurs pour visualiser les branches.")}
          </p>
        ) : (
          <ul className="space-y-2">
            {forest.map((root) => (
              <TreeBranch key={root.id} node={root} />
            ))}
          </ul>
        )}
        {orphanNodes.length > 0 && (
          <div className="mt-4 rounded-lg border border-rag-amber bg-rag-amber-light p-3 text-xs text-secondary">
            <strong className="block text-rag-amber">
              {t(
                "adminHierarchy.orphansDetected",
                "{n} valeur(s) orpheline(s) détectée(s)"
              ).replace("{n}", String(orphanNodes.length))}
            </strong>
            <p className="mt-1">
              {t(
                "adminHierarchy.orphansExplain",
                "Ces documents existent dans Firebase mais leur niveau n'est pas enregistré dans la structure. Ils ne sont pas affichés dans l'arbre valide."
              )}
            </p>
            <button
              type="button"
              onClick={() => void removeOrphanNodes()}
              className="mt-2 rounded-md border border-rag-amber px-2.5 py-1 font-semibold text-rag-amber hover:bg-white"
            >
              {t("adminHierarchy.removeOrphans", "Supprimer ces valeurs de Firebase")}
            </button>
          </div>
        )}
      </section>

      <Modal
        open={importPreview !== null}
        onOpenChange={(open) => !open && setImportPreview(null)}
        title={t(
          "adminHierarchy.importPreviewTitle",
          "Prévisualisation de l'import — {file}"
        ).replace("{file}", importFileName)}
        maxWidth="640px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportPreview(null)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button
              variant="primary"
              disabled={importing || (importPreview?.toCreate.length ?? 0) === 0}
              onClick={() => void confirmImport()}
            >
              {t("adminHierarchy.confirmImport", "Confirmer l'import")}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{importPreview?.toCreate.length ?? 0}</strong>{" "}
            {t("adminHierarchy.nodesReadyToCreate", "nœud(s) prêt(s) à créer")}
          </span>
          <span>
            <strong className="text-rag-red">{importPreview?.errors.length ?? 0}</strong>{" "}
            {t("adminHierarchy.rowsInError", "ligne(s) en erreur")}
          </span>
        </div>
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {importPreview?.errors.length === 0 ? (
            <p className="text-tertiary">
              {t("adminHierarchy.noAnomalies", "Aucune anomalie détectée.")}
            </p>
          ) : (
            importPreview?.errors.map((e, i) => (
              <div key={i} className="text-secondary">
                {t("adminHierarchy.rowLabel", "Ligne {n} :").replace("{n}", String(e.rowNumber))}{" "}
                {e.reason}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
