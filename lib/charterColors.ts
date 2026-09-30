/**
 * Palette de la charte BearingPoint en valeurs hexadécimales — miroir des tokens `--bp-*` /
 * `--n-*` de `app/globals.css` pour les contextes qui ne peuvent pas lire une variable CSS
 * (props Recharts, couleurs STOCKÉES en base, exports PPTX/Excel).
 *
 * Retour PO : "on voit encore d'anciennes couleurs (jaune, bleu…) selon la navigation — un objet
 * doit toujours avoir la même couleur". Les couleurs saisies librement par le passé (sélecteur
 * `<input type="color">` de l'admin, palette d'auto-création de l'import Excel) sont ramenées à la
 * charte À LA LECTURE via `toCharterColor` — aucune migration de données : la valeur stockée reste
 * intacte tant qu'un admin ne ré-enregistre pas l'objet.
 */

export const CHARTER_COLORS = {
  deepRed: "#320300",
  coral: "#FF3C47",
  redBrick: "#991D1F",
  coralPink: "#FF797B",
  lightPink: "#FFB1B5",
  warmBrown: "#806659",
  warmTaupe: "#A99E9A",
  warmGray: "#CCC1BD",
  purple: "#421799",
  ink: "#1A1A1A",
} as const;

export type CharterColorName = keyof typeof CHARTER_COLORS;

/** Teintes proposées pour colorer un OBJET (workstream, catégorie de graphique…). Le corail vif
 *  (`--bp-coral`) en est volontairement exclu : il reste réservé au signal "à risque" / accent. */
export const CHARTER_CATEGORICAL: readonly string[] = [
  CHARTER_COLORS.redBrick,
  CHARTER_COLORS.warmBrown,
  CHARTER_COLORS.purple,
  CHARTER_COLORS.coralPink,
  CHARTER_COLORS.warmTaupe,
  CHARTER_COLORS.deepRed,
  CHARTER_COLORS.lightPink,
  CHARTER_COLORS.warmGray,
];

/** Libellés (non traduits : ce sont les noms de la charte) des teintes de `CHARTER_CATEGORICAL`,
 *  pour l'infobulle / l'aria-label des sélecteurs de couleur admin. */
export const CHARTER_COLOR_LABEL: Record<string, string> = {
  [CHARTER_COLORS.deepRed]: "Deep Red",
  [CHARTER_COLORS.coral]: "Coral",
  [CHARTER_COLORS.redBrick]: "Red Brick",
  [CHARTER_COLORS.coralPink]: "Coral Pink",
  [CHARTER_COLORS.lightPink]: "Light Pink",
  [CHARTER_COLORS.warmBrown]: "Warm Brown",
  [CHARTER_COLORS.warmTaupe]: "Warm Taupe",
  [CHARTER_COLORS.warmGray]: "Warm Gray",
  [CHARTER_COLORS.purple]: "Purple",
  [CHARTER_COLORS.ink]: "Ink",
};

const CHARTER_SET = new Set<string>(Object.values(CHARTER_COLORS));

function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHsl([r, g, b]: [number, number, number]): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Ramène n'importe quelle couleur à une teinte de la charte, de façon DÉTERMINISTE (même entrée →
 * même sortie, donc un objet garde la même couleur sur tous les écrans) :
 *  - une couleur déjà dans la charte (casse indifférente) est renvoyée telle quelle, normalisée en
 *    majuscules ; une référence `var(--…)` passe sans modification ;
 *  - sinon, classement par famille de teinte : rouges → rouge brique / rose corail / rose clair
 *    selon la luminosité, bleus / violets / cyans → violet charte, roses-magentas → rose corail,
 *    gris / verts / jaunes / oranges → brun, taupe ou gris chaud selon la luminosité ;
 *  - valeur absente ou illisible → `fallback` (taupe chaud par défaut).
 */
export function toCharterColor(
  color: string | null | undefined,
  fallback: string = CHARTER_COLORS.warmTaupe
): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  if (/^var\(--/.test(trimmed)) return trimmed;
  const rgb = parseHex(trimmed);
  if (!rgb) return fallback;
  const canonical =
    "#" +
    rgb
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  if (CHARTER_SET.has(canonical)) return canonical;

  const { h, s, l } = toHsl(rgb);
  const neutralByLightness = () =>
    l < 0.5
      ? CHARTER_COLORS.warmBrown
      : l < 0.75
        ? CHARTER_COLORS.warmTaupe
        : CHARTER_COLORS.warmGray;

  if (s < 0.15) return neutralByLightness();
  // Rouges (autour de 0°).
  if (h >= 345 || h < 15) {
    if (l < 0.2) return CHARTER_COLORS.deepRed;
    if (l < 0.45) return CHARTER_COLORS.redBrick;
    if (l < 0.8) return CHARTER_COLORS.coralPink;
    return CHARTER_COLORS.lightPink;
  }
  // Roses / magentas.
  if (h >= 290) return l >= 0.8 ? CHARTER_COLORS.lightPink : CHARTER_COLORS.coralPink;
  // Cyans, bleus, indigos, violets.
  if (h >= 170) return CHARTER_COLORS.purple;
  // Oranges, jaunes, verts : famille chaude neutre de la charte.
  return neutralByLightness();
}
