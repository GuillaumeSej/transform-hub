"use client";

import { Suspense } from "react";
import { KpiPageClient } from "./KpiPageClient";

/** Route `/kpi` — propre au Plan Stratégique (voir `lib/nav-config.ts`, item `kpi` restreint à
 *  `programTypes: ["strategic"]`). Wrapper minimal : toute la page vit dans `KpiPageClient`, qui
 *  est purement client (hooks de contexte + abonnements Firestore).
 *
 *  Suspense : round 10, `KpiPageClient` lit `useSearchParams()` (le `?indicator=` du contrat de
 *  navigation KPI — voir `lib/axisLogic.ts`, `numberIndicators`), ce que Next.js exige d'envelopper
 *  en prerender — même pattern que `app/(app)/dashboard/page.tsx`. */
export default function KpiPage() {
  return (
    <Suspense fallback={null}>
      <KpiPageClient />
    </Suspense>
  );
}
