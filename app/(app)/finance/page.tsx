"use client";

import { useEffect, useState } from "react";
import { LineChart } from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { subscribeCompanies, saveCompany } from "@/lib/firestore/admin";
import type { Company } from "@/types";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";

/**
 * Module Finance — encore un STRETCH (baseline P&L éditable, reforecast, waterfall à venir), mais
 * porte déjà le budget CAPEX de référence du programme : c'est le champ que le dashboard exécutif
 * compare au CAPEX engagé ("X€M engagés / Y€M budgétés"). Tant que ce module n'est pas complet,
 * c'est aussi modifiable depuis Admin > Entreprises.
 */
export default function FinancePage() {
  const { user } = useRole();
  const { showToast } = useToast();
  const [company, setCompany] = useState<Company | null>(null);
  const [capexBudget, setCapexBudget] = useState("");

  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const c = companies.find((c) => c.id === user?.companyId) ?? null;
      setCompany(c);
      setCapexBudget(c?.capexBudget != null ? String(c.capexBudget) : "");
    });
    return unsub;
  }, [user?.companyId]);

  const save = async () => {
    if (!company) return;
    const value = capexBudget.trim() === "" ? undefined : Number(capexBudget);
    await saveCompany({ ...company, capexBudget: value });
    showToast("Budget CAPEX enregistré", "", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LineChart size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">Finance Module</h1>
      </div>

      <Card>
        <CardHeader title="Budget CAPEX de référence" />
        <CardBody>
          <p className="mb-3 text-sm text-text-secondary">
            Le dashboard exécutif affiche le CAPEX engagé rapporté à ce budget total, si déjà cadré
            en amont de la mission (souvent le cas). Non renseigné = le dashboard affiche uniquement
            le montant engagé.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Budget CAPEX total (€M)
              </label>
              <input
                type="number"
                value={capexBudget}
                onChange={(e) => setCapexBudget(e.target.value)}
                placeholder="Non renseigné"
                className="mt-1 w-48 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              />
            </div>
            <Button variant="primary" onClick={save} disabled={!company}>
              Enregistrer
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="À venir" />
        <CardBody>
          <p className="text-sm text-text-secondary">
            Baseline P&amp;L éditable, hypothèses de reforecast, waterfall et historique
            d&apos;audit — prochaine passe de développement.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
