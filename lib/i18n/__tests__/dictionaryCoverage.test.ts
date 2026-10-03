import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DICTIONARIES } from "@/lib/i18n/useTranslation";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * Couverture des dictionnaires (lot 5) : toute clé passée en LITTÉRAL à `t("…")` dans le code de
 * l'appli (app/, components/, lib/ — hors tests) doit exister dans les 4 dictionnaires. Avant ce
 * test, 34 textes (suppression de levier, formulaire levier…) n'existaient qu'en repli français
 * dans le code et s'affichaient en français quelle que soit la langue choisie.
 *
 * Les clés construites dynamiquement (`t(\`x.${code}\`)`) ne sont pas vérifiables ici : elles
 * ont leurs propres tests (ex. modèles d'anomalies d'import ↔ fr.ts).
 */

const ROOT = path.resolve(__dirname, "../../..");
const SCANNED_DIRS = ["app", "components", "lib"];
const SKIPPED_DIRS = new Set(["node_modules", "__tests__", ".next"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Clés littérales `t("a.b")` / `t('a.b')` (avec ou sans texte de repli) → fichiers d'usage. */
function usedKeys(): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  const call = /\bt\(\s*(["'])([A-Za-z0-9_.-]+)\1/g;
  for (const dir of SCANNED_DIRS) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of Array.from(src.matchAll(call))) {
        const key = m[2];
        if (!key.includes(".")) continue;
        const rel = path.relative(ROOT, file).replace(/\\/g, "/");
        keys.set(key, (keys.get(key) ?? new Set()).add(rel));
      }
    }
  }
  return keys;
}

describe("dictionnaires i18n — couverture des clés utilisées dans le code", () => {
  const used = usedKeys();

  it("l'inventaire trouve bien les appels t(…) du code", () => {
    expect(used.size).toBeGreaterThan(1000);
    expect(used.has("common.save")).toBe(true);
  });

  for (const locale of LOCALES) {
    it(`chaque clé t("…") utilisée existe dans ${locale}.ts`, () => {
      const dict = DICTIONARIES[locale];
      const missing = Array.from(used.entries())
        .filter(([key]) => !(key in dict))
        .map(([key, files]) => `${key} (${Array.from(files).join(", ")})`)
        .sort();
      expect(missing).toEqual([]);
    });
  }

  it("aucune traduction vide", () => {
    for (const locale of LOCALES) {
      const empty = Object.entries(DICTIONARIES[locale])
        .filter(([, v]) => typeof v !== "string" || v.trim() === "")
        .map(([k]) => k);
      expect(empty, locale).toEqual([]);
    }
  });
});
