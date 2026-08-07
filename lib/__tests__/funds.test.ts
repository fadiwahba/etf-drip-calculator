import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseFunds,
  loadFunds,
  getFund,
  isProjectable,
  requirePriceGrowth,
  FundDataError,
  MissingAssumptionError,
  FUND_DATA_AS_OF,
} from "@/lib/funds";

// Fixture helpers for the malformed-shape / null-handling ACs (8, 9, 10, 12, 13, 14, 15). This is
// a synthetic row, not one of the six real funds — it exists so each AC can mutate exactly one
// field without disturbing the others.
type RawRow = Record<string, unknown>;

const baseRow: RawRow = {
  ticker: "TEST",
  name: "Test Fund",
  domicile: "US",
  currency: "USD",
  asOf: "2026-06-30",
  source: "https://example.com/test",
  expenseRatio: 0.001,
  totalReturnAnnualised: 0.1,
  totalReturnWindowYears: 10,
  dividendYield: 0.02,
  dividendGrowth: null,
  notes: null,
};

function row(overrides: RawRow): RawRow {
  return { ...baseRow, ...overrides };
}

function omit(obj: RawRow, key: string): RawRow {
  const clone = { ...obj };
  delete clone[key];
  return clone;
}

function captureError(fn: () => void): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected function to throw");
}

