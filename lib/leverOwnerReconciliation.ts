/**
 * Réconciliation "propriétaire de levier" — round "ownership réel" (voir doc-comment
 * `Lever.ownerUsername` dans `types/index.ts`). Les leviers ne doivent plus être rattachés à un
 * propriétaire par simple texte libre : ce module fournit la logique PURE de rapprochement entre
 * le texte libre saisi/importé (`Lever.owner`) et les comptes `AuthUser` réels d'une entreprise,
 * utilisée par :
 *  - `components/shared/LeverOwnerReconciliationDialog.tsx` (post-import Excel, voir
 *    `components/shared/LeverImportButton.tsx`) ;
 *  - `components/shared/LeverForm.tsx` (pré-sélection de la meilleure correspondance en édition
 *    d'un levier legacy dont `ownerUsername` n'est pas encore défini).
 *
 * Volontairement synchrone/pure et sans aucun accès Firestore : l'appelant récupère la liste des
 * utilisateurs de l'entreprise cible séparément (voir `lib/firestore/admin.ts::subscribeUsers`,
 * filtré par `companyId`) et la passe en paramètre — ce qui rend `matchLeverOwner` trivialement
 * testable unitairement (voir `lib/__tests__/leverOwnerReconciliation.test.ts`).
 */

export type OwnerMatchCandidate = { username: string; name: string };

export type OwnerMatchResult =
  | { kind: "unique"; candidate: OwnerMatchCandidate }
  | { kind: "homonyms"; candidates: OwnerMatchCandidate[] }
  | { kind: "none" };

/** Normalise une chaîne pour la comparaison : trim, minuscules, accents retirés — même principe que
 *  `lib/notifications.ts::normalize`, étendu à la suppression des accents pour ne pas casser un
 *  rapprochement sur une simple variation d'accentuation ("François" vs "Francois"). */
function normalize(value: string | undefined | null): string {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * Rapproche un texte libre de propriétaire (`Lever.owner` importé ou saisi à la main) avec la liste
 * des comptes utilisateurs réels d'UNE MÊME entreprise (l'appelant est responsable du filtrage par
 * `companyId` en amont — ce module ne le refait pas).
 *
 *  - Texte vide (après normalisation) -> `"none"` : rien à rapprocher, l'appelant doit sauter ce
 *    levier (voir doc-comment `LeverOwnerReconciliationDialog`, "skip levers with empty owner
 *    text").
 *  - Exactement un compte dont le nom normalisé correspond -> `"unique"`.
 *  - Plusieurs comptes dont le nom normalisé correspond (homonymes, ex. deux "Marc Dubois") ->
 *    `"homonyms"` avec la liste complète des candidats (l'admin choisit, ou "aucun d'entre eux").
 *  - Aucun compte ne correspond -> `"none"`.
 */
export function matchLeverOwner(
  ownerText: string,
  companyUsers: OwnerMatchCandidate[]
): OwnerMatchResult {
  const normalizedOwner = normalize(ownerText);
  if (!normalizedOwner) return { kind: "none" };

  const candidates = companyUsers.filter((user) => normalize(user.name) === normalizedOwner);

  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "unique", candidate: candidates[0] };
  return { kind: "homonyms", candidates };
}
