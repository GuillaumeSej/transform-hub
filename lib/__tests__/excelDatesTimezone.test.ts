import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  localDateFromExcelSerial,
  parseCellDate,
  readXlsxWorkbook,
  XLSX_READ_OPTIONS,
} from "@/lib/excelParse";
import { readSpreadsheet } from "@/lib/excelFileRead";
import { localDateOfInstant, todayISO } from "@/lib/dateUtils";

describe(`« Aujourd'hui » en date LOCALE — fuseau ${process.env.TZ ?? "(système)"}`, () => {
  // 02/10/2026 00:30 heure locale : en UTC+x c'est encore le 01/10 (l'ancien
  // `toISOString().slice(0, 10)` datait donc de la veille).
  const justAfterMidnight = new Date(2026, 9, 2, 0, 30);

  it("todayISO renvoie le jour local, pas le jour UTC", () => {
    expect(todayISO(justAfterMidnight)).toBe("2026-10-02");
  });

  it("localDateOfInstant : jour local d'un instant ISO complet, date seule inchangée", () => {
    expect(localDateOfInstant(justAfterMidnight.toISOString())).toBe("2026-10-02");
    expect(localDateOfInstant(new Date(2026, 9, 2, 23, 45).toISOString())).toBe("2026-10-02");
    expect(localDateOfInstant("2026-10-02")).toBe("2026-10-02");
  });
});

/**
 * Dates Excel lues dans le fuseau de l'utilisateur (bogue du 02/10/2026) : avec SheetJS 0.18.5 et
 * `cellDates`, une date saisie 31/03/2026 revenait en Europe/Paris à 30/03/2026 23:59:39 (heure
 * de Paris de 1899 = LMT +0:09:21, que SheetJS tronque à la minute) → importée la veille.
 *
 * Ces tests écrivent un VRAI classeur .xlsx avec de vraies cellules date (numéro de série + format
 * date, exactement ce qu'Excel enregistre), le relisent comme l'appli et vérifient le jour exact.
 * Ils doivent passer dans plusieurs fuseaux — à lancer depuis PowerShell (sous Git Bash, `TZ=…`
 * n'atteint pas Node sur ce poste) :
 *   foreach ($tz in 'UTC','Europe/Paris','America/New_York','Asia/Tokyo') {
 *     $env:TZ=$tz; npx vitest run lib/__tests__/excelDatesTimezone.test.ts }
 */

/** Décalage attendu au 01/01/2026 (minutes, convention `getTimezoneOffset`). */
const EXPECTED_OFFSET: Record<string, number> = {
  UTC: 0,
  "Europe/Paris": -60,
  "America/New_York": 300,
  "Asia/Tokyo": -540,
};

/** Numéro de série Excel exact d'une date (calcul UTC, indépendant du fuseau). */
function serial(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return (Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(1899, 11, 30)) / 86400000;
}

const CASES: { label: string; y: number; m: number; d: number; iso: string }[] = [
  {
    label: "31/03/2026 (veille du passage heure d'été + fin de mois)",
    y: 2026,
    m: 3,
    d: 31,
    iso: "2026-03-31",
  },
  { label: "01/01/2027 (changement d'année)", y: 2027, m: 1, d: 1, iso: "2027-01-01" },
  { label: "29/02/2028 (année bissextile)", y: 2028, m: 2, d: 29, iso: "2028-02-29" },
  { label: "31/12/2026 (fin d'année)", y: 2026, m: 12, d: 31, iso: "2026-12-31" },
];

/** Classeur .xlsx binaire : une colonne par format de date courant (FR personnalisé, format
 *  intégré n°14 « date courte » d'Excel, date + heure). */
