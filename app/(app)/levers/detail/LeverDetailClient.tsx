"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BarChart3, LayoutGrid, Pencil, Plus, Send } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useToast } from "@/lib/hooks/useToast";
import * as engine from "@/lib/engine";
import type { CascadeShift } from "@/lib/engine";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { Avatar } from "@/components/shared/Avatar";
import { StageBadge } from "@/components/shared/StageBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Modal } from "@/components/shared/Modal";
import { LeverForm, type LeverFormValues } from "@/components/shared/LeverForm";
import { SubLeverForm, type SubLeverFormValues } from "@/components/shared/SubLeverForm";
import { ActionForm, type ActionFormValues } from "@/components/shared/ActionForm";
import { ActionKanban } from "@/components/shared/ActionKanban";
import { ActionGantt } from "@/components/shared/ActionGantt";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import type { ActionStatus, LeverAction, SubLever } from "@/types";

const TABS = ["overview", "plan", "impact", "collab"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  plan: "Plan d'action",
  impact: "Impact",
  collab: "Collaboration",
};

type CascadeProposal = { shifts: CascadeShift[] };

export default function LeverDetailClient() {
  const data = useBeTrackData();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [subLeverModal, setSubLeverModal] = useState<{ mode: "create" | "edit"; sub?: SubLever } | null>(
    null
  );
  const [actionModal, setActionModal] = useState<{ mode: "create" | "edit"; action?: LeverAction } | null>(
    null
  );
  const [activeSubLeverId, setActiveSubLeverId] = useState<string | null>(null);
  const [actionView, setActionView] = useState<"kanban" | "gantt">("kanban");
  const [cascadeProposal, setCascadeProposal] = useState<CascadeProposal | null>(null);

  const lever = data.getLeverById(id);

  if (!lever) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        Levier introuvable.{" "}
        <button
          onClick={() => router.push("/levers")}
          className="font-medium text-bp-coral hover:underline"
        >
          Retour au pipeline
        </button>
      </div>
    );
  }

  const ws = data.workstreams.find((w) => w.id === lever.ws);
  const real = engine.realizedSavings(lever, data);
  const realFte = engine.realizedFte(lever);
  const comments = data.getComments(lever.id);
  const subLevers = data.getSubLeversForLever(lever.id);
  const hasSubLevers = subLevers.length > 0;
  const activeSubLever = hasSubLevers
    ? (subLevers.find((s) => s.id === activeSubLeverId) ?? subLevers[0])
    : undefined;
  const actions = activeSubLever ? activeSubLever.actions : (lever.actions ?? []);
  const actionScope = activeSubLever
    ? { leverId: lever.id, subLeverId: activeSubLever.id }
    : { leverId: lever.id };

  /** Vérifie si un décalage de date en implique un autre en cascade sur les entités dépendantes,
   * et propose la confirmation à l'utilisateur (jamais appliqué automatiquement). */
  const checkCascade = (entityId: string, oldEnd: string, newEnd: string) => {
    const shifts = engine.computeCascadeShift(entityId, oldEnd, newEnd, data);
    if (shifts.length > 0) setCascadeProposal({ shifts });
  };

  return (
    <div className="animate-fade-up">
      <button
        onClick={() => router.push("/levers")}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-bp-coral"
      >
        <ArrowLeft size={13} /> Retour au pipeline
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] text-tertiary">{lever.code}</div>
          <h1 className="mt-0.5 text-xl font-bold text-primary">{lever.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <StageBadge status={lever.status} />
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil size={13} /> Modifier le levier
          </Button>
        </div>
      </div>

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Modifier le levier" maxWidth="760px">
        <LeverForm
          data={data}
          initialValues={lever}
          submitLabel="Enregistrer les modifications"
          onCancel={() => setEditOpen(false)}
          onSubmit={(values: LeverFormValues) => {
            const oldEnd = lever.end;
            data.updateLever(lever.id, values);
            setEditOpen(false);
            showToast("Levier mis à jour", lever.name, "success");
            if (!hasSubLevers && values.end > oldEnd) checkCascade(lever.id, oldEnd, values.end);
          }}
        />
      </Modal>

      <Modal
        open={subLeverModal !== null}
        onOpenChange={(open) => !open && setSubLeverModal(null)}
        title={subLeverModal?.mode === "edit" ? "Modifier le sous-levier" : "Nouveau sous-levier"}
        maxWidth="700px"
      >
        {subLeverModal && (
          <SubLeverForm
            data={data}
            leverId={lever.id}
            excludeSubLeverId={subLeverModal.sub?.id}
            initialValues={subLeverModal.sub}
            submitLabel={subLeverModal.mode === "edit" ? "Enregistrer" : "Créer le sous-levier"}
            onCancel={() => setSubLeverModal(null)}
            onDelete={
              subLeverModal.sub
                ? () => {
                    data.deleteSubLever(subLeverModal.sub!.id);
                    setSubLeverModal(null);
                    showToast("Sous-levier supprimé", "", "success");
                  }
                : undefined
            }
            onSubmit={(values: SubLeverFormValues) => {
              const before = subLeverModal.sub;
              if (before) {
                data.updateSubLever(before.id, values);
                if (values.end > before.end) checkCascade(before.id, before.end, values.end);
              } else {
                data.createSubLever(values);
              }
              setSubLeverModal(null);
              showToast(before ? "Sous-levier mis à jour" : "Sous-levier créé", values.name, "success");
            }}
          />
        )}
      </Modal>

      <Modal
        open={actionModal !== null}
        onOpenChange={(open) => !open && setActionModal(null)}
        title={actionModal?.mode === "edit" ? "Modifier l'action" : "Nouvelle action"}
        maxWidth="480px"
      >
        {actionModal && (
          <ActionForm
            initialValues={actionModal.action}
            submitLabel={actionModal.mode === "edit" ? "Enregistrer" : "Créer l'action"}
            onCancel={() => setActionModal(null)}
            onDelete={
              actionModal.action
                ? () => {
                    data.deleteAction(actionScope, actionModal.action!.id);
                    setActionModal(null);
                    showToast("Action supprimée", "", "success");
                  }
                : undefined
            }
            onSubmit={(values: ActionFormValues) => {
              if (actionModal.action) {
                data.updateAction(actionScope, actionModal.action.id, values);
              } else {
                data.createAction(actionScope, values);
              }
              setActionModal(null);
              showToast(actionModal.action ? "Action mise à jour" : "Action créée", values.name, "success");

              // Une action qui dépasse la date de fin de son sous-levier/levier étend cette
              // dernière — et déclenche la cascade sur les dépendants si nécessaire.
              const scopeEntity = activeSubLever ?? lever;
              if (values.end > scopeEntity.end) {
                if (activeSubLever) data.updateSubLever(activeSubLever.id, { end: values.end });
                else data.updateLever(lever.id, { end: values.end });
                checkCascade(scopeEntity.id, scopeEntity.end, values.end);
              }
            }}
          />
        )}
      </Modal>

      <Modal
        open={cascadeProposal !== null}
        onOpenChange={(open) => !open && setCascadeProposal(null)}
        title="Décalage à appliquer sur les dépendances"
        maxWidth="560px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCascadeProposal(null)}>
              Ignorer
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                data.applyCascadeShift(cascadeProposal!.shifts);
                showToast(
                  "Décalage appliqué",
                  `${cascadeProposal!.shifts.length} élément(s) mis à jour`,
                  "success"
                );
                setCascadeProposal(null);
              }}
            >
              Appliquer le décalage
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-secondary">
          Ce retard impacte {cascadeProposal?.shifts.length} élément(s) dépendant(s). Voulez-vous
          décaler leurs dates du même nombre de jours ?
        </p>
        <div className="space-y-2">
          {cascadeProposal?.shifts.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-neutral-50 p-2.5 text-xs">
              <div className="font-semibold text-primary">
                {s.kind === "lever" ? "Levier" : "Sous-levier"} · {s.name}
              </div>
              <div className="mt-1 text-tertiary">
                {s.oldStart} → {s.oldEnd}{" "}
                <span className="mx-1 font-semibold text-bp-coral">devient</span> {s.newStart} →{" "}
                {s.newEnd}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <div className="mb-4 flex gap-0 rounded-t-lg border-b-[1.5px] border-border bg-white px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-[1.5px] border-b-[2.5px] px-4 py-3 text-[12.5px] font-semibold transition ${
              tab === t
                ? "border-bp-coral text-bp-coral"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {TAB_LABELS[t]}
            {t === "collab" && ` (${comments.length})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <Card>
          <CardBody>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Code">
                <span className="font-mono text-[13px]">{lever.code}</span>
              </Stat>
              <Stat label="Type de levier">{lever.type}</Stat>
              <Stat label="Workstream">
                <span style={{ color: ws?.color }}>{ws?.name}</span>
              </Stat>
              <Stat label="Owner">
                <Avatar initials={lever.ownerInit} /> {lever.owner}
              </Stat>
              <Stat label="Sponsor">
                <Avatar initials={lever.sponsorInit} /> {lever.sponsor}
              </Stat>
              <Stat label="Status">
                <StageBadge status={lever.status} />
              </Stat>
              <Stat label="Géographie">
                {lever.geography} · {lever.country}
              </Stat>
              <Stat label="Function / Entité">
                {lever.function} · {lever.entity}
              </Stat>
              <Stat label="Centre de coût">
                <span className="font-mono text-[13px]">
                  {hasSubLevers ? `${subLevers.length} centres de coût` : lever.costCenter}
                </span>
              </Stat>
              <Stat label="Niveau d'avancement">
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold">
                  {lever.maturityLevel}
                </span>
              </Stat>
              <Stat label="Priorité">
                <StatusBadge risk={lever.priority} />
              </Stat>
              <Stat label="Risque">
                <StatusBadge risk={lever.risk} />
              </Stat>
              <Stat label="Date de départ">{lever.start}</Stat>
              <Stat label="Date de fin estimée">{lever.end}</Stat>
              <Stat label="Dernière mise à jour">{lever.lastUpdate}</Stat>
            </div>
            <SectionTitle>Description</SectionTitle>
            <p className="text-[13px] text-secondary">{lever.description}</p>
            <SectionTitle>Progression {hasSubLevers && "(calculée depuis les sous-leviers)"}</SectionTitle>
            <ProgressBar pct={lever.progress} />

            <div className="mt-6 flex items-center justify-between border-b-[1.5px] border-bp-coral pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                Sous-leviers
              </span>
              <button
                onClick={() => setSubLeverModal({ mode: "create" })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-bp-coral hover:underline"
              >
                <Plus size={12} /> Ajouter un sous-levier
              </button>
            </div>
            {!hasSubLevers && (
              <p className="mt-2.5 text-[13px] text-secondary">
                Ce levier a un impact sur un centre de coût unique ({lever.costCenter}) — pas de
                sous-levier nécessaire.
              </p>
            )}
            {hasSubLevers && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                {subLevers.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSubLeverModal({ mode: "edit", sub: s })}
                    className="rounded-md border border-border bg-white p-3 text-left transition hover:border-bp-coral"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-primary">{s.name}</span>
                      <StageBadge status={s.status} />
                    </div>
                    <div className="mt-1 text-[11px] text-tertiary">{s.costCenter}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-bp-coral">
                        {engine.fmtCurr(s.netSavings)}
                      </span>
                      <ProgressBar
                        pct={engine.subLeverProgress(s)}
                        showLabel={false}
                        className="ml-2 flex-1"
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}

            {lever.dependencies.length > 0 && (
              <>
                <SectionTitle>Dépendances</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {lever.dependencies.map((d) => (
                    <button
                      key={d}
                      onClick={() => router.push(`/levers/detail?id=${d}`)}
                      className="rounded-full border border-border bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-secondary hover:border-bp-coral hover:text-bp-coral"
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "plan" && (
        <Card>
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              {hasSubLevers ? (
                <div className="flex flex-wrap gap-1.5">
                  {subLevers.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActiveSubLeverId(s.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        activeSubLever?.id === s.id
                          ? "border-bp-coral bg-bp-coral text-white"
                          : "border-border bg-white text-secondary hover:border-bp-coral hover:text-bp-coral"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] font-semibold text-primary">
                  Plan d&apos;action — {lever.name}
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-md border border-border">
                  <button
                    onClick={() => setActionView("kanban")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${actionView === "kanban" ? "bg-bp-coral text-white" : "bg-white text-secondary"}`}
                  >
                    <LayoutGrid size={13} /> Kanban
                  </button>
                  <button
                    onClick={() => setActionView("gantt")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${actionView === "gantt" ? "bg-bp-coral text-white" : "bg-white text-secondary"}`}
                  >
                    <BarChart3 size={13} /> Gantt
                  </button>
                </div>
                <Button variant="primary" size="sm" onClick={() => setActionModal({ mode: "create" })}>
                  <Plus size={12} /> Action
                </Button>
              </div>
            </div>

            {actionView === "kanban" ? (
              <ActionKanban
                actions={actions}
                onCardClick={(action) => setActionModal({ mode: "edit", action })}
                onStatusChange={(actionId, status: ActionStatus) =>
                  data.updateAction(actionScope, actionId, { status })
                }
              />
            ) : (
              <ActionGantt
                actions={actions}
                onCardClick={(action) => setActionModal({ mode: "edit", action })}
              />
            )}
          </CardBody>
        </Card>
      )}

      {tab === "impact" && (
        <Card>
          <CardBody>
            {hasSubLevers ? (
              <>
                <SectionTitle first>Impact financier par sous-levier</SectionTitle>
                <SubLeverImpactTable
                  subLevers={subLevers}
                  pnlAccountName={(pnlId) =>
                    data.pnlAccounts.find((p) => p.id === pnlId)?.name ?? pnlId
                  }
                />
              </>
            ) : (
              <>
                <SectionTitle first>Impact financier</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <Stat label="Impact estimé (brut)" accent>
                    {engine.fmtCurr(lever.grossSavings)}
                  </Stat>
                  <Stat label="Impact estimé (net)" accent>
                    {engine.fmtCurr(lever.netSavings)}
                  </Stat>
                  <Stat label="Réalisé à date (€)">{engine.fmtCurr(real)}</Stat>
                  <Stat label="CAPEX">{engine.fmtCurr(lever.capex)}</Stat>
                  <Stat label="OPEX one-off">{engine.fmtCurr(lever.opexOneOff)}</Stat>
                  <Stat label="OPEX récurrent /an">{engine.fmtCurr(lever.opexRec)}</Stat>
                </div>
                <SectionTitle>Mapping P&L</SectionTitle>
                <p className="text-[13px] text-secondary">
                  Compte impacté :{" "}
                  <strong>
                    {data.pnlAccounts.find((p) => p.id === lever.pnlMap)?.name ?? lever.pnlMap}
                  </strong>
                </p>
                <SectionTitle>Impact RH</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <Stat label="Impact estimé (ETP)">
                    {lever.fteImpact > 0 ? `+${lever.fteImpact}` : lever.fteImpact}
                  </Stat>
                  <Stat label="Réalisé à date (ETP)">{realFte > 0 ? `+${realFte}` : realFte}</Stat>
                  <Stat label="Population impactée">{lever.popImpacted}</Stat>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "collab" && (
        <Card>
          <CardBody>
            {comments.length === 0 && (
              <p className="py-6 text-center text-xs text-tertiary">
                Aucun commentaire pour le moment
              </p>
            )}
            {comments.map((c, i) => (
              <div key={i} className="border-b border-border py-2.5 last:border-b-0">
                <div className="flex items-center justify-between">
                  <strong className="text-xs">{c.user}</strong>
                  <span className="text-[11px] text-tertiary">{c.ts}</span>
                </div>
                <div className="mt-1 text-[13px] text-primary">{c.text}</div>
              </div>
            ))}
            <div className="mt-3.5">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Ajouter un commentaire..."
                rows={2}
                className="w-full rounded-sm border border-border px-3 py-2 text-xs focus:border-bp-coral focus:outline-none"
              />
              <Button
                variant="primary"
                size="sm"
                className="mt-2"
                onClick={() => {
                  if (!comment.trim()) return;
                  data.addComment(lever.id, comment);
                  setComment("");
                  showToast("Commentaire ajouté", "", "success");
                }}
              >
                <Send size={12} /> Envoyer
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SubLeverImpactTable({
  subLevers,
  pnlAccountName,
}: {
  subLevers: SubLever[];
  pnlAccountName: (id: string) => string;
}) {
  type Row = SubLever & { pnlName: string; progressPct: number };
  const rows: Row[] = subLevers.map((s) => ({
    ...s,
    pnlName: pnlAccountName(s.pnlMap),
    progressPct: engine.subLeverProgress(s),
  }));

  const columns: ColumnDef<Row>[] = [
    { key: "name", label: "Sous-levier", render: (r) => <strong>{r.name}</strong> },
    { key: "costCenter", label: "Centre de coût" },
    { key: "pnlName", label: "Compte P&L" },
    {
      key: "netSavings",
      label: "Net €M",
      align: "right",
      render: (r) => r.netSavings.toFixed(1),
    },
    { key: "capex", label: "CAPEX €M", align: "right", render: (r) => r.capex.toFixed(1) },
    {
      key: "opexOneOff",
      label: "OPEX €M",
      align: "right",
      render: (r) => (r.opexOneOff + r.opexRec).toFixed(1),
    },
    { key: "fteImpact", label: "ETP", align: "right" },
    {
      key: "progressPct",
      label: "Progression",
      render: (r) => <ProgressBar pct={r.progressPct} />,
    },
    { key: "status", label: "Statut", render: (r) => <StageBadge status={r.status} /> },
  ];

  return (
    <EditableTable
      data={rows}
      columns={columns}
      showTotalsRow
      totalsConfig={{
        netSavings: (list) => list.reduce((s, r) => s + r.netSavings, 0).toFixed(1),
        capex: (list) => list.reduce((s, r) => s + r.capex, 0).toFixed(1),
        opexOneOff: (list) =>
          list.reduce((s, r) => s + r.opexOneOff + r.opexRec, 0).toFixed(1),
        fteImpact: (list) => list.reduce((s, r) => s + r.fteImpact, 0),
      }}
    />
  );
}

function SectionTitle({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      className={`border-b-[1.5px] border-bp-coral pb-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary ${first ? "mt-0" : "mt-6"} mb-2.5`}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  children,
  accent = false,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${accent ? "text-bp-coral" : "text-primary"}`}>
        {children}
      </div>
    </div>
  );
}
