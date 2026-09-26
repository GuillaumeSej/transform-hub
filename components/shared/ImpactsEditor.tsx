"use client";

import { DateInput } from "@/components/shared/DateInput";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, MessageSquare, Pencil } from "lucide-react";
import { HierarchyLeafSelect } from "@/components/shared/HierarchyLeafSelect";
import { Popover } from "@/components/shared/Popover";
import { subscribeHierarchyNodes } from "@/lib/firestore/admin";
import { getImpactNatures } from "@/lib/impactConfig";
import {
  impactDatesOf,
  impactDatesPatch,
  impactKindPatch,
  impactTypeOf,
  impactTypePatch,
  missingImpactFields,
  type ImpactTypeKey,
} from "@/lib/impactKinds";
import {
  canDecideImpactRealizedOn,
  isImpactRealizedRequester,
  coerceImpactStatus,
  decideImpactRealized,
  impactStatusOf,
  isImpactRealizedPending,
  realizedTogglePatch,
} from "@/lib/impactStatus";
import { effectiveLeafLevel, leafLevels } from "@/lib/hierarchyLogic";
import { useRole } from "@/lib/hooks/useRole";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Comment, Company, HierarchyNode, LeverImpact } from "@/types";
import { intlTag } from "@/lib/format";
import { SegmentedControl } from "@/components/shared/SegmentedControl";

const inputClass =
  "w-full min-w-0 truncate rounded-sm border border-transparent bg-transparent px-1 py-1 text-[12px] hover:border-border focus:border-bp-coral focus:bg-white focus:outline-none disabled:cursor-default disabled:hover:border-transparent disabled:text-primary";
const invalidClass = "!border-bp-coral bg-bp-coral/5";
// `truncate` (au lieu de `whitespace-nowrap` seul) : en `table-fixed`, un intitulé plus large que
// sa colonne débordait visuellement sur l'en-tête voisin (texte qui se chevauche) faute de
// troncature — chaque `<th>` porte désormais aussi un `title=` avec le libellé complet au survol.
const thClass =
  "truncate px-1 py-1.5 text-left text-[9.5px] font-semibold uppercase tracking-wide text-tertiary";
// Scrollbar horizontale toujours visible et assez épaisse pour un scroll à la souris (le
// scrollbar global de app/globals.css est fine/discrète) — cf. Tâche 2.B.
const scrollShellClass =
  "impacts-editor-scroll overflow-x-auto rounded-md border border-border bg-white";

// Palette de marque uniquement (tokens bp-*/rag-*/info-*, voir tailwind.config.ts) — une teinte
// distincte par type d'impact.
const TYPE_STYLE: Record<ImpactTypeKey, string> = {
  fte: "bg-bp-purple/10 text-bp-purple",
  opex_rec: "bg-rag-amber-light text-rag-amber",
  opex_oneoff: "bg-bp-light-pink/40 text-bp-red-brick",
  capex: "bg-info-blue-light text-info-blue",
  gain_rec: "bg-bp-warm-gray/40 text-bp-warm-brown",
  gain_oneoff: "bg-neutral-100 text-neutral-700",
};

