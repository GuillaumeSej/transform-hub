"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useToast } from "@/lib/hooks/useToast";
import * as engine from "@/lib/engine";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { Avatar } from "@/components/shared/Avatar";
import { StageBadge } from "@/components/shared/StageBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";

const TABS = ["overview", "plan", "impact", "collab", "audit"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  plan: "Plan d'action",
  impact: "Impact",
  collab: "Collaboration",
  audit: "Audit",
};

export default function LeverDetailClient({ id }: { id: string }) {
  const data = useBeTrackData();
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [comment, setComment] = useState("");

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
  const pct = Math.round((real / Math.max(0.01, lever.netSavings)) * 100);
  const comments = data.getComments(lever.id);
  const auditForLever = data.audit.filter((a) => a.entity === lever.id).slice(0, 8);

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
          <Button
            variant="outline"
            onClick={() => {
              const input = window.prompt(
                "Nouveau % de progression (0-100)",
                String(lever.progress)
              );
              if (input === null) return;
              const n = Number(input);
              if (Number.isNaN(n)) return;
              data.updateLever(lever.id, {
                progress: n,
                status: n >= 100 ? "delivered" : lever.status,
              });
              showToast("Progression mise à jour", `${lever.name} : ${n}%`, "success");
            }}
          >
            Saisir avancement
          </Button>
        </div>
      </div>

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
            {t === "audit" && ` (${auditForLever.length})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <Card>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Owner">
                <Avatar initials={lever.ownerInit} /> {lever.owner}
              </Stat>
              <Stat label="Workstream">
                <span style={{ color: ws?.color }}>{ws?.name}</span>
              </Stat>
              <Stat label="Géographie">
                {lever.geography} · {lever.country}
              </Stat>
              <Stat label="Function">{lever.function}</Stat>
              <Stat label="Timeline">
                {lever.start} → {lever.end}
              </Stat>
              <Stat label="Status">
                <StageBadge status={lever.status} />
              </Stat>
            </div>
            <SectionTitle>Description</SectionTitle>
            <p className="text-[13px] text-secondary">{lever.description}</p>
            <SectionTitle>Progression</SectionTitle>
            <ProgressBar pct={pct} />
            {lever.dependencies.length > 0 && (
              <>
                <SectionTitle>Dépendances</SectionTitle>
                <div className="flex gap-1.5">
                  {lever.dependencies.map((d) => (
                    <button
                      key={d}
                      onClick={() => router.push(`/levers/${d}`)}
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
            <div className="relative space-y-4 pl-6 before:absolute before:bottom-1 before:left-[6px] before:top-1 before:w-0.5 before:bg-border">
              {[
                {
                  done: true,
                  date: lever.start,
                  title: "Démarrage projet",
                  desc: "Mobilisation équipe, kick-off, baseline",
                },
                {
                  done: true,
                  date: "Phase 1",
                  title: "Diagnostic & opportunities",
                  desc: "Cartographie, identification des gisements",
                },
                {
                  done: lever.progress >= 50,
                  current: lever.progress < 50,
                  date: "Phase 2 (en cours)",
                  title: "Mise en œuvre",
                  desc: "Exécution des actions opérationnelles",
                },
                {
                  done: false,
                  current: lever.progress >= 80,
                  date: "Phase 3",
                  title: "Stabilisation",
                  desc: "Ancrage, formation, transfert",
                },
                {
                  done: false,
                  date: lever.end,
                  title: "Clôture",
                  desc: "Bilan savings, hand-over",
                },
              ].map((step, i) => (
                <div key={i} className="relative">
                  <div
                    className={`absolute -left-6 top-1 h-3 w-3 rounded-full border-2 ${
                      step.done
                        ? "border-rag-green bg-rag-green"
                        : step.current
                          ? "border-bp-coral bg-bp-coral"
                          : "border-bp-coral bg-white"
                    }`}
                  />
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                    {step.date}
                  </div>
                  <div className="text-[13px] font-semibold text-primary">{step.title}</div>
                  <div className="text-xs text-secondary">{step.desc}</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "impact" && (
        <Card>
          <CardBody>
            <SectionTitle first>Impact financier</SectionTitle>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Gross savings" accent>
                {engine.fmtCurr(lever.grossSavings)}
              </Stat>
              <Stat label="Net savings" accent>
                {engine.fmtCurr(lever.netSavings)}
              </Stat>
              <Stat label="Realized">{engine.fmtCurr(real)}</Stat>
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
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Variation ETP">
                {lever.fteImpact > 0 ? `+${lever.fteImpact}` : lever.fteImpact}
              </Stat>
              <Stat label="Population impactée">{lever.popImpacted}</Stat>
            </div>
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

      {tab === "audit" && (
        <Card>
          <CardBody>
            {auditForLever.length === 0 && (
              <p className="py-6 text-center text-xs text-tertiary">
                Aucune modification enregistrée
              </p>
            )}
            {auditForLever.map((a, i) => (
              <div key={i} className="border-b border-border py-2 text-xs last:border-b-0">
                <div className="text-[11px] text-tertiary">{a.ts}</div>
                <div>
                  <strong>{a.user}</strong> {a.action}{" "}
                  <span className="text-secondary">{a.field}</span>{" "}
                  <code className="rounded-sm bg-neutral-100 px-1 py-0.5 text-[11px]">
                    {String(a.old)}
                  </code>{" "}
                  →{" "}
                  <code className="rounded-sm bg-rag-green-light px-1 py-0.5 text-[11px] text-rag-green-dark">
                    {String(a.new)}
                  </code>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
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
