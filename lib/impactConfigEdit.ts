import type { ImpactNatureDef } from "@/types";

/** Helpers purs d'édition des types de levier / natures d'impact (admin). */

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Ajoute un type (trim, dédoublonnage insensible à la casse) ; renvoie la liste inchangée sinon. */
export function addLeverType(list: string[], label: string): string[] {
  const v = label.trim();
  if (!v || list.some((x) => x.toLowerCase() === v.toLowerCase())) return list;
  return [...list, v];
}

export function renameLeverType(list: string[], index: number, label: string): string[] {
  const v = label.trim();
  if (!v || index < 0 || index >= list.length) return list;
  if (list.some((x, i) => i !== index && x.toLowerCase() === v.toLowerCase())) return list;
  return list.map((x, i) => (i === index ? v : x));
}

/** Nombre de leviers utilisant chaque type (clé = libellé exact). */
export function countLeversByType(levers: { type?: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of levers) if (l.type) out[l.type] = (out[l.type] ?? 0) + 1;
  return out;
}

/** Nombre de leviers dont au moins un impact référence la nature (`impact.natureId`). */
export function countLeversByNature(
  levers: { impacts?: { natureId?: string }[] }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of levers) {
    const ids = new Set((l.impacts ?? []).map((i) => i.natureId).filter(Boolean) as string[]);
    ids.forEach((id) => (out[id] = (out[id] ?? 0) + 1));
  }
  return out;
}

/** Id stable pour une nouvelle nature (slug du libellé + suffixe aléatoire, jamais recalculé). */
export function newNatureId(
  label: string,
  existing: ImpactNatureDef[],
  rand = Math.random
): string {
  const slug =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "nature";
  let id: string;
  do {
    id = `nat-${slug}-${Math.floor(rand() * 36 ** 4)
      .toString(36)
      .padStart(4, "0")}`;
  } while (existing.some((n) => n.id === id));
  return id;
}

export function addNature(
  list: ImpactNatureDef[],
  label: string,
  appliesTo: ImpactNatureDef["appliesTo"],
  rand?: () => number
): ImpactNatureDef[] {
  const v = label.trim();
  if (!v || list.some((n) => n.label.toLowerCase() === v.toLowerCase())) return list;
  return [...list, { id: newNatureId(v, list, rand), label: v, appliesTo }];
}

/** Renomme / change la portée sans jamais toucher à l'id. */
export function updateNature(
  list: ImpactNatureDef[],
  id: string,
  patch: Partial<Pick<ImpactNatureDef, "label" | "appliesTo">>
): ImpactNatureDef[] {
  return list.map((n) => {
    if (n.id !== id) return n;
    const label = patch.label !== undefined ? patch.label : n.label;
    return { ...n, ...patch, label };
  });
}

/** Retire les entrées au libellé vide avant sauvegarde. */
export function cleanNatures(list: ImpactNatureDef[]): ImpactNatureDef[] {
  return list.filter((n) => n.label.trim()).map((n) => ({ ...n, label: n.label.trim() }));
}