/** Sélecteur segmenté compact (2 choix) intégré à la ligne. */
function Segmented({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { value: string; label: string; title: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <SegmentedControl
      size="xs"
      className="shrink-0"
      label={options.map((o) => o.title).join(" / ")}
      showLabel={false}
      disabled={disabled}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

function newId(): string {
  return "IMP" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function emptyFinancialImpact(): LeverImpact {
  return { id: newId(), label: "", amount: 0, ...impactKindPatch("opex") } as LeverImpact;
}

function emptyFteImpact(): LeverImpact {
  return { id: newId(), label: "", amount: 0, ...impactKindPatch("fte") } as LeverImpact;
}

function GeographyLeafSelect({
  companyId,
  levelKeys,
  value,
  onChange,
  disabled,
}: {
  companyId: string;
  levelKeys: string[];
  value?: string;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    let cancelled = false;
    const unsub = subscribeHierarchyNodes(
      companyId,
      (n) => {
        if (!cancelled) setNodes(n);
      },
      "geographic"
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [companyId]);
  return (
    <select
      className={inputClass}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{t("leverForm.selectPlaceholder", "Sélectionner")}</option>
      {nodes
        .filter((n) => levelKeys.includes(n.levelKey))
        .map((n) => (
          <option key={n.id} value={n.id}>
            {n.label} ({n.code})
          </option>
        ))}
    </select>
  );
}

function formatCommentTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intlTag(), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bouton commentaire compact (icône + compteur) ouvrant un popover liste + ajout.
 *
 * N'utilise PAS le `Popover` partagé (positionnement `absolute` simple) : ce bouton vit dans le
 * tableau d'impacts, lui-même enveloppé dans un conteneur `overflow-x-auto` (Tâche 2.B, scroll
 * horizontal). Or dès qu'un ancêtre fixe `overflow-x`, le navigateur bascule aussi `overflow-y` en
 * `auto` (règle CSS overflow — impossible d'avoir l'un `auto` et l'autre `visible`), ce qui rogne
 * verticalement tout panneau `position: absolute` qui déborderait de la hauteur du tableau : le
 * popover de commentaires pouvait ainsi devenir invisible (pas juste débordant à droite) dès qu'il
 * s'ouvrait près du bas du tableau — confirmé en inspectant le rendu (le panneau existait dans le
 * DOM mais son ancêtre `.impacts-editor-scroll` le clippait). On rend donc ce panneau via un portail
 * (`createPortal` → `document.body`), en `position: fixed` calculée depuis le rect du déclencheur :
 * il sort ainsi complètement du conteneur scrollable et ne peut plus être rogné, tout en restant
 * ancré par sa droite (déclencheur proche du bord droit du tableau, cf. Tâche 2.C). */
function CommentsCell({
  comments,
  onAdd,
  canComment,
}: {
  comments: Comment[];
  onAdd: (text: string) => void;
  canComment: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const count = comments.length;

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openPanel();
        }}
        title={t("impactsEditor.comments", "Commentaires")}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold ${
          count > 0
            ? "border-bp-coral/30 bg-bp-coral/10 text-bp-coral"
            : "border-border bg-white text-tertiary hover:bg-neutral-100"
        }`}
      >
        <MessageSquare size={11} />
        {count > 0 && count}
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 w-72 rounded-md border border-border bg-white p-2.5 text-left shadow-lg"
          >
            <div className="flex flex-col gap-2">
              {comments.length === 0 ? (
                <p className="text-[11px] text-tertiary">
                  {t("impactsEditor.noComments", "Aucun commentaire.")}
                </p>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                  {[...comments]
                    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
                    .map((c, i) => (
                      <li key={i} className="rounded-sm bg-neutral-50 px-2 py-1 text-[11px]">
                        <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-tertiary">
                          <span className="font-semibold text-secondary">{c.user}</span>
                          <span>{formatCommentTs(c.ts)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-primary">{c.text}</p>
                      </li>
                    ))}
                </ul>
              )}
              {canComment && (
                <div className="flex flex-col gap-1 border-t border-border pt-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("impactsEditor.addComment", "Ajouter un commentaire…")}
                    rows={2}
                    className="w-full resize-none rounded-sm border border-border px-1.5 py-1 text-[11px] focus:border-bp-coral focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!draft.trim()}
                    onClick={() => {
                      if (!draft.trim()) return;
                      onAdd(draft.trim());
                      setDraft("");
                    }}
                    className="self-end rounded-sm bg-bp-coral px-2 py-0.5 text-[10.5px] font-semibold text-white disabled:opacity-40"
                  >
                    {t("common.add", "Ajouter")}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** Éditeur d'impacts d'un levier (OPEX, CAPEX, gains, ETP) — tableau inline, une ligne par
 *  impact, illimité. `scope` sépare la vue en 2 tableaux distincts (financier hors ETP / ETP) :
 *  l'appelant place chaque instance dans son bloc dédié (Impact financier / Impact RH). */
export function ImpactsEditor({
  impacts,
  onChange,
  company,
  canEdit = true,
  readOnly = false,
  scope,
  programId,
}: {
  impacts: LeverImpact[];
  onChange: (next: LeverImpact[]) => void;
  company?: Company | null;
  canEdit?: boolean;
  readOnly?: boolean;
  /** "financial" = tout sauf ETP ; "fte" = uniquement les lignes ETP. */
  scope: "financial" | "fte";
  /** Programme du levier : les droits de validation finance du réalisé sont scopés programme. */
  programId?: string;
}) {
  const { t } = useTranslation();
  const { user } = useRole();
  const editable = canEdit && !readOnly;
  // Validation finance du réalisé : profil finance du programme du levier (ou admin), jamais le
  // demandeur lui-même (voir lib/impactStatus.ts::canDecideImpactRealizedOn).
  const canDecide = (imp: LeverImpact) =>
    canDecideImpactRealizedOn(user, programId ? { programId } : null, imp);
  const companyId = company?.id;
  const geoLevel = effectiveLeafLevel(company?.geographyHierarchyLevels ?? []);
  const showGeo = !!(geoLevel && companyId);
  const isFteScope = scope === "fte";
  const rows = impacts.filter((imp) => (impactTypeOf(imp) === "fte") === isFteScope);
  // Colonne crayon/coche (édition par ligne) en plus de la colonne suppression quand éditable.
  const colCount = (isFteScope ? 6 : 8) + (showGeo ? 1 : 0) + (editable ? 1 : 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  // Mode "édition par ligne" (Tâche 2.D) : une ligne est éditable soit parce que l'utilisateur a
  // cliqué sur le crayon, soit parce qu'elle vient d'être créée (sinon impossible à remplir).
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const startEditing = (id: string) =>
    setEditingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  const stopEditing = (id: string) =>
    setEditingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  const futureMsg = t(
    "impactsEditor.statusFutureWarn",
    "Impact réalisé : la date de début est dans le futur."
  );

  const update = (id: string, patch: Partial<LeverImpact>) =>
    onChange(
      impacts.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, ...patch };
        if (next.status && !("status" in patch))
          next.status = coerceImpactStatus(next, next.status);
        return next;
      })
    );
  const remove = (id: string) => {
    if (
      !window.confirm(
        t("impactsEditor.confirmDelete", "Supprimer cet impact ? Cette action est irréversible.")
      )
    )
      return;
    onChange(impacts.filter((i) => i.id !== id));
  };
  const addComment = (imp: LeverImpact, text: string) => {
    const comment: Comment = { user: user?.name ?? "?", ts: new Date().toISOString(), text };
    update(imp.id, { comments: [...(imp.comments ?? []), comment] });
  };

  const TYPE_LABELS: Record<ImpactTypeKey, string> = {
    fte: t("impactsEditor.typeFte", "ETP"),
    opex_rec: t("impactsEditor.typeOpexRec", "OPEX récurrent"),
    opex_oneoff: t("impactsEditor.typeOpexOneOff", "OPEX one-off"),
    capex: "CAPEX",
    gain_rec: t("impactsEditor.typeGainRec", "Gain récurrent"),
    gain_oneoff: t("impactsEditor.typeGainOneOff", "Gain one-off"),
  };
  const FIN_TYPES: ImpactTypeKey[] = [
    "opex_rec",
    "opex_oneoff",
    "capex",
    "gain_rec",
    "gain_oneoff",
  ];
  const na = (
    <span className="block px-1 text-tertiary/50" aria-hidden>
      —
    </span>
  );
  const star = <span className="text-bp-coral">*</span>;

  const thImpactType = t("impactsEditor.impactType", "Type d'impact");
  const thLabel = t("impactsEditor.label", "Libellé");
  const thAmount = isFteScope ? "ETP" : t("impactsEditor.amountShort", "€M");
  const thNature = t("impactsEditor.nature", "Nature");
  const thDestination = t("impactsEditor.destination", "Destination");
  const thGeo = geoLevel?.label ?? t("impactsEditor.geography", "Géographie");
  const thTechno = t("impactsEditor.technologyShort", "Techno.");
  const thStart = t("impactsEditor.startDate", "Début");
  const thEnd = t("impactsEditor.endDate", "Fin");
  const thComments = t("impactsEditor.comments", "Commentaires");
  const thStatus = t("impactsEditor.status", "Statut");
  const requiredSuffix = t("impactsEditor.requiredSuffix", "(obligatoire)");

  return (
    <div className="flex flex-col gap-2">
      <style>{`
        .impacts-editor-scroll{scrollbar-width:auto;scrollbar-color:var(--n-400) var(--n-100);}
        .impacts-editor-scroll::-webkit-scrollbar{height:12px;}
        .impacts-editor-scroll::-webkit-scrollbar-track{background:var(--n-100);}
        .impacts-editor-scroll::-webkit-scrollbar-thumb{background:var(--n-400);border-radius:999px;border:2px solid var(--n-100);}
        .impacts-editor-scroll::-webkit-scrollbar-thumb:hover{background:var(--n-500);}
      `}</style>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => scrollBy(-240)}
          aria-label={t("impactsEditor.scrollLeft", "Défiler vers la gauche")}
          title={t("impactsEditor.scrollLeft", "Défiler vers la gauche")}
          className="rounded-sm border border-border bg-white p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => scrollBy(240)}
          aria-label={t("impactsEditor.scrollRight", "Défiler vers la droite")}
          title={t("impactsEditor.scrollRight", "Défiler vers la droite")}
          className="rounded-sm border border-border bg-white p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div ref={scrollRef} className={scrollShellClass}>
        <table
          className={`w-full ${isFteScope ? "min-w-[860px]" : "min-w-[1180px]"} table-fixed border-collapse text-[12px]`}
        >
          <thead className="sticky top-0 z-10 border-b border-border bg-neutral-50">
            <tr>
              <th className={thClass} style={{ width: isFteScope ? 96 : 150 }} title={thImpactType}>
                {thImpactType}
              </th>
              <th className={thClass} style={{ minWidth: 200 }} title={thLabel}>
                {thLabel}
              </th>
              <th className={`${thClass} text-right`} style={{ width: 78 }} title={thAmount}>
                {thAmount}
              </th>
              {!isFteScope && (
                <>
                  <th
                    className={thClass}
                    style={{ width: 104 }}
                    title={`${thNature} ${requiredSuffix}`}
                  >
                    {thNature} {star}
                  </th>
                  <th
                    className={thClass}
                    style={{ width: 112 }}
                    title={`${thDestination} ${requiredSuffix}`}
                  >
                    {thDestination} {star}
                  </th>
                </>
              )}
              {showGeo && (
                <th className={thClass} style={{ width: 96 }} title={thGeo}>
                  {thGeo}
                </th>
              )}
              {!isFteScope && (
                <th className={thClass} style={{ width: 84 }} title={thTechno}>
                  {thTechno}
                </th>
              )}
              <th className={thClass} style={{ width: 108 }} title={thStart}>
                {thStart}
              </th>
              <th className={thClass} style={{ width: 108 }} title={thEnd}>
                {thEnd}
              </th>
              <th className={thClass} style={{ width: 44 }} title={thComments}>
                {thComments}
              </th>
              <th className={thClass} style={{ width: 140 }} title={thStatus}>
                {thStatus}
              </th>
              {editable && <th className={thClass} style={{ width: 56 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-3 py-5 text-center text-[11px] text-tertiary">
                  {t("impactsEditor.empty", "Aucun impact renseigné.")}
                </td>
              </tr>
            )}
            {rows.map((imp) => {
              const key = impactTypeOf(imp);
              const isFte = key === "fte";
              const isCapex = key === "capex";
              const smoothed = isCapex && imp.capexAllocationMode === "smoothed";
              const isGain = key === "gain_rec" || key === "gain_oneoff";
              const dates = impactDatesOf(imp);
              const showEnd = isFte || smoothed;
              const missing = missingImpactFields(imp);
              const natures = getImpactNatures(company, isGain ? "saving" : "cost");
              // « En cours » (legacy, récurrent) s'affiche comme « Réalisé ».
              const uiStatus = impactStatusOf(imp) === "planned" ? "planned" : "done";
              const futureWarn =
                uiStatus === "done" && !!dates.start && new Date(dates.start) > new Date();
              const pending = isImpactRealizedPending(imp);
              const rejected =
                imp.realizedApproval?.status === "rejected" && uiStatus === "planned";
              // Mode "édition par ligne" (Tâche 2.D) : lecture seule tant que la ligne n'est pas
              // passée en édition via le crayon (ou vient d'être créée, cf. bouton "+ Ajouter").
              const rowEditable = editable && editingIds.has(imp.id);
              return (
                <tr
                  key={imp.id}
                  className="group border-b border-border align-middle transition-colors last:border-b-0 even:bg-neutral-50/70 focus-within:bg-bp-coral/5 hover:bg-bp-coral/5"
                >
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      {isFte ? (
                        <span
                          className={`inline-flex shrink-0 items-center truncate rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_STYLE.fte}`}
                        >
                          {TYPE_LABELS.fte}
                        </span>
                      ) : (
                        <select
                          className={`min-w-0 flex-1 cursor-pointer truncate rounded-full border-0 px-1.5 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-bp-coral disabled:cursor-default ${TYPE_STYLE[key]}`}
                          disabled={!rowEditable}
                          aria-label={t("impactsEditor.impactType", "Type d'impact")}
                          value={key}
                          onChange={(e) =>
                            update(imp.id, impactTypePatch(imp, e.target.value as ImpactTypeKey))
                          }
                        >
                          {FIN_TYPES.map((k) => (
                            <option key={k} value={k}>
                              {TYPE_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      )}
                      {isCapex && (
                        <Segmented
                          disabled={!rowEditable}
                          value={imp.capexAllocationMode ?? "one_shot"}
                          options={[
                            {
                              value: "one_shot",
                              label: "1×",
                              title: t("impactsEditor.oneOff", "Ponctuel"),
                            },
                            {
                              value: "smoothed",
                              label: "~",
                              title: t("impactsEditor.smoothed", "Lissé"),
                            },
                          ]}
                          onChange={(v) => {
                            const mode = v as "one_shot" | "smoothed";
                            const { start } = impactDatesOf(imp);
                            const next = { ...imp, capexAllocationMode: mode } as LeverImpact;
                            update(imp.id, {
                              capexAllocationMode: mode,
                              capexStartDate: undefined,
                              capexDeploymentDate: undefined,
                              ...impactDatesPatch(next, { start: start ?? null }),
                            });
                          }}
                        />
                      )}
                      {isFte && (
                        <Segmented
                          disabled={!rowEditable}
                          value={imp.fteDirection ?? "hire"}
                          options={[
                            {
                              value: "hire",
                              label: "+",
                              title: t("impactsEditor.hire", "Recrutement (+)"),
                            },
                            {
                              value: "departure",
                              label: "−",
                              title: t("impactsEditor.departure", "Départ (−)"),
                            },
                          ]}
                          onChange={(v) => {
                            const dir = v as "hire" | "departure";
                            const { start } = impactDatesOf(imp);
                            const next = { ...imp, fteDirection: dir } as LeverImpact;
                            update(imp.id, {
                              fteDirection: dir,
                              gainDate: undefined,
                              capexDeploymentDate: undefined,
                              ...impactDatesPatch(next, { start: start ?? null }),
                            });
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className={inputClass}
                      disabled={!rowEditable}
                      value={imp.label}
                      title={imp.label}
                      placeholder={t("impactsEditor.untitled", "Impact sans libellé")}
                      onChange={(e) => update(imp.id, { label: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    {isFte ? (
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        step="0.1"
                        min={0}
                        placeholder="0"
                        disabled={!rowEditable}
                        aria-label={t("impactsEditor.fteCount", "Nombre d'ETP")}
                        value={imp.fteCount ?? ""}
                        onChange={(e) =>
                          update(imp.id, {
                            fteCount: e.target.value ? parseFloat(e.target.value) : undefined,
                          })
                        }
                      />
                    ) : (
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="0"
                        disabled={!rowEditable}
                        aria-label={t("impactsEditor.amount", "Montant (€M)")}
                        value={imp.amount || ""}
                        onChange={(e) =>
                          update(imp.id, { amount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    )}
                  </td>
                  {!isFteScope && (
                    <>
                      <td className="px-1 py-1">
                        <select
                          className={`${inputClass} ${missing.includes("nature") ? invalidClass : ""}`}
                          disabled={!rowEditable}
                          required
                          aria-invalid={missing.includes("nature")}
                          value={imp.natureId ?? ""}
                          onChange={(e) =>
                            update(imp.id, { natureId: e.target.value || undefined })
                          }
                        >
                          <option value="">{t("impactsEditor.required", "Requis *")}</option>
                          {natures.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        {rowEditable && companyId ? (
                          <HierarchyLeafSelect
                            companyId={companyId}
                            value={imp.hierarchyLeafId}
                            onChange={(v) => update(imp.id, { hierarchyLeafId: v })}
                            className={`${inputClass} ${missing.includes("hierarchy") ? invalidClass : ""}`}
                          />
                        ) : (
                          <input
                            className={inputClass}
                            disabled={!rowEditable}
                            value={imp.costCenter ?? ""}
                            onChange={(e) =>
                              update(imp.id, { costCenter: e.target.value || undefined })
                            }
                          />
                        )}
                      </td>
                    </>
                  )}
                  {showGeo && (
                    <td className="px-1 py-1">
                      <GeographyLeafSelect
                        companyId={companyId!}
                        levelKeys={leafLevels(company?.geographyHierarchyLevels ?? []).map(
                          (l) => l.key
                        )}
                        value={imp.geographyLeafId}
                        disabled={!rowEditable}
                        onChange={(v) => update(imp.id, { geographyLeafId: v })}
                      />
                    </td>
                  )}
                  {!isFteScope && (
                    <td className="px-1 py-1">
                      <input
                        className={inputClass}
                        disabled={!rowEditable}
                        value={imp.technology ?? ""}
                        title={imp.technology ?? ""}
                        onChange={(e) =>
                          update(imp.id, { technology: e.target.value || undefined })
                        }
                      />
                    </td>
                  )}
                  <td className="px-1 py-1">
                    <DateInput
                      className={`${inputClass} text-[11px]`}
                      disabled={!rowEditable}
                      aria-label={t("impactsEditor.startDate", "Début")}
                      value={dates.start ?? ""}
                      onChange={(v) => update(imp.id, impactDatesPatch(imp, { start: v }))}
                    />
                  </td>
                  <td className="px-1 py-1">
                    {showEnd ? (
                      <DateInput
                        className={`${inputClass} text-[11px]`}
                        disabled={!rowEditable}
                        aria-label={t("impactsEditor.endDate", "Fin")}
                        value={dates.end ?? ""}
                        onChange={(v) => update(imp.id, impactDatesPatch(imp, { end: v }))}
                      />
                    ) : (
                      na
                    )}
                  </td>
                  <td className="px-1 py-1 text-center">
                    <CommentsCell
                      comments={imp.comments ?? []}
                      canComment={canEdit && !readOnly}
                      onAdd={(text) => addComment(imp, text)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex flex-col items-start gap-0.5">
                      <label
                        className="inline-flex cursor-pointer items-center gap-1.5"
                        title={futureWarn ? futureMsg : undefined}
                      >
                        <input
                          type="checkbox"
                          disabled={!rowEditable}
                          checked={uiStatus === "done"}
                          onChange={(e) =>
                            update(imp.id, realizedTogglePatch(imp, e.target.checked, user))
                          }
                          className="h-3.5 w-3.5 accent-bp-coral"
                        />
                        <span
                          className={`text-[11px] font-semibold ${uiStatus === "done" ? "text-rag-green-dark" : "text-tertiary"} ${futureWarn ? "underline decoration-bp-coral decoration-dotted" : ""}`}
                        >
                          {t("impactsEditor.statusDone", "Réalisé")}
                        </span>
                      </label>
                      {pending && (
                        <Popover
                          trigger={({ toggle }) => (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle();
                              }}
                              className="rounded-full bg-rag-amber-light px-1.5 py-0.5 text-[9.5px] font-semibold text-rag-amber"
                            >
                              {t("impactsEditor.pendingFinance", "En attente validation finance")}
                            </button>
                          )}
                        >
                          <div className="flex flex-col gap-1.5 text-[11px]">
                            <p className="text-secondary">
                              {t(
                                "impactsEditor.pendingFinanceDetail",
                                "Demandé par {who} — en attente de validation par un profil Finance."
                              ).replace("{who}", imp.realizedApproval?.requestedBy ?? "?")}
                            </p>
                            {isImpactRealizedRequester(imp, user) && (
                              <p className="text-tertiary">
                                {t(
                                  "levers.approval.realizedOwn",
                                  "Votre déclaration : elle doit être validée par un autre profil Finance ou un admin."
                                )}
                              </p>
                            )}
                            {canDecide(imp) && (
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    update(imp.id, decideImpactRealized(imp, "approved", user))
                                  }
                                  className="flex-1 rounded-sm bg-rag-green px-2 py-1 text-[10.5px] font-semibold text-white"
                                >
                                  {t("impactsEditor.approve", "Valider")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    update(imp.id, decideImpactRealized(imp, "rejected", user))
                                  }
                                  className="flex-1 rounded-sm bg-rag-red px-2 py-1 text-[10.5px] font-semibold text-white"
                                >
                                  {t("impactsEditor.reject", "Rejeter")}
                                </button>
                              </div>
                            )}
                          </div>
                        </Popover>
                      )}
                      {rejected && (
                        <span className="rounded-full bg-rag-red-light px-1.5 py-0.5 text-[9.5px] font-semibold text-rag-red">
                          {t("impactsEditor.rejectedFinance", "Rejeté par la finance")}
                        </span>
                      )}
                    </div>
                  </td>
                  {editable && (
                    <td className="px-0.5 py-1">
                      <div className="flex items-center justify-center gap-1">
                        {rowEditable ? (
                          <button
                            type="button"
                            onClick={() => stopEditing(imp.id)}
                            aria-label={t("common.validate", "Valider")}
                            title={t("common.validate", "Valider")}
                            className="rounded-sm p-0.5 text-rag-green-dark hover:bg-rag-green-light"
                          >
                            <Check size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditing(imp.id)}
                            aria-label={t("common.edit", "Modifier")}
                            title={t("common.edit", "Modifier")}
                            className="rounded-sm p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(imp.id)}
                          aria-label={t("common.delete", "Supprimer")}
                          title={t("common.delete", "Supprimer")}
                          className="text-[15px] leading-none text-tertiary opacity-0 transition hover:text-bp-coral focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && (
        <div>
          <button
            type="button"
            onClick={() => {
              const newImpact = isFteScope ? emptyFteImpact() : emptyFinancialImpact();
              startEditing(newImpact.id);
              onChange([...impacts, newImpact]);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            +{" "}
            {isFteScope
              ? t("impactsEditor.addFte", "Ajouter un impact ETP")
              : t("impactsEditor.addFinancial", "Ajouter un impact financier")}
          </button>
        </div>
      )}
    </div>
  );
}
