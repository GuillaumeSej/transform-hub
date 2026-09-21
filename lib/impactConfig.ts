import type { Company, ImpactNatureDef } from "@/types";

/** Types de levier par défaut — utilisés quand `Company.leverTypes` n'est pas paramétré. */
export const DEFAULT_LEVER_TYPES: string[] = [
  "Automatisation",
  "Excellence opérationnelle",
  "Sourcing & Achats",
  "Digitalisation",
  "Réorganisation & Effectifs",
  "Pricing & Revenue Management",
  "Supply Chain & Logistique",
];

/** Natures de coût/gain par défaut — utilisées quand `Company.impactNatures` n'est pas paramétré. */
export const DEFAULT_IMPACT_NATURES: ImpactNatureDef[] = [
  { id: "nat-raw-materials", label: "Matières premières", appliesTo: "both" },
  { id: "nat-labor", label: "Main-d'œuvre", appliesTo: "both" },
  { id: "nat-subcontracting", label: "Sous-traitance", appliesTo: "both" },
  { id: "nat-energy", label: "Énergie", appliesTo: "both" },
  { id: "nat-it-licences", label: "IT / licences", appliesTo: "both" },
  { id: "nat-overheads", label: "Frais généraux", appliesTo: "both" },
  { id: "nat-consulting", label: "Conseil / prestations", appliesTo: "cost" },
  { id: "nat-equipment", label: "Équipements / investissements", appliesTo: "cost" },
  { id: "nat-revenue", label: "Chiffre d'affaires", appliesTo: "saving" },
  { id: "nat-working-capital", label: "Besoin en fonds de roulement", appliesTo: "saving" },
];

type CompanyConfig = Pick<Company, "leverTypes" | "impactNatures"> | null | undefined;

/** Types de levier de l'entreprise (défaut si non paramétré ou liste vide). */
export function getLeverTypes(company?: CompanyConfig): string[] {
  return company?.leverTypes && company.leverTypes.length > 0
    ? company.leverTypes
    : DEFAULT_LEVER_TYPES;
}

/** Natures d'impact de l'entreprise, filtrables par type d'impact ("cost" = OPEX/CAPEX/ETP
 *  embauche, "saving" = gains) : une nature `both` est toujours retournée. */
export function getImpactNatures(
  company?: CompanyConfig,
  kind?: "cost" | "saving"
): ImpactNatureDef[] {
  const all =
    company?.impactNatures && company.impactNatures.length > 0
      ? company.impactNatures
      : DEFAULT_IMPACT_NATURES;
  if (!kind) return all;
  return all.filter((n) => n.appliesTo === "both" || n.appliesTo === kind);
}

export function impactNatureLabel(company: CompanyConfig, natureId?: string): string {
  if (!natureId) return "";
  return getImpactNatures(company).find((n) => n.id === natureId)?.label ?? natureId;
}
