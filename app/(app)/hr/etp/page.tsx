"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, TriangleAlert, Users } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { isReadOnlyUser } from "@/lib/roleProfiles";
import * as hr from "@/lib/hrEngine";
import { classifyMovementExecution, EXECUTION_LABELS } from "@/lib/hrExecution";
import {
  executionLabelFromValue,
  movementStatusLabel,
  movementTypeLabel,
} from "@/lib/hrMovementLabels";
import { movementStatusPatch } from "@/lib/workforceLogic";
import { computeMovementFinancials, tenureYears } from "@/lib/hrFinancials";
import { fmtCurr } from "@/lib/engine";
import { Button } from "@/components/shared/Button";
import { KPICard } from "@/components/shared/KPICard";
import { Modal } from "@/components/shared/Modal";
import { MovementForm, type MovementFormValues } from "@/components/shared/MovementForm";
import { HrExcelButtons } from "@/components/shared/HrExcelButtons";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { type FilterDef } from "@/components/shared/FilterBar";
import { DropdownFilterBar } from "@/components/shared/DropdownFilterBar";
import { useMultiFilterBarState } from "@/lib/hooks/useMultiFilterBarState";
import { matchesAnyFilter, matchesFilter } from "@/lib/filterUtils";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { subscribeCompanies, subscribeHierarchyNodes } from "@/lib/firestore/admin";
import type {
  Company,
  Employee,
  HierarchyLevelDef,
  HierarchyNode,
  MovementStatus,
  MovementType,
  WorkforceMovement,
} from "@/types";
import { useTranslation } from "@/lib/i18n/useTranslation";

type EtpRow = {
  id: string;
  matricule: string;
  name: string;
  department: string;
  direction: string;
  country: string;
  func: string;
  level: string;
  fte: number;
  salary: number;
  hrOwner: string;
  hasMovement: string;
  movementType: string;
  leverCode: string;
  leverId: string | null;
  plannedDate: string;
  actualDate: string;
  movementStatus: string;
  pse: string;
  movement: WorkforceMovement | null;
  alertKind: hr.MovementAlertKind | null;
  employee: Employee | null;
};

type MovementRow = {
  id: string;
  label: string;
  type: string;
  department: string;
  country: string;
  function: string;
  programId: string;
  hrOwner: string;
  executionStatus: string;
  fte: number;
  plannedDate: string;
  actualDate: string;
  status: string;
  hrValidated: boolean;
  leverCode: string;
  leverId: string | null;
  alertKind: hr.MovementAlertKind | null;
  /** € économie de masse salariale chargée en régime annuel (>= 0), 0 si le mécanisme n'est pas
   *  une réduction nette d'ETP (voir WorkforceMovement.savings et lib/hrFinancials.ts). */
  savings: number;
  /** € impact masse salariale annuel signé (négatif = économie) — WorkforceMovement.salaryImpact. */
  salaryImpact: number;
  /** € coût social one-off associé au mécanisme — WorkforceMovement.cost. */
  cost: number;
  /** € impact net la 1ère année = salaryImpact + cost (vision cash court terme). */
  netImpact: number;
  movement: WorkforceMovement;
};

// Options du <select> d'édition inline des colonnes "Type"/"Statut" du tableau de suivi des
// mouvements (voir movementColumns) — mêmes listes que `MovementForm.tsx` (source de vérité pour
// les valeurs valides de `MovementType`/`MovementStatus`).
const MOVEMENT_TYPES: MovementType[] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];
const MOVEMENT_STATUSES: MovementStatus[] = ["Réalisé", "Planifié", "À faire", "Abandonné"];

function alertKindLabels(
  t: (key: string, fallback?: string) => string
): Record<hr.MovementAlertKind | "none", string> {
  return {
    overdue: t("hr.alert.overdue", "En retard"),
    due: t("hr.alert.due", "Échéance proche"),
    toValidate: t("hr.alert.toValidate", "À valider"),
    leverMismatch: t("hr.alert.leverMismatch", "Désynchronisé levier"),
    none: t("etp.alert.none", "Aucune"),
  };
}

function alertKindLabel(
  labels: Record<hr.MovementAlertKind | "none", string>,
  kind: hr.MovementAlertKind | null
): string {
  return labels[kind ?? "none"];
}