describe("funds", () => {
  it("AC1 — six rows, exact tickers; getFund resolves; unknown ticker throws", () => {
    const funds = loadFunds();
    expect(funds).toHaveLength(6);
    expect(funds.map((f) => f.ticker).sort()).toEqual(
      ["DGRO", "EUFN", "FDVV", "SCHD", "VIG", "VYMI"].sort()
    );
    expect(getFund("SCHD").ticker).toBe("SCHD");
    expect(() => getFund("VOO")).toThrow(FundDataError);
    for (const f of funds) {
      expect(typeof f.name).toBe("string");
      expect(f.name.length).toBeGreaterThan(0);
    }
  });

  it("AC2 — stored inputs match the FINAL section", () => {
    const schd = getFund("SCHD");
    expect(schd.totalReturnAnnualised).toBeCloseTo(0.1237, 6);
    expect(schd.dividendYield).toBeCloseTo(0.0325, 6);
    expect(schd.expenseRatio).toBeCloseTo(0.0006, 6);

    const dgro = getFund("DGRO");
    expect(dgro.totalReturnAnnualised).toBeCloseTo(0.1338, 6);
    expect(dgro.dividendYield).toBeCloseTo(0.0198, 6);
    expect(dgro.expenseRatio).toBeCloseTo(0.0008, 6);

    const vig = getFund("VIG");
    expect(vig.totalReturnAnnualised).toBeCloseTo(0.1299, 6);
    expect(vig.dividendYield).toBeCloseTo(0.0144, 6);
    expect(vig.expenseRatio).toBeCloseTo(0.0004, 6);

    const eufn = getFund("EUFN");
    expect(eufn.totalReturnAnnualised).toBeCloseTo(0.1436, 6);
    expect(eufn.dividendYield).toBeCloseTo(0.0305, 6);
    expect(eufn.expenseRatio).toBeCloseTo(0.0049, 6);

    const vymi = getFund("VYMI");
    expect(vymi.totalReturnAnnualised).toBeCloseTo(0.1098, 6);
    expect(vymi.dividendYield).toBeNull();
    expect(vymi.expenseRatio).toBeCloseTo(0.0007, 6);

    const fdvv = getFund("FDVV");
    expect(fdvv.totalReturnAnnualised).toBeNull();
    expect(fdvv.dividendYield).toBeCloseTo(0.0259, 6);
    expect(fdvv.expenseRatio).toBeNull();
  });

  it("AC3 — sharePriceGrowth is derived, per fund", () => {
    const schd = getFund("SCHD");
    const dgro = getFund("DGRO");
    const vig = getFund("VIG");
    const eufn = getFund("EUFN");
    const vymi = getFund("VYMI");
    const fdvv = getFund("FDVV");

    expect(schd.sharePriceGrowth).toBeCloseTo(0.0912, 4);
    expect(dgro.sharePriceGrowth).toBeCloseTo(0.114, 4);
    expect(vig.sharePriceGrowth).toBeCloseTo(0.1155, 4);
    expect(eufn.sharePriceGrowth).toBeCloseTo(0.1131, 4);
    expect(vymi.sharePriceGrowth).toBeNull();
    expect(fdvv.sharePriceGrowth).toBeNull();

    for (const f of [schd, dgro, vig, eufn]) {
      expect(f.sharePriceGrowth).not.toBeNull();
      expect(f.sharePriceGrowth as number).toBeCloseTo(
        (f.totalReturnAnnualised as number) - (f.dividendYield as number),
        10
      );
    }
  });

  it("AC4 — null is unverified and is never 0", () => {
    const funds = loadFunds();
    for (const f of funds) {
      expect(f.dividendGrowth).toBeNull();
    }

    const vymi = getFund("VYMI");
    expect(Object.is(vymi.dividendYield, 0)).toBe(false);
    expect(vymi.dividendYield).not.toBe(0);
    expect(vymi.dividendYield).toBeNull();

    const fdvv = getFund("FDVV");
    expect(Object.is(fdvv.totalReturnAnnualised, 0)).toBe(false);
    expect(fdvv.totalReturnAnnualised).not.toBe(0);
    expect(fdvv.totalReturnAnnualised).toBeNull();
    expect(Object.is(fdvv.expenseRatio, 0)).toBe(false);
    expect(fdvv.expenseRatio).not.toBe(0);
    expect(fdvv.expenseRatio).toBeNull();

    for (const f of funds) {
      if (f.dividendYield !== null) expect(f.dividendYield).not.toBe(0);
      if (f.expenseRatio !== null) expect(f.expenseRatio).not.toBe(0);
      if (f.totalReturnAnnualised !== null) expect(f.totalReturnAnnualised).not.toBe(0);
    }
  });

  it("AC5 — nullability is in the type (enforced by pnpm build)", () => {
    // @ts-expect-error sharePriceGrowth is number | null — a caller must handle the null
    const g: number = getFund("SCHD").sharePriceGrowth;
    expect(typeof g === "number" || g === null).toBe(true);
  });

  it("AC6 — the two incomplete rows still load and stay selectable", () => {
    const funds = loadFunds();
    expect(funds.some((f) => f.ticker === "VYMI")).toBe(true);
    expect(funds.some((f) => f.ticker === "FDVV")).toBe(true);

    const vymi = getFund("VYMI");
    expect(vymi.asOf.length).toBeGreaterThan(0);
    expect(vymi.source.length).toBeGreaterThan(0);
    expect(vymi.name.length).toBeGreaterThan(0);
    expect(vymi.totalReturnAnnualised).not.toBeNull();
    expect(vymi.expenseRatio).not.toBeNull();

    const fdvv = getFund("FDVV");
    expect(fdvv.asOf.length).toBeGreaterThan(0);
    expect(fdvv.source.length).toBeGreaterThan(0);
    expect(fdvv.name.length).toBeGreaterThan(0);
    expect(fdvv.dividendYield).not.toBeNull();

    expect(isProjectable(getFund("SCHD"))).toBe(true);
    expect(isProjectable(getFund("DGRO"))).toBe(true);
    expect(isProjectable(getFund("VIG"))).toBe(true);
    expect(isProjectable(getFund("EUFN"))).toBe(true);
    expect(isProjectable(vymi)).toBe(false);
    expect(isProjectable(fdvv)).toBe(false);
    expect(() => isProjectable(vymi)).not.toThrow();
  });

  it("AC7 — a projection cannot run off a null growth figure", () => {
    expect(requirePriceGrowth(getFund("SCHD"))).toBeCloseTo(0.0912, 4);

    const vymiErr = captureError(() => requirePriceGrowth(getFund("VYMI")));
    expect(vymiErr).toBeInstanceOf(MissingAssumptionError);
    expect(vymiErr.message).toContain("VYMI");
    expect(vymiErr.message).toContain("sharePriceGrowth");
    expect(vymiErr).not.toBeInstanceOf(FundDataError);

    const fdvvErr = captureError(() => requirePriceGrowth(getFund("FDVV")));
    expect(fdvvErr).toBeInstanceOf(MissingAssumptionError);
    expect(fdvvErr.message).toContain("FDVV");
    expect(fdvvErr.message).toContain("sharePriceGrowth");

    for (const f of loadFunds().filter(isProjectable)) {
      const g = requirePriceGrowth(f);
      expect(typeof g).toBe("number");
      expect(Number.isFinite(g)).toBe(true);
    }
  });

  it("AC8 — a null figure must be explained", () => {
    const vymi = getFund("VYMI");
    const fdvv = getFund("FDVV");
    expect(typeof vymi.notes).toBe("string");
    expect((vymi.notes as string).length).toBeGreaterThan(0);
    expect(typeof fdvv.notes).toBe("string");
    expect((fdvv.notes as string).length).toBeGreaterThan(0);

    expect(() =>
      parseFunds([
        row({
          ticker: "X1",
          totalReturnAnnualised: null,
          totalReturnWindowYears: null,
          notes: null,
        }),
      ])
    ).toThrow(FundDataError);

    expect(() => parseFunds([row({ ticker: "X2", dividendYield: null, notes: "" })])).toThrow(
      FundDataError
    );

    expect(() => parseFunds([row({ ticker: "X3", expenseRatio: null, notes: null })])).toThrow(
      FundDataError
    );

    // dividendGrowth is exempt — null with no notes must NOT throw.
    expect(() =>
      parseFunds([row({ ticker: "X4", dividendGrowth: null, notes: null })])
    ).not.toThrow();
  });

  it("AC9 — explicit null only; an absent key is an error", () => {
    const nullableFields = [
      "expenseRatio",
      "totalReturnAnnualised",
      "totalReturnWindowYears",
      "dividendYield",
      "dividendGrowth",
      "notes",
    ];
    for (const field of nullableFields) {
      const okOverrides: RawRow = { ticker: `OK_${field}`, [field]: null };
      if (field === "totalReturnAnnualised" || field === "totalReturnWindowYears") {
        okOverrides.totalReturnAnnualised = null;
        okOverrides.totalReturnWindowYears = null;
      }
      if (field !== "notes" && field !== "dividendGrowth") {
        okOverrides.notes = "explicit null test";
      }
      expect(() => parseFunds([row(okOverrides)])).not.toThrow();

      const absentRow = omit(row({ ticker: `ABSENT_${field}` }), field);
      expect(() => parseFunds([absentRow])).toThrow(FundDataError);

      expect(() =>
        parseFunds([row({ ticker: `UNDEF_${field}`, [field]: undefined })])
      ).toThrow(FundDataError);
    }
  });

  it("AC10 — the window is pinned, never substituted", () => {
    expect(getFund("SCHD").totalReturnWindowYears).toBe(10);
    expect(getFund("DGRO").totalReturnWindowYears).toBe(10);
    expect(getFund("VIG").totalReturnWindowYears).toBe(10);
    expect(getFund("EUFN").totalReturnWindowYears).toBe(10);
    expect(getFund("VYMI").totalReturnWindowYears).toBe(10);
    expect(getFund("FDVV").totalReturnWindowYears).toBeNull();

    expect(() => parseFunds([row({ ticker: "W1", totalReturnWindowYears: 9.8 })])).toThrow(
      FundDataError
    );

    expect(() =>
      parseFunds([
        row({
          ticker: "W2",
          totalReturnAnnualised: null,
          totalReturnWindowYears: 10,
          notes: "x",
        }),
      ])
    ).toThrow(FundDataError);

    expect(() => parseFunds([row({ ticker: "W3", totalReturnWindowYears: null })])).toThrow(
      FundDataError
    );
  });

  it("AC11 — provenance is required on every row, including the null ones", () => {
    const funds = loadFunds();
    for (const f of funds) {
      expect(f.source.startsWith("https://")).toBe(true);
      expect(f.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.domicile).toBe("US");
      expect(f.currency).toBe("USD");
    }
    expect(getFund("SCHD").asOf).toBe("2026-06-30");
    expect(getFund("DGRO").asOf).toBe("2026-06-30");
    expect(getFund("EUFN").asOf).toBe("2026-06-30");
    expect(getFund("FDVV").asOf).toBe("2026-06-30");
    expect(getFund("VIG").asOf).toBe("2026-07-31");
    expect(getFund("VYMI").asOf).toBe("2026-07-31");

    expect(FUND_DATA_AS_OF).toBe("2026-06-30");
    const minAsOf = funds.reduce((min, f) => (f.asOf < min ? f.asOf : min), funds[0].asOf);
    expect(FUND_DATA_AS_OF).toBe(minAsOf);
  });

  it("AC12 — sharePriceGrowth is derived, not stored", () => {
    const rawJson = JSON.parse(
      readFileSync(join(process.cwd(), "data/funds.json"), "utf-8")
    ) as RawRow[];
    for (const entry of rawJson) {
      expect(entry).not.toHaveProperty("sharePriceGrowth");
      expect(entry).not.toHaveProperty("priceGrowth");
    }

    const withNullYield = parseFunds([row({ ticker: "D1", dividendYield: null, notes: "x" })]);
    expect(withNullYield[0].sharePriceGrowth).toBeNull();

    const withNullReturn = parseFunds([
      row({
        ticker: "D2",
        totalReturnAnnualised: null,
        totalReturnWindowYears: null,
        notes: "x",
      }),
    ]);
    expect(withNullReturn[0].sharePriceGrowth).toBeNull();
  });

  it("AC13 — malformed shapes fail loudly, nothing is coerced", () => {
    expect(() => parseFunds({})).toThrow(FundDataError);
    expect(() => parseFunds(null)).toThrow(FundDataError);
    expect(() => parseFunds([42])).toThrow(FundDataError);
    expect(() => parseFunds(["not an object"])).toThrow(FundDataError);

    expect(() => parseFunds([omit(row({}), "ticker")])).toThrow(FundDataError);
    expect(() => parseFunds([row({ ticker: "" })])).toThrow(FundDataError);
    expect(() => parseFunds([omit(row({}), "name")])).toThrow(FundDataError);
    expect(() => parseFunds([row({ name: "" })])).toThrow(FundDataError);
    expect(() => parseFunds([omit(row({}), "asOf")])).toThrow(FundDataError);
    expect(() => parseFunds([row({ asOf: "" })])).toThrow(FundDataError);
    expect(() => parseFunds([omit(row({}), "source")])).toThrow(FundDataError);
    expect(() => parseFunds([row({ source: "" })])).toThrow(FundDataError);

    expect(() => parseFunds([row({ ticker: "DUP" }), row({ ticker: "DUP" })])).toThrow(
      FundDataError
    );

    expect(() => parseFunds([row({ domicile: "UK" })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ source: "ftp://example.com" })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ asOf: "06-30-2026" })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ expenseRatio: "0.06" })])).toThrow(FundDataError);
  });

  it("AC14 — NaN / Infinity never escape", () => {
    expect(() => parseFunds([row({ expenseRatio: NaN })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ dividendYield: Infinity })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ totalReturnAnnualised: -Infinity })])).toThrow(FundDataError);

    for (const f of loadFunds()) {
      for (const value of [
        f.expenseRatio,
        f.totalReturnAnnualised,
        f.dividendYield,
        f.sharePriceGrowth,
      ]) {
        if (value !== null) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it("AC15 — one percentage convention, enforced", () => {
    expect(() => parseFunds([row({ expenseRatio: 12.37 })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ dividendYield: 3.25 })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ totalReturnAnnualised: 13.38 })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ dividendGrowth: 2.24 })])).toThrow(FundDataError);

    expect(() => parseFunds([row({ expenseRatio: -0.001 })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ dividendYield: -0.001 })])).toThrow(FundDataError);

    expect(() => parseFunds([row({ totalReturnAnnualised: -0.15 })])).not.toThrow();
    expect(() => parseFunds([row({ totalReturnAnnualised: -1 })])).toThrow(FundDataError);
    expect(() => parseFunds([row({ totalReturnAnnualised: -1.5 })])).toThrow(FundDataError);
  });

  it("AC16 — old file gone, legacy untouched, funds.ts references neither legacy file", () => {
    expect(existsSync(join(process.cwd(), "data/dividend_portfolio.json"))).toBe(false);

    // "Reference" means imports, not prose -- lib/funds.ts is required elsewhere (Coder
    // Guardrails) to *say in a comment* that etfs.json is frozen legacy, so this checks for an
    // actual import/require path, not any mention of the filename.
    const fundsTsSource = readFileSync(join(process.cwd(), "lib/funds.ts"), "utf-8");
    expect(fundsTsSource).not.toMatch(/from\s+["'][^"']*data\/etfs(\.json)?["']/);
    expect(fundsTsSource).not.toMatch(/from\s+["'][^"']*data\/dividend_portfolio(\.json)?["']/);
    expect(fundsTsSource).not.toMatch(/require\(\s*["'][^"']*data\/etfs(\.json)?["']\s*\)/);
    expect(fundsTsSource).not.toMatch(
      /require\(\s*["'][^"']*data\/dividend_portfolio(\.json)?["']\s*\)/
    );

    const fundsJsonSource = readFileSync(join(process.cwd(), "data/funds.json"), "utf-8");
    expect(fundsJsonSource).not.toMatch(/etfs\.json/);
    expect(fundsJsonSource).not.toMatch(/dividend_portfolio\.json/);
  });
});
