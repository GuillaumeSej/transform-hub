import { Suspense } from "react";
import LeverDetailClient from "./LeverDetailClient";

// Route statique (pas de segment dynamique [id]) : l'id du levier est lu depuis le query string
// (?id=...) côté client. Nécessaire pour l'export statique (GitHub Pages) — un segment [id] avec
// generateStaticParams() ne peut pas résoudre les leviers créés/modifiés en session, seulement
// ceux connus au build. Suspense est requis par Next.js autour de useSearchParams() en prerender.
export default function LeverDetailPage() {
  return (
    <Suspense fallback={null}>
      <LeverDetailClient />
    </Suspense>
  );
}