export default function BaseEtpPage() {
  const { t } = useTranslation();
  const ALERT_LABELS = alertKindLabels(t);
  const { user } = useRole();
  const readOnly = isReadOnlyUser(user);
  const data = useBeTrackData(user?.companyId ?? null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<"etp" | "mouvements">(
    requestedTab === "mouvements" ? "mouvements" : "etp"
  );
  useEffect(() => {
    setTab(requestedTab === "mouvements" ? "mouvements" : "etp");
  }, [requestedTab]);
  const [movementModal, setMovementModal] = useState<{ movement?: WorkforceMovement } | null>(null);

  const wf = data.workforce;

  // ─── Deep-link "voir ce(s) mouvement(s) précis" (mécanisme unique, voir lib/hrMovementLink.ts)
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Point d'entrée UNIQUE réutilisé par la matrice de statut, le drill-down de la waterfall ETP et
  // `MovementDrilldownModal` (voir app/(app)/hr/page.tsx) : `?movementIds=id1,id2,...` restreint
  // l'onglet "Suivi des mouvements" à EXACTEMENT ces mouvements, à la place des filtres normaux du
  // `useFilterBarState` "mov_" ci-dessous (volontairement un état LOCAL, pas un `FilterDef` : un id
  // de mouvement n'est pas une valeur de dimension comme les autres). Avec un seul id, ouvre en
  // plus directement la modale d'édition de ce mouvement pour atteindre le détail complet en un
  // clic (réutilise le `MovementForm` déjà câblé sur le clic d'une ligne du tableau ci-dessous).
  const movementIdsParam = searchParams.get("movementIds");
  const [highlightedMovementIds, setHighlightedMovementIds] = useState<string[] | null>(null);
  // Évite de rouvrir la modale d'édition à chaque re-render une fois le lien déjà appliqué (ex. si
  // l'utilisateur ferme la modale manuellement) — mémorise la valeur brute du paramètre déjà
  // traitée. Attend que `wf.movements` soit peuplé (chargement Firestore asynchrone) avant de
  // considérer un id unique comme "appliqué".
  const appliedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!movementIdsParam) {
      setHighlightedMovementIds(null);
      appliedDeepLinkRef.current = null;
      return;
    }
    const ids = Array.from(
      new Set(
        movementIdsParam
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );
    setHighlightedMovementIds(ids.length > 0 ? ids : null);
    if (appliedDeepLinkRef.current === movementIdsParam) return;
    if (ids.length === 1) {
      if (wf.movements.length === 0) return; // pas encore chargé — réessaie au prochain effet
      const target = wf.movements.find((m) => m.id === ids[0]);
      if (target) setMovementModal({ movement: target });
      appliedDeepLinkRef.current = movementIdsParam;
    } else if (ids.length > 1) {
      appliedDeepLinkRef.current = movementIdsParam;
    }
  }, [movementIdsParam, wf.movements]);

  const clearHighlightedMovements = () => {
    setHighlightedMovementIds(null);
    appliedDeepLinkRef.current = null;
    router.replace("/hr/etp?tab=mouvements");
  };

  const alerts = useMemo(() => hr.movementAlerts(wf, data.levers), [wf, data.levers]);
  const alertByMovement = useMemo(() => {
    const map = new Map<string, hr.MovementAlertKind>();
    // movementAlerts est trié par priorité : la première alerte d'un mouvement est la plus grave
    for (const a of alerts) if (!map.has(a.movement.id)) map.set(a.movement.id, a.kind);
    return map;
  }, [alerts]);
  // TOUTES les catégories d'alerte d'un mouvement (pas seulement la plus grave) — utilisé par le
  // filtre `f_alert` du tableau des mouvements : un mouvement à la fois "En retard" et
  // "Désynchronisé levier" doit ressortir sur l'un OU l'autre filtre (lien "Voir dans la page
  // détaillée" de la synthèse des alertes du Dashboard RH, voir `etpAlertFilterLink`).
  const alertKindsByMovement = useMemo(() => {
    const map = new Map<string, Set<hr.MovementAlertKind>>();
    for (const a of alerts) {
      const kinds = map.get(a.movement.id) ?? new Set<hr.MovementAlertKind>();
      kinds.add(a.kind);
      map.set(a.movement.id, kinds);
    }
    return map;
  }, [alerts]);

  const employeeRows: EtpRow[] = useMemo(() => {
    const movementByEmp = new Map<string, WorkforceMovement>();
    for (const m of wf.movements) {
      if (m.empId && !movementByEmp.has(m.empId)) movementByEmp.set(m.empId, m);
    }

    const baseRows: EtpRow[] = wf.employees.map((e) => {
      const m = movementByEmp.get(e.id) ?? null;
      const lever = m ? data.levers.find((l) => l.id === m.leverId) : undefined;
      return {
        id: e.id,
        matricule: e.id,
        name: e.name,
        department: e.department,
        direction: e.direction,
        country: e.country,
        func: e.func,
        level: e.level,
        fte: e.fte,
        salary: e.salary,
        hrOwner: e.hrOwner,
        hasMovement: m ? t("etp.yes", "Oui") : t("etp.no", "Non"),
        movementType: m ? movementTypeLabel(t, m.type) : "—",
        leverCode: lever?.code ?? "—",
        leverId: lever?.id ?? null,
        plannedDate: m?.plannedDate ?? "—",
        actualDate: m?.actualDate ?? "—",
        movementStatus: m
          ? `${movementStatusLabel(t, m.status)}${m.hrValidated ? t("etp.hrValidatedSuffix", " ✓RH") : ""}`
          : "—",
        pse: m?.inPSE ? t("etp.yes", "Oui") : t("etp.no", "Non"),
        movement: m,
        alertKind: m ? (alertByMovement.get(m.id) ?? null) : null,
        employee: e,
      };
    });

    const recruitmentRows: EtpRow[] = wf.movements
      .filter((m) => m.type === "Recrutement")
      .map((m) => {
        const lever = data.levers.find((l) => l.id === m.leverId);
        return {
          id: m.id,
          matricule: t("etp.toRecruit", "— à recruter —"),
          name: m.label,
          department: m.department,
          direction: "—",
          country: m.country,
          func: m.label,
          level: "—",
          fte: m.fte,
          salary: m.salaryImpact,
          hrOwner: m.hrOwner,
          hasMovement: t("etp.yes", "Oui"),
          movementType: movementTypeLabel(t, m.type),
          leverCode: lever?.code ?? "—",
          leverId: lever?.id ?? null,
          plannedDate: m.plannedDate,
          actualDate: m.actualDate ?? "—",
          movementStatus: `${movementStatusLabel(t, m.status)}${m.hrValidated ? t("etp.hrValidatedSuffix", " ✓RH") : ""}`,
          pse: t("etp.no", "Non"),
          movement: m,
          alertKind: alertByMovement.get(m.id) ?? null,
          employee: null,
        };
      });

    return [...baseRows, ...recruitmentRows];
  }, [wf, data.levers, alertByMovement, t]);

  const movementRows: MovementRow[] = useMemo(
    () =>
      wf.movements.map((m) => {
        const lever = data.levers.find((l) => l.id === m.leverId);
        return {
          id: m.id,
          label: m.label,
          type: m.type,
          department: m.department,
          country: m.country,
          function: m.function ?? "—",
          programId: m.programId ?? "—",
          hrOwner: m.hrOwner,
          executionStatus: EXECUTION_LABELS[classifyMovementExecution(m)],
          fte: m.fte,
          plannedDate: m.plannedDate,
          actualDate: m.actualDate ?? "—",
          // Round édition inline : `status` reste la valeur métier brute (une des 4 options de
          // `MovementStatus`), indispensable pour que le <select> d'édition inline de
          // `EditableTable` reconnaisse la valeur courante parmi ses options — le suffixe "✓RH"
          // (visuel uniquement) est désormais ajouté via le `render` de la colonne, pas concaténé
          // dans la donnée (sinon la valeur ne matchait plus aucune option, voir movementColumns).
          status: m.status,
          hrValidated: m.hrValidated,
          leverCode: lever?.code ?? "—",
          leverId: lever?.id ?? null,
          alertKind: alertByMovement.get(m.id) ?? null,
          savings: m.savings,
          salaryImpact: m.salaryImpact,
          cost: m.cost,
          netImpact: m.salaryImpact + m.cost,
          movement: m,
        };
      }),
    [wf.movements, data.levers, alertByMovement, t]
  );

  // ─── Arborescences optionnelles (géographie prioritaire, finance en bonus) ─────────────────────
  // Même pattern défensif que `DashboardPagePerformance.tsx`/`app/(app)/hr/page.tsx` : n'affecte
  // QUE l'onglet "Suivi des mouvements" (MovementRow porte un `WorkforceMovement`, seul type étendu
  // de `geographyLeafId`/`hierarchyLeafId` — voir types/index.ts). L'onglet "Base ETP" (EtpRow,
  // dérivé d'`Employee`) garde son filtre `country` plat inchangé : `Employee` n'a pas ces champs.
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === user?.companyId) ?? null);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);

  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  const [geographyHierarchyLevels, setGeographyHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [geographyNodes, setGeographyNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    setHierarchyLevels(company?.hierarchyLevels ?? []);
    setGeographyHierarchyLevels(company?.geographyHierarchyLevels ?? []);
  }, [company]);
  useEffect(() => {
    if (!user?.companyId || hierarchyLevels.length === 0) {
      setHierarchyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setHierarchyNodes, "financial");
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, hierarchyLevels.length]);
  useEffect(() => {
    if (!user?.companyId || geographyHierarchyLevels.length === 0) {
      setGeographyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setGeographyNodes, "geographic");
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, geographyHierarchyLevels.length]);

  const sortedHierarchyLevels = useMemo(
    () => [...hierarchyLevels].sort((a, b) => a.order - b.order),
    [hierarchyLevels]
  );
  const sortedGeographyHierarchyLevels = useMemo(
    () => [...geographyHierarchyLevels].sort((a, b) => a.order - b.order),
    [geographyHierarchyLevels]
  );

  const geographyFilterDefs: FilterDef<MovementRow>[] = useMemo(
    () =>
      sortedGeographyHierarchyLevels.map((level) => ({
        key: `f_geo_${level.key}`,
        label: level.label,
        getValue: (r: MovementRow) => {
          const path = resolveHierarchyPath(
            r.movement.geographyLeafId ?? "",
            geographyNodes,
            sortedGeographyHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    [sortedGeographyHierarchyLevels, geographyNodes]
  );

  // Bonus — même principe pour l'arborescence financière (centre de coût / P&L).
  const hierarchyFilterDefs: FilterDef<MovementRow>[] = useMemo(
    () =>
      sortedHierarchyLevels.map((level) => ({
        key: `f_hierarchy_${level.key}`,
        label: level.label,
        getValue: (r: MovementRow) => {
          const path = resolveHierarchyPath(
            r.movement.hierarchyLeafId ?? "",
            hierarchyNodes,
            sortedHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    [sortedHierarchyLevels, hierarchyNodes]
  );

  const etpFilterDefs: FilterDef<EtpRow>[] = useMemo(
    () => [
      {
        key: "f_department",
        label: t("hr.department", "Département"),
        getValue: (r) => r.department,
      },
      {
        key: "f_direction",
        label: t("etp.filter.direction", "Direction"),
        getValue: (r) => r.direction,
      },
      { key: "f_country", label: t("dashboard.country", "Pays"), getValue: (r) => r.country },
      { key: "f_func", label: t("dashboard.function", "Fonction"), getValue: (r) => r.func },
      { key: "f_level", label: t("levers.columnStatus", "Niveau"), getValue: (r) => r.level },
      {
        key: "f_hrOwner",
        label: t("etp.filter.hrOwnerLocal", "RH local"),
        getValue: (r) => r.hrOwner,
      },
      {
        key: "f_hasMovement",
        label: t("etp.filter.hasMovement", "Mouvement prévu"),
        getValue: (r) => r.hasMovement,
      },
      { key: "f_lever", label: t("etp.linkedLever", "Levier lié"), getValue: (r) => r.leverCode },
      { key: "f_pse", label: "PSE", getValue: (r) => r.pse },
      {
        key: "f_alert",
        label: t("etp.alertLabel", "Alerte"),
        getValue: (r) => alertKindLabel(ALERT_LABELS, r.alertKind),
      },
    ],
    [t, ALERT_LABELS]
  );

  const movementFilterDefs: FilterDef<MovementRow>[] = useMemo(
    () => [
      {
        key: "f_type",
        label: t("etp.filter.type", "Type"),
        getValue: (r) => r.type,
        formatValue: (v) => movementTypeLabel(t, v),
      },
      {
        key: "f_department",
        label: t("hr.department", "Département"),
        getValue: (r) => r.department,
      },
      ...(geographyFilterDefs.length > 0
        ? geographyFilterDefs
        : [
            {
              key: "f_country",
              label: t("dashboard.country", "Pays"),
              getValue: (r: MovementRow) => r.country,
            },
          ]),
      {
        key: "f_function",
        label: t("dashboard.function", "Fonction"),
        getValue: (r) => r.function,
      },
      {
        key: "f_program",
        label: t("dashboard.program", "Programme"),
        getValue: (r) => r.programId,
      },
      {
        key: "f_hrOwner",
        label: t("etp.filter.hrOwnerMovement", "Responsable RH"),
        getValue: (r) => r.hrOwner,
      },
      {
        key: "f_execution",
        label: t("etp.filter.executionStatus", "État d'exécution"),
        getValue: (r) => r.executionStatus,
        formatValue: (v) => executionLabelFromValue(t, v),
      },
      {
        key: "f_status",
        label: t("hr.status", "Statut"),
        getValue: (r) => r.status,
        formatValue: (v) => movementStatusLabel(t, v),
      },
      {
        key: "f_hrValidated",
        label: t("etp.hrValidated", "Validé RH"),
        getValue: (r) => (r.hrValidated ? t("etp.yes", "Oui") : t("etp.no", "Non")),
      },
      { key: "f_lever", label: t("etp.linkedLever", "Levier lié"), getValue: (r) => r.leverCode },
      {
        key: "f_alert",
        label: t("etp.alertLabel", "Alerte"),
        getValue: (r) => alertKindLabel(ALERT_LABELS, r.alertKind),
      },
      ...hierarchyFilterDefs,
    ],
    [t, ALERT_LABELS, geographyFilterDefs, hierarchyFilterDefs]
  );

  // Round <n> : passe par le hook partagé `useFilterBarState` (lib/hooks/useFilterBarState.ts) —
  // remplace une implémentation ad hoc qui avait 2 bugs : (1) le premier clic sur un bouton de
  // filtre ne produisait aucun effet visible (voir le commentaire du hook), et (2) les DEUX
  // `FilterBar` de cette page (employés / mouvements) partageaient le même `setFilters`, donc des
  // `FilterDef` de même `key` (ex. "department") s'activaient/se désactivaient l'un l'autre à
  // tort — `namespace` isole chacun dans son propre paramètre d'URL.
  const { activeFilters: etpActiveFilters, setFilters: setEtpFilters } = useMultiFilterBarState(
    etpFilterDefs,
    { namespace: "emp" }
  );
  const { activeFilters: movementActiveFilters, setFilters: setMovementFilters } =
    useMultiFilterBarState(movementFilterDefs, { namespace: "mov" });

  const filteredEmployees = useMemo(
    () =>
      employeeRows.filter((row) =>
        Object.entries(etpActiveFilters).every(([key, value]) => {
          const def = etpFilterDefs.find((d) => d.key === key);
          return !def || matchesFilter(def.getValue(row), value);
        })
      ),
    [employeeRows, etpActiveFilters, etpFilterDefs]
  );

  const filteredMovements = useMemo(() => {
    // Deep-link actif (voir plus haut) : affiche EXACTEMENT les mouvements demandés, sans tenir
    // compte des filtres normaux de la barre (état volontairement prioritaire — voir
    // `clearHighlightedMovements` pour en sortir).
    if (highlightedMovementIds) {
      const idSet = new Set(highlightedMovementIds);
      return movementRows.filter((row) => idSet.has(row.id));
    }
    return movementRows.filter((row) =>
      Object.entries(movementActiveFilters).every(([key, value]) => {
        if (key === "f_alert") {
          const kinds = alertKindsByMovement.get(row.id);
          const labels = kinds
            ? Array.from(kinds, (kind) => alertKindLabel(ALERT_LABELS, kind))
            : [alertKindLabel(ALERT_LABELS, null)];
          return matchesAnyFilter(labels, value);
        }
        const def = movementFilterDefs.find((d) => d.key === key);
        return !def || matchesFilter(def.getValue(row), value);
      })
    );
  }, [
    movementRows,
    movementActiveFilters,
    movementFilterDefs,
    highlightedMovementIds,
    alertKindsByMovement,
    ALERT_LABELS,
  ]);

  const toValidateCount = alerts.filter((a) => a.kind === "toValidate").length;
  const plannedCount = wf.movements.filter((m) => m.status !== "Réalisé").length;

  const handleCellUpdate = (rowId: string, field: keyof EtpRow, value: string | number) => {
    const row = employeeRows.find((r) => r.id === rowId);
    if (!row?.employee) return;
    const patch: Partial<Employee> = {};
    if (field === "salary" || field === "fte") patch[field] = Number(value);
    else if (
      field === "name" ||
      field === "direction" ||
      field === "country" ||
      field === "func" ||
      field === "hrOwner" ||
      field === "department" ||
      field === "level"
    ) {
      patch[field] = String(value) as never;
    } else if (field === "matricule") {
      patch.id = String(value);
    } else return;
    data.upsertEmployee({ ...row.employee, ...patch });
    showToast(t("etp.toast.employeeUpdated", "Employé mis à jour"), row.employee.name, "success");
  };

  /** Édition inline (double-clic) du tableau "Suivi des mouvements" — même pattern que
   *  `handleCellUpdate` ci-dessus pour la Base ETP, réutilise le composant générique
   *  `EditableTable`. Remplace l'ancien clic sur le libellé qui ouvrait `MovementForm` dans une
   *  modale : ce formulaire reste utilisé uniquement pour la CRÉATION ("Nouveau mouvement"), plus
   *  pour la modification d'un mouvement existant.
   *  Cas particulier "type" : contrairement aux autres champs (patch direct), changer le type d'un
   *  mouvement change le mécanisme financier sous-jacent (voir `applyType` dans `MovementForm.tsx`)
   *  — on recalcule donc `salaryImpact`/`savings`/`cost` via `computeMovementFinancials` pour ne
   *  pas laisser ces montants désynchronisés du nouveau type, en reprenant le salaire/l'ancienneté
   *  de l'employé lié (ou le dernier `salaryImpact` connu pour un Recrutement sans employé). */
  const handleMovementCellUpdate = (
    rowId: string,
    field: keyof MovementRow,
    value: string | number
  ) => {
    const movement = wf.movements.find((m) => m.id === rowId);
    if (!movement) return;
    let patch: Partial<WorkforceMovement> | null = null;
    if (field === "label") patch = { label: String(value) };
    else if (field === "department") patch = { department: String(value) };
    else if (field === "country") patch = { country: String(value) };
    else if (field === "fte") patch = { fte: Number(value) };
    else if (field === "plannedDate") patch = { plannedDate: String(value) };
    else if (field === "actualDate") {
      const next = String(value).trim();
      patch = { actualDate: next && next !== "—" ? next : null };
    } else if (field === "status") {
      patch = movementStatusPatch(movement, String(value) as MovementStatus);
    } else if (field === "type") {
      const type = String(value) as MovementType;
      const emp = movement.empId ? wf.employees.find((e) => e.id === movement.empId) : undefined;
      const grossSalary =
        type === "Recrutement" ? (emp?.salary ?? movement.salaryImpact) : (emp?.salary ?? 0);
      const refDate = movement.actualDate ?? movement.plannedDate;
      const tenure = tenureYears(emp?.hireDate, refDate);
      const inPSE = type === "Départ forcé" ? (movement.inPSE ?? false) : false;
      const requiresRetraining =
        type === "Transfert entrant" || type === "Transfert sortant"
          ? (movement.requiresRetraining ?? false)
          : undefined;
      const fin = computeMovementFinancials({
        type,
        grossSalary,
        tenure,
        inPSE,
        requiresRetraining,
      });
      patch = {
        type,
        inPSE,
        requiresRetraining,
        salaryImpact: fin.salaryImpact,
        savings: fin.salarySavings,
        cost: fin.socialCost,
      };
    }
    if (!patch) return;
    data.updateWorkforceMovement(rowId, patch);
    showToast(t("etp.toast.movementUpdated", "Mouvement mis à jour"), movement.label, "success");
  };

  const departmentOptions = useMemo(
    () => Array.from(new Set(wf.departments.map((d) => d.name))).sort(),
    [wf.departments]
  );
  const directionOptions = useMemo(
    () =>
      Array.from(new Set(wf.employees.map((e) => e.direction)))
        .filter(Boolean)
        .sort(),
    [wf.employees]
  );
  const countryOptions = useMemo(
    () =>
      Array.from(new Set(wf.employees.map((e) => e.country)))
        .filter(Boolean)
        .sort(),
    [wf.employees]
  );
  const funcOptions = useMemo(
    () =>
      Array.from(new Set(wf.employees.map((e) => e.func)))
        .filter(Boolean)
        .sort(),
    [wf.employees]
  );

  const etpColumns: ColumnDef<EtpRow>[] = [
    {
      key: "matricule",
      label: t("etp.column.matricule", "Matricule"),
      width: "110px",
      editable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-secondary">
          {(r.alertKind === "overdue" || r.alertKind === "leverMismatch") && (
            <TriangleAlert size={12} className="text-rag-red" />
          )}
          {r.alertKind === "due" && <TriangleAlert size={12} className="text-rag-amber" />}
          {r.matricule}
        </span>
      ),
    },
    {
      key: "name",
      label: t("etp.column.name", "Nom"),
      editable: true,
      render: (r) => <strong>{r.name}</strong>,
    },
    {
      key: "department",
      label: t("hr.department", "Département"),
      editable: true,
      options: departmentOptions,
      allowCustom: true,
    },
    {
      key: "direction",
      label: t("etp.filter.direction", "Direction"),
      editable: true,
      options: directionOptions,
      allowCustom: true,
    },
    {
      key: "country",
      label: t("dashboard.country", "Pays"),
      editable: true,
      options: countryOptions,
      allowCustom: true,
    },
    {
      key: "func",
      label: t("dashboard.function", "Fonction"),
      editable: true,
      options: funcOptions,
      allowCustom: true,
    },
    {
      key: "level",
      label: t("levers.columnStatus", "Niveau"),
      editable: true,
      options: ["Global", "Régional", "Local"],
    },
    {
      key: "fte",
      label: t("etp.column.fte", "ETP"),
      align: "right",
      editable: true,
      type: "number",
    },
    {
      key: "salary",
      label: t("etp.column.salaryEur", "Salaire (€)"),
      align: "right",
      editable: true,
      type: "number",
      render: (r) => r.salary.toLocaleString("fr-FR"),
    },
    { key: "hrOwner", label: t("etp.filter.hrOwnerLocal", "RH local"), editable: true },
  ];

  const movementColumns: ColumnDef<MovementRow>[] = [
    {
      key: "id",
      label: t("etp.column.id", "ID"),
      width: "100px",
      render: (r) => <span className="font-mono text-[11px] text-secondary">{r.id}</span>,
    },
    {
      // Round édition inline : le libellé se modifie désormais par double-clic directement dans
      // le tableau, comme les autres colonnes éditables ci-dessous — ne déclenche plus l'ouverture
      // de `MovementForm` en modale (réservée à la création, voir bouton "Nouveau mouvement").
      key: "label",
      label: t("etp.column.label", "Libellé"),
      editable: true,
      render: (r) => <span className="font-semibold text-primary">{r.label}</span>,
    },
    {
      key: "type",
      label: t("etp.filter.type", "Type"),
      editable: true,
      options: MOVEMENT_TYPES,
      optionLabel: (opt) => movementTypeLabel(t, opt),
      render: (r) => movementTypeLabel(t, r.type),
    },
    {
      key: "department",
      label: t("hr.department", "Département"),
      editable: true,
      options: departmentOptions,
      allowCustom: true,
    },
    {
      key: "country",
      label: t("dashboard.country", "Pays"),
      editable: true,
      options: countryOptions,
      allowCustom: true,
    },
    {
      key: "fte",
      label: t("etp.column.fte", "ETP"),
      align: "right",
      editable: true,
      type: "number",
    },
    {
      key: "plannedDate",
      label: t("etp.column.plannedDate", "Date prévue"),
      editable: true,
      type: "date",
    },
    {
      key: "actualDate",
      label: t("etp.column.actualDate", "Date réelle"),
      editable: true,
      type: "date",
    },
    {
      key: "status",
      label: t("hr.status", "Statut"),
      editable: true,
      options: MOVEMENT_STATUSES,
      optionLabel: (opt) => movementStatusLabel(t, opt),
      render: (r) => (
        <span>
          {movementStatusLabel(t, r.status)}
          {r.hrValidated && t("etp.hrValidatedSuffix", " ✓RH")}
        </span>
      ),
    },
    {
      key: "hrValidated",
      label: t("etp.hrValidated", "Validé RH"),
      render: (r) =>
        r.hrValidated ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rag-green-dark">
            <CheckCircle2 size={13} /> {t("etp.validatedLabel", "Validé")}
          </span>
        ) : readOnly ? (
          <span className="text-[11px] text-tertiary">—</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              data.validateMovement(r.movement.id);
              showToast(
                t("etp.toast.movementValidated", "Mouvement validé"),
                r.movement.label,
                "success"
              );
            }}
          >
            {t("etp.validateAction", "✓ Valider")}
          </Button>
        ),
    },
    {
      key: "leverCode",
      label: t("etp.linkedLever", "Levier lié"),
      render: (r) =>
        r.leverId ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/levers/detail?id=${r.leverId}`);
            }}
            className="font-mono text-[11px] text-bp-coral hover:underline"
          >
            {r.leverCode}
          </button>
        ) : (
          "—"
        ),
    },
    {
      key: "alertKind",
      label: t("etp.alertLabel", "Alerte"),
      render: (r) => {
        if (r.alertKind === "overdue")
          return <span className="text-[11px] text-rag-red">{ALERT_LABELS.overdue}</span>;
        if (r.alertKind === "due")
          return <span className="text-[11px] text-rag-amber">{ALERT_LABELS.due}</span>;
        if (r.alertKind === "toValidate")
          return <span className="text-[11px] text-rag-amber">{ALERT_LABELS.toValidate}</span>;
        if (r.alertKind === "leverMismatch")
          return <span className="text-[11px] text-rag-red">{ALERT_LABELS.leverMismatch}</span>;
        return <span className="text-[11px] text-tertiary">—</span>;
      },
    },
    {
      key: "savings",
      label: t("etp.column.savingsLoaded", "Économie salaire chargé"),
      align: "right",
      render: (r) =>
        r.savings > 0 ? (
          <span className="font-semibold text-rag-green-dark">
            {fmtCurr(r.savings / 1_000_000)}
          </span>
        ) : (
          <span className="text-tertiary">
            {r.salaryImpact !== 0 ? fmtCurr(r.salaryImpact / 1_000_000) : "—"}
          </span>
        ),
    },
    {
      key: "cost",
      label: t("etp.column.socialCosts", "Coûts sociaux associés"),
      align: "right",
      render: (r) => <span className="text-rag-amber">{fmtCurr(r.cost / 1_000_000)}</span>,
    },
    {
      key: "netImpact",
      label: t("etp.column.netImpactY1", "Impact net 1ère année"),
      align: "right",
      render: (r) => (
        <span
          className={`font-semibold ${r.netImpact <= 0 ? "text-rag-green-dark" : "text-primary"}`}
        >
          {fmtCurr(r.netImpact / 1_000_000)}
        </span>
      ),
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("nav.hrEtp", "Base ETP")}
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {t(
              "etp.employeesSummary",
              "{n} employés sur le périmètre transformation · {m} mouvements suivis"
            )
              .replace("{n}", String(wf.employees.length))
              .replace("{m}", String(wf.movements.length))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HrExcelButtons data={data} />
          {!readOnly && (
            <Button variant="primary" onClick={() => setMovementModal({})}>
              <Plus size={13} /> {t("etp.newMovement", "Nouveau mouvement")}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2">
        <KPICard
          label={t("etp.kpi.currentHeadcount", "Effectif actuel")}
          value={hr.currentFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
        />
        <KPICard
          label={t("etp.kpi.targetHeadcount", "Effectif cible")}
          value={hr.targetFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
          accent="green"
        />
        <KPICard
          label={t("hr.landingPlan", "Atterrissage plan")}
          value={hr.plannedFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
          accent="brown"
          sub={t("etp.kpi.landingPlanSub", "écart cible : {n} ETP").replace(
            "{n}",
            (hr.plannedFTE(wf) - hr.targetFTE(wf)).toLocaleString("fr-FR")
          )}
        />
        <KPICard
          label={t("etp.kpi.upcomingMovements", "Mouvements à venir")}
          value={String(plannedCount)}
          icon={Users}
          accent="amber"
        />
        <KPICard
          label={t("etp.kpi.toValidateHr", "À valider RH")}
          value={String(toValidateCount)}
          icon={CheckCircle2}
          accent={toValidateCount > 0 ? "red" : "default"}
        />
      </div>

      <div className="mb-3.5 flex gap-1 border-b border-border">
        <button
          onClick={() => setTab("etp")}
          className={`px-4 py-2 text-[13px] font-medium transition-colors ${
            tab === "etp"
              ? "border-b-2 border-bp-coral text-bp-coral"
              : "text-tertiary hover:text-primary"
          }`}
        >
          {t("nav.hrEtp", "Base ETP")}
        </button>
        <button
          onClick={() => setTab("mouvements")}
          className={`px-4 py-2 text-[13px] font-medium transition-colors ${
            tab === "mouvements"
              ? "border-b-2 border-bp-coral text-bp-coral"
              : "text-tertiary hover:text-primary"
          }`}
        >
          {t("etp.tab.movementsTracking", "Suivi des mouvements")}
        </button>
      </div>

      {tab === "etp" && (
        <>
          <div className="mb-3.5 rounded-md border border-border bg-white p-3">
            <DropdownFilterBar
              items={employeeRows}
              multiple
              defs={etpFilterDefs}
              active={etpActiveFilters}
              onChange={setEtpFilters}
            />
          </div>
          <EditableTable
            data={filteredEmployees}
            columns={etpColumns}
            onCellUpdate={handleCellUpdate}
            searchPlaceholder={t(
              "etp.searchPlaceholderEtp",
              "Rechercher (nom, matricule, fonction...)"
            )}
            defaultSort={{ key: "department", direction: "asc" }}
            readOnly={readOnly}
          />
        </>
      )}

      {tab === "mouvements" && (
        <>
          {highlightedMovementIds ? (
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-bp-coral/40 bg-bp-coral/[0.04] px-3 py-2.5">
              <span className="text-[12.5px] text-primary">
                {t(
                  "etp.deepLink.filteredHint",
                  "Affichage filtré sur {n} mouvement(s) sélectionné(s) depuis le tableau de bord."
                ).replace("{n}", String(highlightedMovementIds.length))}
              </span>
              <button
                type="button"
                onClick={clearHighlightedMovements}
                className="shrink-0 rounded-sm border border-border-strong bg-white px-2.5 py-1 text-[11px] font-semibold text-secondary transition hover:border-black hover:text-primary"
              >
                {t("etp.deepLink.reset", "Réinitialiser")}
              </button>
            </div>
          ) : (
            <div className="mb-3.5 rounded-md border border-border bg-white p-3">
              <DropdownFilterBar
                items={movementRows}
                multiple
                defs={movementFilterDefs}
                active={movementActiveFilters}
                onChange={setMovementFilters}
              />
            </div>
          )}
          <EditableTable
            data={filteredMovements}
            columns={movementColumns}
            onCellUpdate={handleMovementCellUpdate}
            searchPlaceholder={t(
              "etp.searchPlaceholderMovements",
              "Rechercher (libellé, type, département...)"
            )}
            defaultSort={{ key: "plannedDate", direction: "desc" }}
            readOnly={readOnly}
          />
        </>
      )}

      <Modal
        open={movementModal !== null}
        onOpenChange={(open) => !open && setMovementModal(null)}
        title={
          movementModal?.movement
            ? t("etp.modal.editMovement", "Modifier le mouvement")
            : t("etp.newMovement", "Nouveau mouvement")
        }
        maxWidth="640px"
      >
        {movementModal && (
          <MovementForm
            data={data}
            companyId={user?.companyId}
            initialValues={movementModal.movement}
            submitLabel={
              movementModal.movement
                ? t("common.save", "Enregistrer")
                : t("etp.form.createMovement", "Créer le mouvement")
            }
            onCancel={() => setMovementModal(null)}
            onSubmit={(values: MovementFormValues) => {
              if (movementModal.movement) {
                data.updateWorkforceMovement(movementModal.movement.id, values);
                showToast(
                  t("etp.toast.movementUpdated", "Mouvement mis à jour"),
                  values.label,
                  "success"
                );
              } else {
                data.createWorkforceMovement(values);
                showToast(
                  t("etp.toast.movementCreated", "Mouvement créé"),
                  values.label,
                  "success"
                );
              }
              setMovementModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
