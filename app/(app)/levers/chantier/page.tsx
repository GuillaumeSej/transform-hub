import { Suspense } from "react";
import { ChantierDetailClient } from "./ChantierDetailClient";

// Route statique (pas de segment dynamique [id]) : l'id du chantier est lu depuis le query string
// (?id=...) côté client — même contrainte export statique (GitHub Pages) que `/levers/detail`, voir
// ce fichier pour le détail du raisonnement. Suspense est requis par Next.js autour de
// useSearchParams() en prerender.
export default function ChantierDetailPage() {
  return (
    <Suspense fallback={null}>
      <ChantierDetailClient />
    </Suspense>
  );
}
