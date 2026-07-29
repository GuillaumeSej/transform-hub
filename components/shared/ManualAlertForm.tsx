"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import type { AlertType, BeTrackData, ManualAlertInput } from "@/types";

const fieldClass =
  "w-full rounded-sm border border-border px-3 py-2 text-sm focus:border-black focus:outline-none";

export function ManualAlertForm({
  open,
  onOpenChange,
  data,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BeTrackData;
  onSubmit: (input: ManualAlertInput) => void;
}) {
  const scopes = [
    ...data.workstreams.map((item) => ({ id: item.id, label: `Workstream · ${item.name}` })),
    ...data.levers.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` })),
  ];
  const [type, setType] = useState<AlertType>("amber");
  const [scope, setScope] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [impact, setImpact] = useState("");
  const [suppressAutomaticAlerts, setSuppressAutomaticAlerts] = useState(false);

  const submit = () => {
    if (!scope || !title.trim() || !desc.trim()) return;
    onSubmit({
      type,
      scope,
      title: title.trim(),
      desc: desc.trim(),
      impactEur: impact ? Number(impact) : undefined,
      suppressAutomaticAlerts,
    });
    setScope("");
    setTitle("");
    setDesc("");
    setImpact("");
    setSuppressAutomaticAlerts(false);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Créer une alerte manuelle"
      maxWidth="560px"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!scope || !title.trim() || !desc.trim()}>
            Créer et notifier
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-xs font-semibold text-secondary">
          Sévérité
          <select
            className={`${fieldClass} mt-1`}
            value={type}
            onChange={(e) => setType(e.target.value as AlertType)}
          >
            <option value="red">Critique</option>
            <option value="amber">À surveiller</option>
            <option value="green">Positive</option>
            <option value="blue">Information</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-secondary">
          Périmètre
          <select
            className={`${fieldClass} mt-1`}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="">Choisir un levier ou workstream</option>
            {scopes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-secondary">
          Titre
          <input
            className={`${fieldClass} mt-1`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-xs font-semibold text-secondary">
          Description
          <textarea
            className={`${fieldClass} mt-1 min-h-24`}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </label>
        <label className="block text-xs font-semibold text-secondary">
          Impact financier en euros (optionnel)
          <input
            className={`${fieldClass} mt-1`}
            type="number"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
          />
        </label>
        <label className="flex items-start gap-2 rounded-md border border-border bg-neutral-50 p-3 text-xs text-secondary">
          <input
            type="checkbox"
            className="mt-0.5 accent-bp-coral"
            checked={suppressAutomaticAlerts}
            onChange={(e) => setSuppressAutomaticAlerts(e.target.checked)}
          />
          <span>
            <strong className="block text-primary">
              Masquer les alertes automatiques de ce périmètre
            </strong>
            Laissez décoché pour conserver les alertes automatiques existantes et futures.
          </span>
        </label>
      </div>
    </Modal>
  );
}
