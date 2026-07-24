import { Suspense } from "react";
import CompanyDetailClient from "./CompanyDetailClient";

// Route statique (pas de segment dynamique [id]) : l'id de l'entreprise est lu depuis le query
// string (?id=...) côté client — même contrainte et même solution que /levers/detail (voir ce
// fichier) : un segment [id] avec generateStaticParams() ne peut pas résoudre les entreprises
// créées en session avec l'export statique (GitHub Pages). Suspense est requis par Next.js autour
// de useSearchParams() en prerender.
export default function AdminCompanyDetailPage() {
  return (
    <Suspense fallback={null}>
      <CompanyDetailClient />
    </Suspense>
  );
}
