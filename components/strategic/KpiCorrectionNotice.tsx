"use client";

import { Info } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { KpiCorrectionRoute, KpiInformLevel } from "@/lib/kpiCorrectionRouting";

/**
 * Explique ce qui va se passer pour une correction / suppression de mesure KPI (règles PO, voir
 * `lib/kpiCorrectionRouting.ts`) : soumission au responsable du chantier (ou repli axe/plan), et
 * responsables supérieurs informés. Route "retry" (utilisateurs pas encore chargés) : message
 * « données en cours de chargement, réessayez » — rien ne sera appliqué.
 */
export function KpiCorrectionNotice({
  route,
  action,
  chain,
}: {
  route: KpiCorrectionRoute | null | undefined;
  action: "edit" | "delete";
  /** Aperçu lisible de la chaîne complète (« Sponsor d'axe (X) puis Pilote (Y) ») — mode demande. */
  chain?: string;
}) {
  const { t } = useTranslation();
  if (!route || route.mode === "forbidden") return null;
  if (route.mode === "retry") {
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-rag-amber bg-rag-amber-light px-2.5 py-1.5 text-[11px] text-rag-amber">
        <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          {t(
            "strategicFiche.retry.message",
            "Les données sont en cours de chargement : réessayez dans un instant."
          )}
        </span>
      </p>
    );
  }

  const informText = (levels: KpiInformLevel[], afterApproval: boolean): string | null => {
    const key =
      levels.includes("axis") && levels.includes("plan")
        ? "axisPlan"
        : levels.includes("axis")
          ? "axis"
          : levels.includes("plan")
            ? "plan"
            : null;
    if (!key) return null;
    const fallbacks: Record<string, string> = afterApproval
      ? {
          axisPlan:
            "Une fois la demande acceptée, le responsable de l'axe et le responsable du plan seront informés.",
          axis: "Une fois la demande acceptée, le responsable de l'axe sera informé.",
          plan: "Une fois la demande acceptée, le responsable du plan sera informé.",
        }
      : {
          axisPlan: "Le responsable de l'axe et le responsable du plan seront informés.",
          axis: "Le responsable de l'axe sera informé.",
          plan: "Le responsable du plan sera informé.",
        };
    return t(`kpi.measurement.${afterApproval ? "informAfter" : "inform"}.${key}`, fallbacks[key]);
  };

  let main: string | null = null;
  let inform: string | null;
  if (route.mode === "request") {
    const names = route.approver.entityNames.join(", ");
    const fallbacks: Record<string, Record<string, string>> = {
      edit: {
        chantier: "Votre correction sera soumise au responsable du chantier {name}.",
        axis: "Votre correction sera soumise au responsable de l'axe {name}.",
        plan: "Votre correction sera soumise au responsable du plan.",
      },
      delete: {
        chantier: "Votre suppression sera soumise au responsable du chantier {name}.",
        axis: "Votre suppression sera soumise au responsable de l'axe {name}.",
        plan: "Votre suppression sera soumise au responsable du plan.",
      },
    };
    main = t(
      `kpi.measurement.route.${action}.${route.approver.level}`,
      fallbacks[action][route.approver.level]
    ).replace("{name}", names);
    if (chain) {
      main = `${main} ${t("kpi.willBeValidatedBy", "Sera validée par {chain}").replace("{chain}", chain)}.`;
    }
    inform = informText(route.informLevels, true);
  } else {
    inform = informText(route.informLevels, false);
  }
  if (!main && !inform) return null;

  return (
    <p className="flex items-start gap-1.5 rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[11px] text-text-secondary">
      <Info size={12} className="mt-0.5 shrink-0 text-bp-coral" aria-hidden="true" />
      <span>{[main, inform].filter(Boolean).join(" ")}</span>
    </p>
  );
}