function buildXlsx(): ArrayBuffer {
  const rows: unknown[][] = [["Libellé", "Date FR", "Date courte", "Date heure"]];
  for (const c of CASES) {
    rows.push([
      c.label,
      { t: "n", v: serial(c.y, c.m, c.d), z: "dd/mm/yyyy" },
      { t: "n", v: serial(c.y, c.m, c.d), z: "m/d/yy" },
      // 18:30 : une date-heure ne doit pas être arrondie au lendemain.
      { t: "n", v: serial(c.y, c.m, c.d, 18, 30), z: "dd/mm/yyyy hh:mm" },
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Dates");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function isoOf(v: unknown): string | undefined {
  const r = parseCellDate(v);
  return r?.ok ? r.value : undefined;
}

describe(`Dates Excel — fuseau ${process.env.TZ ?? "(système)"}`, () => {
  it("le fuseau demandé est bien actif dans Node", () => {
    const tz = process.env.TZ;
    const offset = new Date(2026, 0, 1).getTimezoneOffset();
    // Trace lisible dans la sortie du test (preuve du fuseau réellement utilisé).
    console.info(`TZ=${tz ?? "(non défini)"} — getTimezoneOffset(01/01/2026)=${offset}`);
    if (tz && tz in EXPECTED_OFFSET) expect(offset).toBe(EXPECTED_OFFSET[tz]);
  });

  it("les options de lecture n'utilisent plus la conversion de date de SheetJS", () => {
    expect(XLSX_READ_OPTIONS.cellDates).toBe(false);
  });

  it("vraies cellules date relues comme l'appli : jour exact, quel que soit le format", () => {
    const wb = readXlsxWorkbook(XLSX, buildXlsx());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Dates"], {
      defval: "",
    });
    expect(rows).toHaveLength(CASES.length);
    rows.forEach((row, i) => {
      const { iso } = CASES[i];
      expect(row["Date FR"]).toBeInstanceOf(Date);
      expect(isoOf(row["Date FR"])).toBe(iso);
      expect(isoOf(row["Date courte"])).toBe(iso);
      expect(isoOf(row["Date heure"])).toBe(iso);
      // Minuit LOCAL exact (plus de 23:59:39 la veille).
      const d = row["Date FR"] as Date;
      expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
      const dt = row["Date heure"] as Date;
      expect([dt.getHours(), dt.getMinutes()]).toEqual([18, 30]);
    });
  });

  it("point d'entrée réel des imports (readSpreadsheet, fichier .xlsx) : mêmes dates", async () => {
    const wb = await readSpreadsheet(buildXlsx(), "import.xlsx");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Dates"], {
      defval: "",
    });
    expect(rows.map((r) => isoOf(r["Date FR"]))).toEqual(CASES.map((c) => c.iso));
    // Texte formaté conservé (affiché tel qu'Excel le montre).
    expect(rows.map((r) => r["Libellé"])).toEqual(CASES.map((c) => c.label));
    expect(
      XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Dates"], { raw: false })[0][
        "Date FR"
      ]
    ).toBe("31/03/2026");
  });

  it("localDateFromExcelSerial : minuit local exact, heure conservée, bogue 1900 géré", () => {
    for (const c of CASES) {
      const d = localDateFromExcelSerial(serial(c.y, c.m, c.d))!;
      expect([
        d.getFullYear(),
        d.getMonth() + 1,
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
      ]).toEqual([c.y, c.m, c.d, 0, 0]);
    }
    // 23:59:59,6 arrondi à la seconde → lendemain minuit (pas de jour perdu par flottant).
    const almost = localDateFromExcelSerial(serial(2026, 3, 30) + 86399.6 / 86400)!;
    expect([almost.getDate(), almost.getHours()]).toEqual([31, 0]);
    // Série 61 = 01/03/1900 (le 29/02/1900 fictif d'Excel est la série 60).
    const mar1 = localDateFromExcelSerial(61)!;
    expect([mar1.getFullYear(), mar1.getMonth() + 1, mar1.getDate()]).toEqual([1900, 3, 1]);
    const jan1 = localDateFromExcelSerial(1)!;
    expect([jan1.getFullYear(), jan1.getMonth() + 1, jan1.getDate()]).toEqual([1900, 1, 1]);
  });

  // Preuve du bogue d'origine : la lecture SheetJS `cellDates` seule perd un jour à Paris.
  it.runIf(process.env.TZ === "Europe/Paris")(
    "témoin : SheetJS cellDates seul donne la veille en Europe/Paris",
    () => {
      const wb = XLSX.read(buildXlsx(), { type: "array", raw: true, cellDates: true });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Dates"], {
        defval: "",
      });
      expect(isoOf(rows[0]["Date FR"])).toBe("2026-03-30");
    }
  );
});
