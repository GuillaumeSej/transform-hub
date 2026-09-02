"use client";

import { KpiPageClient } from "./KpiPageClient";

/** Route `/kpi` — propre au Plan Stratégique (voir `lib/nav-config.ts`, item `kpi` restreint à
 *  `programTypes: ["strategic"]`). Wrapper minimal : toute la page vit dans `KpiPageClient`, qui
 *  est purement client (hooks de contexte + abonnements Firestore) et ne lit aucun
 *  `useSearchParams()` — pas de frontière `<Suspense>` nécessaire ici, contrairement à
 *  `app/(app)/dashboard/page.tsx`. */
export default function KpiPage() {
  return <KpiPageClient />;
}
