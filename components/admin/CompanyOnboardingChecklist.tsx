"use client";

import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import type { CompanyOnboardingStep, CompanyOnboardingStepId } from "@/lib/companyOnboarding";
import { useTranslation } from "@/lib/i18n/useTranslation";

type StepCopy = { label: string; done: string; todo: string; action: string };

function stepCopy(
  t: (key: string, fallback?: string) => string
): Record<CompanyOnboardingStepId, StepCopy> {
  return {
    company: {
      label: t("admin.onboarding.company.label", "Espace entreprise"),
      done: t("admin.onboarding.company.done", "Créé"),
      todo: t("admin.onboarding.company.todo", "À créer"),
      action: t("admin.onboarding.company.action", "Paramètres"),
    },
    companyAdmin: {
      label: t("admin.onboarding.companyAdmin.label", "Admin entreprise"),
      done: t("admin.onboarding.companyAdmin.done", "{n} compte(s) admin"),
      todo: t("admin.onboarding.companyAdmin.todo", "Aucun accès client créé"),
      action: t("admin.onboarding.companyAdmin.action", "Créer l'accès"),
    },
    settings: {
      label: t("admin.onboarding.settings.label", "Paramétrage initial"),
      done: t("admin.onboarding.settings.done", "{n} programme(s) configuré(s)"),
      todo: t("admin.onboarding.settings.todo", "Aucun programme configuré"),
      action: t("admin.onboarding.settings.action", "Programmes"),
    },
    confidentiality: {
      label: t("admin.onboarding.confidentiality.label", "Niveaux de confidentialité"),
      done: t("admin.onboarding.confidentiality.done", "{n} niveau(x) défini(s)"),
      todo: t("admin.onboarding.confidentiality.todo", "Échelle non définie"),
      action: t("admin.onboarding.confidentiality.action", "Définir l'échelle"),
    },
    strategicPlan: {
      label: t("admin.onboarding.strategicPlan.label", "Plan stratégique"),
      done: t("admin.onboarding.strategicPlan.done", "{n} axe(s) importé(s)"),
      todo: t("admin.onboarding.strategicPlan.todo", "Aucun axe importé"),
      action: t("admin.onboarding.strategicPlan.action", "Importer (Excel)"),
    },
  };
}

/**
 * Checklist compacte « Mise en place » en tête du hub entreprise (admin global) : les 5 étapes du
 * démarrage d'un client, chacune avec un statut CALCULÉ (voir lib/companyOnboarding.ts) et un
 * bouton qui amène à la section concernée (`onGoTo`, résolu par CompanyDetailClient).
 */
export function CompanyOnboardingChecklist({
  steps,
  onGoTo,
}: {
  steps: CompanyOnboardingStep[];
  onGoTo: (id: CompanyOnboardingStepId) => void;
}) {
  const { t } = useTranslation();
  const copy = stepCopy(t);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <section
      aria-labelledby="company-onboarding-title"
      className="rounded-xl border border-border bg-bg-elevated p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="company-onboarding-title" className="text-sm font-semibold text-text-primary">
          {t("admin.onboarding.title", "Mise en place")}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            allDone ? "bg-rag-green-light text-rag-green-dark" : "bg-bg-surface text-text-secondary"
          }`}
        >
          {t("admin.onboarding.progress", "{done}/{total} étapes")
            .replace("{done}", String(doneCount))
            .replace("{total}", String(steps.length))}
        </span>
      </div>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, idx) => {
          const c = copy[step.id];
          const status = (step.done ? c.done : c.todo).replace("{n}", String(step.count));
          return (
            <li
              key={step.id}
              className={`flex min-w-0 flex-col gap-1 rounded-lg border p-2 ${
                step.done ? "border-border bg-bg-surface" : "border-bp-coral/40 bg-bp-coral/5"
              }`}
            >
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-primary">
                {step.done ? (
                  <CheckCircle2
                    size={14}
                    className="shrink-0 text-rag-green"
                    aria-label={t("admin.onboarding.statusDone", "Fait")}
                  />
                ) : (
                  <Circle
                    size={14}
                    className="shrink-0 text-bp-coral"
                    aria-label={t("admin.onboarding.statusTodo", "À faire")}
                  />
                )}
                <span className="truncate">
                  {idx + 1}. {c.label}
                </span>
              </div>
              <p className="truncate text-xs text-text-secondary" title={status}>
                {status}
              </p>
              <button
                type="button"
                onClick={() => onGoTo(step.id)}
                className="mt-auto inline-flex min-h-8 items-center gap-0.5 self-start text-xs font-medium text-bp-coral hover:underline"
              >
                {c.action} <ChevronRight size={12} />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
