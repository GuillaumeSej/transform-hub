import type { SocialScheme, WorkforceMovement } from "@/types";

export type SocialSchemeKey = SocialScheme | "Non renseigné";

export type ForcedDepartureStatusRow = {
  scheme: SocialSchemeKey;
  realized: number;
  planned: number;
  abandoned: number;
};

const SCHEME_ORDER: SocialSchemeKey[] = ["PSE", "RC", "RCC", "PDV", "Autre", "Non renseigné"];

/** Nombre de départs forcés prévus/réalisés/abandonnés par dispositif social. Une ligne mouvement
 * vaut une unité : le modèle garantit un mouvement par ETP. */
export function forcedDeparturesBySocialScheme(
  movements: WorkforceMovement[]
): ForcedDepartureStatusRow[] {
  const rows = new Map(
    SCHEME_ORDER.map((scheme) => [scheme, { scheme, realized: 0, planned: 0, abandoned: 0 }])
  );
  for (const movement of movements) {
    if (movement.type !== "Départ forcé") continue;
    const scheme: SocialSchemeKey =
      movement.socialScheme ?? (movement.inPSE ? "PSE" : "Non renseigné");
    const row = rows.get(scheme)!;
    if (movement.status === "Réalisé") row.realized += 1;
    else if (movement.status === "Abandonné") row.abandoned += 1;
    else row.planned += 1;
  }
  return SCHEME_ORDER.map((scheme) => rows.get(scheme)!)
    .filter((row) => row.realized + row.planned + row.abandoned > 0)
    .sort((a, b) => {
      const totalA = a.realized + a.planned + a.abandoned;
      const totalB = b.realized + b.planned + b.abandoned;
      return totalB - totalA || SCHEME_ORDER.indexOf(a.scheme) - SCHEME_ORDER.indexOf(b.scheme);
    });
}
