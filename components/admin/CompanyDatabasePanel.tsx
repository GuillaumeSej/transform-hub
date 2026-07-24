"use client";

import { useState } from "react";
import { Database, AlertTriangle, Trash2, RotateCcw } from "lucide-react";
import type { Company } from "@/types";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { planCompanyReset, resetCompanyData } from "@/lib/firestore/companyReset";
import type { CompanyResetPlan } from "@/lib/companyResetLogic";

/**
 * Onglet "Base de données" du hub `/admin/companies/detail` (global admin uniquement) : permet un
 * reset SCOPÉ à cette seule entreprise (leviers, sous-leviers, nœuds de hiérarchie, et les
 * entrées de commentaires/audit qui leur sont rattachées), avec confirmation obligatoire listant
 * précisément ce qui va être supprimé. Garde aussi une "zone de danger" globale (reset TOUTES les
 * entreprises vers le jeu de données de démo — même action que le bouton du Topbar, désormais
 * réservé à l'admin global, voir components/shared/ResetDemoButton.tsx).
 *
 * Limite connue (voir lib/companyResetLogic.ts) : les documents `comments`/`audit` sont des DOCS
 * UNIQUES PARTAGÉS entre toutes les entreprises (pas de collection par entreprise). On ne peut les
 * scoper qu'en retirant les entrées liées aux ids de leviers/sous-leviers de cette entreprise —
 * les entrées non attribuables à un lever/subLever connu (mouvements RH, employés — pas encore
 * multi-tenant) restent dans le document partagé, quelle que soit l'entreprise qui déclenche le
 * reset.
 */
export function CompanyDatabasePanel({ company }: { company: Company }) {
  const { showToast } = useToast();
  // Instance dédiée du hook de données globales, uniquement pour exposer resetToMockData() ici —
  // même mécanisme que AppShell (voir components/shared/AppShell.tsx::onReset).
  const globalData = useBeTrackData(null);

  const [scopedOpen, setScopedOpen] = useState(false);
  const [scopedPlan, setScopedPlan] = useState<CompanyResetPlan | null>(null);
  const [scopedLoading, setScopedLoading] = useState(false);
  const [scopedBusy, setScopedBusy] = useState(false);

  const [globalOpen, setGlobalOpen] = useState(false);

  const openScopedModal = async () => {
    setScopedOpen(true);
    setScopedLoading(true);
    try {
      const plan = await planCompanyReset(company.id);
      setScopedPlan(plan);
    } catch (err) {
      console.error("[betrack] échec du calcul du plan de reset :", err);
      showToast("Erreur", "Impossible de calculer l'impact du reset.", "error");
      setScopedOpen(false);
    } finally {
      setScopedLoading(false);
    }
  };

  const confirmScopedReset = async () => {
    setScopedBusy(true);
    try {
      await resetCompanyData(company.id);
      showToast(
        "Données réinitialisées",
        `Les leviers, sous-leviers et hiérarchie de ${company.name} ont été supprimés.`,
        "success"
      );
      setScopedOpen(false);
      setScopedPlan(null);
    } catch (err) {
      console.error("[betrack] échec du reset scopé entreprise :", err);
      showToast("Erreur", "Le reset a échoué, voir la console pour le détail.", "error");
    } finally {
      setScopedBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database size={20} className="text-bp-coral" />
        <h2 className="text-sm font-bold text-text-primary">Base de données — {company.name}</h2>
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Réinitialiser cette entreprise
        </h3>
        <p className="max-w-2xl text-sm text-text-secondary">
          Supprime les leviers, sous-leviers et la hiérarchie financière de{" "}
          <strong>{company.name}</strong> uniquement — les autres entreprises ne sont pas affectées.
          Action irréversible.
        </p>
        <Button variant="danger" size="sm" onClick={openScopedModal}>
          <Trash2 size={14} /> Réinitialiser {company.name}
        </Button>
      </div>

      <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 space-y-3">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle size={16} />
          <h3 className="text-xs font-semibold uppercase tracking-wide">
            Zone de danger — toutes les entreprises
          </h3>
        </div>
        <p className="max-w-2xl text-sm text-text-secondary">
          Réinitialise l&apos;intégralité des données de démonstration (leviers, sous-leviers,
          commentaires, audit, effectifs) pour <strong>toutes les entreprises</strong>, sans
          distinction. À réserver aux environnements de démo/test.
        </p>
        <Button variant="danger" size="sm" onClick={() => setGlobalOpen(true)}>
          <RotateCcw size={14} /> Réinitialiser toutes les données de démo
        </Button>
      </div>

      {/* Modale de confirmation — reset scopé entreprise */}
      <Modal
        open={scopedOpen}
        onOpenChange={(open) => {
          setScopedOpen(open);
          if (!open) setScopedPlan(null);
        }}
        title={`Réinitialiser ${company.name} ?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setScopedOpen(false)} disabled={scopedBusy}>
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={confirmScopedReset}
              disabled={scopedLoading || scopedBusy || !scopedPlan}
            >
              {scopedBusy ? "Suppression…" : "Confirmer la suppression"}
            </Button>
          </>
        }
      >
        {scopedLoading || !scopedPlan ? (
          <p className="text-sm text-text-secondary">Calcul de l&apos;impact en cours…</p>
        ) : (
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              Cette action est <strong>irréversible</strong> et supprimera, pour{" "}
              <strong>{company.name}</strong> uniquement :
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{scopedPlan.leverIds.length} levier(s)</li>
              <li>{scopedPlan.subLeverIds.length} sous-levier(s)</li>
              <li>
                {scopedPlan.removedCommentKeys.length} fil(s) de commentaires liés à ces leviers
              </li>
              <li>
                {scopedPlan.removedAuditCount} entrée(s) d&apos;historique liées à ces leviers
              </li>
              <li>tous les nœuds de hiérarchie financière de cette entreprise</li>
            </ul>
            <p>
              Les données des autres entreprises, ainsi que les entrées d&apos;audit/commentaires
              non rattachées à un levier de {company.name}, ne sont pas affectées.
            </p>
          </div>
        )}
      </Modal>

      {/* Modale de confirmation — reset global toutes entreprises */}
      <Modal
        open={globalOpen}
        onOpenChange={setGlobalOpen}
        title="Réinitialiser toutes les données de démo ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGlobalOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                globalData.resetToMockData();
                setGlobalOpen(false);
                showToast(
                  "Données réinitialisées",
                  "Toutes les entreprises sont revenues au jeu de données de démo initial.",
                  "success"
                );
                window.location.reload();
              }}
            >
              Réinitialiser tout
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Toutes les modifications effectuées dans cette session, pour{" "}
          <strong>toutes les entreprises</strong> (leviers, sous-leviers, commentaires, audit,
          effectifs), seront définitivement perdues et remplacées par le jeu de données de démo
          initial.
        </p>
      </Modal>
    </div>
  );
}
