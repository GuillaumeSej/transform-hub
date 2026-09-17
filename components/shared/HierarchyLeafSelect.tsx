"use client";

import { useEffect, useState } from "react";
import { subscribeCompanies, subscribeHierarchyNodes } from "@/lib/firestore/admin";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { HierarchyLevelDef, HierarchyNode } from "@/types";

const inputClass =
  "w-full rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-black focus:outline-none";

/**
 * Sélecteur de la maille la plus fine de l'arborescence financière (`HierarchyNode`, ex. "Cost
 * Center") d'une entreprise — factorisé depuis l'ancienne logique inline de `LeverForm.tsx`
 * (round "rattachement financier par action") pour être réutilisé partout où un rattachement à
 * l'arborescence financière est nécessaire au niveau d'une entité plus fine que le levier, ex.
 * `ActionImpact.hierarchyLeafId` dans `ActionForm.tsx`.
 *
 * Ne rend rien si l'entreprise n'a pas de hiérarchie financière configurée (`hierarchyLevels`
 * vide) — c'est à l'appelant de décider, dans ce cas, de retomber sur le champ legacy `pnlMap`
 * (voir `ActionForm.tsx`, même logique que l'ancien `hasHierarchy` de `LeverForm.tsx`).
 */
export function HierarchyLeafSelect({
  companyId,
  value,
  onChange,
  className,
}: {
  companyId: string | null | undefined;
  value: string | undefined;
  onChange: (leafId: string | undefined) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [financialNodes, setFinancialNodes] = useState<HierarchyNode[]>([]);

  useEffect(() => {
    if (!companyId) {
      setHierarchyLevels([]);
      setFinancialNodes([]);
      return;
    }
    let cancelled = false;
    let unsubNodes: (() => void) | null = null;
    const unsubCompanies = subscribeCompanies((companies) => {
      if (cancelled) return;
      const company = companies.find((c) => c.id === companyId);
      const levels = company?.hierarchyLevels ?? [];
      setHierarchyLevels(levels);
      unsubNodes?.();
      unsubNodes = null;
      if (levels.length === 0) {
        setFinancialNodes([]);
      } else {
        unsubNodes = subscribeHierarchyNodes(
          companyId,
          (nodes) => {
            if (cancelled) return;
            setFinancialNodes(nodes);
          },
          "financial"
        );
      }
    }, companyId);
    return () => {
      cancelled = true;
      unsubNodes?.();
      unsubCompanies();
    };
  }, [companyId]);

  const sortedHierarchyLevels = [...hierarchyLevels].sort((a, b) => a.order - b.order);
  const finestHierarchyLevel = sortedHierarchyLevels[sortedHierarchyLevels.length - 1];
  if (!finestHierarchyLevel) return null;

  const leafNodes = financialNodes.filter((n) => n.levelKey === finestHierarchyLevel.key);

  return (
    <select
      className={className ?? inputClass}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{t("leverForm.selectPlaceholder")}</option>
      {leafNodes.map((n) => (
        <option key={n.id} value={n.id}>
          {n.label} ({n.code})
        </option>
      ))}
    </select>
  );
}
