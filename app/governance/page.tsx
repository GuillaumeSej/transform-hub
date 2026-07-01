"use client";

import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useToast } from "@/lib/hooks/useToast";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { AlertItem } from "@/components/shared/AlertItem";
import { Button } from "@/components/shared/Button";

export default function GovernancePage() {
  const data = useBeTrackData();
  const { showToast } = useToast();

  return (
    <div className="animate-fade-up space-y-4">
      <h1 className="relative w-fit pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
        Risks & Alerts
      </h1>

      <Card>
        <CardHeader title={`Alertes actives (${data.alerts.length})`} />
        <CardBody>
          {data.alerts.length === 0 && (
            <p className="py-6 text-center text-sm text-tertiary">Aucune alerte active ✓</p>
          )}
          {data.alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-3">
              <div className="flex-1">
                <AlertItem alert={a} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  data.resolveAlert(a.id);
                  showToast("Alerte résolue", a.title, "success");
                }}
              >
                Résoudre
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Journal d'audit" />
        <CardBody flush>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["Date", "Utilisateur", "Action", "Entité", "Champ", "Avant", "Après"].map(
                    (h) => (
                      <th
                        key={h}
                        className="sticky top-0 border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-secondary"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 text-tertiary">{a.ts}</td>
                    <td className="px-3 py-2 font-semibold">{a.user}</td>
                    <td className="px-3 py-2 capitalize">{a.action}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{a.entity}</td>
                    <td className="px-3 py-2 text-secondary">{a.field}</td>
                    <td className="px-3 py-2">
                      <code className="rounded-sm bg-neutral-100 px-1 py-0.5 text-[11px]">
                        {String(a.old)}
                      </code>
                    </td>
                    <td className="px-3 py-2">
                      <code className="rounded-sm bg-rag-green-light px-1 py-0.5 text-[11px] text-rag-green-dark">
                        {String(a.new)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
