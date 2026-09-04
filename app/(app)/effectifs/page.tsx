"use client";

import { EffectifsPageClient } from "./EffectifsPageClient";

/** Route `/effectifs` — propre au Plan Stratégique (voir `lib/nav-config.ts`, item `effectifs`
 *  restreint à `programTypes: ["strategic"]`). Sans rapport avec les écrans RH du Plan
 *  Performance (`/hr`, `/hr/etp`), qui portent les effectifs réels de l'entreprise : ici on ne
 *  mesure que la MOBILISATION en ETP des grandes fonctions sur les chantiers du programme.
 *
 *  Wrapper minimal, comme `app/(app)/kpi/page.tsx` : toute la page vit dans le composant client,
 *  qui ne lit aucun `useSearchParams()` — pas de frontière `<Suspense>` nécessaire ici. */
export default function EffectifsPage() {
  return <EffectifsPageClient />;
}
