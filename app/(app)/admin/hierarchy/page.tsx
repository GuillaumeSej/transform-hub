"use client";

import { useEffect, useMemo, useState } from "react";
import { Network, Plus, Save, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { Company, HierarchyLevelDef, HierarchyNode } from "@/types";
import {
  subscribeCompanies,
  saveCompany,
  subscribeHierarchyNodes,
  saveHierarchyNode,
  deleteHierarchyNode,
} from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";

let nodeSeq = 0;
function nextNodeId() {
  nodeSeq += 1;
  return `HN-${Date.now()}-${nodeSeq}`;
}

export default function AdminHierarchyPage() {
  const { role, user } = useRole();
  const isEntAdmin = role === "admin_entreprise";
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [levels, setLevels] = useState<HierarchyLevelDef[]>([]);
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);

  // Formulaire d'ajout de nœud : un jeu de champs par niveau (levelKey -> valeurs saisies)
  const [nodeForm, setNodeForm] = useState<
    Record<string, { code: string; label: string; parentId: string }>
  >({});

  useEffect(() => {
    const unsub = subscribeCompanies((list) => {
      setCompanies(list);
      if (!selectedCompany) {
        if (isEntAdmin && user?.companyId) {
          setSelectedCompany(user.companyId);
        } else if (list.length > 0) {
          setSelectedCompany(list[0].id);
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEntAdmin, user?.companyId]);

  useEffect(() => {
    const company = companies.find((c) => c.id === selectedCompany);
    setLevels(company?.hierarchyLevels ? structuredClone(company.hierarchyLevels) : []);
  }, [companies, selectedCompany]);

  useEffect(() => {
    if (!selectedCompany) {
      setNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(selectedCompany, setNodes);
    return unsub;
  }, [selectedCompany]);

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

  // --- Levels editor ---

  const addLevel = () => {
    const order = levels.length;
    const key = `level_${order}_${Date.now()}`;
    setLevels((prev) => [...prev, { key, label: `Niveau ${order + 1}`, order }]);
  };

  const removeLevel = (key: string) => {
    setLevels((prev) => prev.filter((l) => l.key !== key).map((l, idx) => ({ ...l, order: idx })));
  };

  const renameLevel = (key: string, label: string) => {
    setLevels((prev) => prev.map((l) => (l.key === key ? { ...l, label } : l)));
  };

  const moveLevel = (key: string, direction: "up" | "down") => {
    const ordered = [...levels].sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((l) => l.key === key);
    if (idx < 0) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    setLevels(ordered.map((l, i) => ({ ...l, order: i })));
  };

  const saveLevels = async () => {
    const company = companies.find((c) => c.id === selectedCompany);
    if (!company) return;
    await saveCompany({ ...company, hierarchyLevels: sortedLevels });
  };

  // --- Nodes editor ---

  const setFormField = (levelKey: string, field: "code" | "label" | "parentId", value: string) => {
    setNodeForm((prev) => {
      const current = prev[levelKey] ?? { code: "", label: "", parentId: "" };
      return { ...prev, [levelKey]: { ...current, [field]: value } };
    });
  };

  const addNode = async (level: HierarchyLevelDef) => {
    const form = nodeForm[level.key];
    if (!form || !form.code.trim() || !form.label.trim()) return;
    const isMacro = level.order === 0;
    if (!isMacro && !form.parentId) return; // niveau non-macro : parent obligatoire
    const node: HierarchyNode = {
      id: nextNodeId(),
      companyId: selectedCompany,
      levelKey: level.key,
      code: form.code.trim(),
      label: form.label.trim(),
      parentId: isMacro ? null : form.parentId,
    };
    await saveHierarchyNode(node);
    setNodeForm((prev) => ({ ...prev, [level.key]: { code: "", label: "", parentId: "" } }));
  };

  const removeNode = async (id: string) => {
    await deleteHierarchyNode(id);
  };

  const parentLevel = (level: HierarchyLevelDef): HierarchyLevelDef | undefined =>
    sortedLevels.find((l) => l.order === level.order - 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Network size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">Arborescence financière</h1>
      </div>

      <p className="max-w-2xl text-sm text-text-secondary">
        Configurez le nombre de niveaux entre le compte P&amp;L (macro) et la maille la plus fine
        saisie sur les leviers (ex. Centre de coût), puis construisez l&apos;arbre de valeurs
        possibles pour chaque niveau. Une fois configurée, la maille la plus fine saisie sur un
        levier (manuellement ou via import Excel) suffit à résoudre automatiquement tous les niveaux
        intermédiaires.
      </p>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-text-secondary">Entreprise :</label>
        {isEntAdmin ? (
          <span className="text-sm font-medium text-text-primary">
            {companies.find((c) => c.id === user?.companyId)?.name ?? user?.companyId}
          </span>
        ) : (
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Section 1 : niveaux */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-text-primary">1. Niveaux de l&apos;arborescence</h2>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-elevated border-b border-border">
                <th className="px-4 py-2.5 w-16 text-center text-xs font-semibold text-text-secondary">
                  Ordre
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Libellé
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Clé
                </th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                  Réordonner
                </th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedLevels.map((level, idx) => (
                <tr key={level.key} className="border-b border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 text-center text-xs font-mono text-text-secondary">
                    {idx === 0 ? "Macro" : idx === sortedLevels.length - 1 ? "Fin" : level.order}
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      value={level.label}
                      onChange={(e) => renameLevel(level.key, e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral"
                    />
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
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-text-secondary">
                    Aucun niveau configuré — l&apos;entreprise utilise le champ texte libre
                    &quot;Centre de coût&quot; historique.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3">
          <button
            onClick={addLevel}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
          >
            <Plus size={14} /> Ajouter un niveau
          </button>
          <button
            onClick={saveLevels}
            disabled={!selectedCompany}
            className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-40"
          >
            <Save size={14} /> Enregistrer les niveaux
          </button>
        </div>
      </section>

      {/* Section 2 : nœuds */}
      {sortedLevels.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-bold text-text-primary">2. Valeurs de l&apos;arborescence</h2>
          {sortedLevels.map((level) => {
            const pLevel = parentLevel(level);
            const parentOptions = pLevel ? (nodesByLevel.get(pLevel.key) ?? []) : [];
            const levelNodes = nodesByLevel.get(level.key) ?? [];
            const form = nodeForm[level.key] ?? { code: "", label: "", parentId: "" };
            return (
              <div key={level.key} className="rounded-xl border border-border overflow-x-auto">
                <div className="bg-bg-elevated border-b border-border px-4 py-2 text-xs font-semibold text-text-secondary">
                  {level.label}{" "}
                  {pLevel && (
                    <span className="font-normal text-text-tertiary">
                      (enfant de {pLevel.label})
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">
                        Code
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">
                        Libellé
                      </th>
                      {pLevel && (
                        <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">
                          Parent ({pLevel.label})
                        </th>
                      )}
                      <th className="px-4 py-2 text-center text-xs font-semibold text-text-secondary">
                        Actions
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
                            {parentOptions.find((p) => p.id === n.parentId)?.label ?? "—"}
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
                          placeholder="Code"
                          className="w-full rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={form.label}
                          onChange={(e) => setFormField(level.key, "label", e.target.value)}
                          placeholder="Libellé"
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
                            <option value="">Sélectionner…</option>
                            {parentOptions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label} ({p.code})
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => addNode(level)}
                          className="rounded-lg bg-bp-coral px-2.5 py-1 text-xs font-semibold text-white hover:bg-bp-coral/90"
                        >
                          <Plus size={12} className="inline" /> Ajouter
                        </button>
                      </td>
                    </tr>
                    {levelNodes.length === 0 && (
                      <tr>
                        <td
                          colSpan={pLevel ? 4 : 3}
                          className="px-4 py-3 text-center text-xs text-text-secondary"
                        >
                          Aucune valeur pour ce niveau pour le moment.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
