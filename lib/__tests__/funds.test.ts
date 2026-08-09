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
  DIVIDEND_BLEND_TICKERS,
  equalWeights,
  blendFunds,
  buildBlend,
  requireBlendPriceGrowth,
  type Blend,
  type BlendPolicy,
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

// Fixture E (spec § Fixtures): two synthetic funds so AC5/AC8/AC9 can exercise a per-field null
// (Q1's expenseRatio) that must null only that field, not the whole member.
function makeFixtureE(): Blend {
  const funds = parseFunds([
    row({ ticker: "P1", asOf: "2026-05-31" }), // TR 0.1, yield 0.02, ER 0.001 (base row defaults)
    row({
      ticker: "Q1",
      asOf: "2026-04-30",
      totalReturnAnnualised: 0.2,
      dividendYield: 0.04,
      expenseRatio: null,
      notes: "expense ratio not published on the primary source page (fixture)",
    }),
  ]);
  return blendFunds(funds, equalWeights(["P1", "Q1"]), "strict");
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

describe("funds — blend composition", () => {
  it("Blend AC1 — DIVIDEND_BLEND_TICKERS is the exact six, in order", () => {
    expect(DIVIDEND_BLEND_TICKERS).toEqual(["SCHD", "FDVV", "VYMI", "DGRO", "EUFN", "VIG"]);
  });

  it("Blend AC2 — strict is null, not zero (Fixture A)", () => {
    const a = buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "strict");

    expect(a.sharePriceGrowth).toBeNull();
    expect(Object.is(a.sharePriceGrowth, 0)).toBe(false);
    expect(a.dividendYield).toBeNull();
    expect(Object.is(a.dividendYield, 0)).toBe(false);
    expect(a.expenseRatio).toBeNull();
    expect(Object.is(a.expenseRatio, 0)).toBe(false);
    expect(a.totalReturnAnnualised).toBeNull();
    expect(Object.is(a.totalReturnAnnualised, 0)).toBe(false);
    expect(a.asOf).toBeNull();

    expect(a.members).toEqual([]);
    expect(a.isComplete).toBe(false);
    expect(a.sources).toHaveLength(6);
    expect(a.requested).toHaveLength(6);
    for (const r of a.requested) {
      expect(r.weight).toBeCloseTo(1 / 6, 10);
    }

    expect(a.excluded.map((e) => e.ticker)).toEqual(["FDVV", "VYMI"]);
    for (const e of a.excluded) {
      expect(e.requestedWeight).toBeCloseTo(1 / 6, 10);
      expect(e.reason).toBe(getFund(e.ticker).notes);
      expect(e.reason.length).toBeGreaterThan(0);
    }
  });

  it("Blend AC3 — strict blocks a projection, naming both unprojectable tickers", () => {
    const a = buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "strict");
    const err = captureError(() => requireBlendPriceGrowth(a));
    expect(err).toBeInstanceOf(MissingAssumptionError);
    expect(err).not.toBeInstanceOf(FundDataError);
    expect(err.message).toContain("FDVV");
    expect(err.message).toContain("VYMI");
  });

  it("Blend AC4 — exclude renormalises (Fixture B)", () => {
    const b = buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "excludeUnprojectable");

    expect(b.members.map((m) => m.ticker)).toEqual(["SCHD", "DGRO", "EUFN", "VIG"]);
    for (const m of b.members) {
      expect(m.weight).toBeCloseTo(0.25, 10);
    }
    expect(b.excluded.map((e) => e.ticker)).toEqual(["FDVV", "VYMI"]);
    expect(b.isComplete).toBe(false);
    expect(b.sources).toHaveLength(6);
    expect(b.asOf).toBe("2026-06-30");

    expect(b.sharePriceGrowth).toBeCloseTo(0.10845, 10);
    expect(b.dividendYield).toBeCloseTo(0.0243, 10);
    expect(b.expenseRatio).toBeCloseTo(0.001675, 10);
    expect(b.totalReturnAnnualised).toBeCloseTo(0.13275, 10);
    // The null-as-0 *and* no-renormalisation answer (D1 table) -- must never be reachable.
    expect(b.sharePriceGrowth).not.toBe(0.0723);

    expect(requireBlendPriceGrowth(b)).toBeCloseTo(0.10845, 10);
  });

  it("Blend AC5 — §6 identity holds for B, C, D and E", () => {
    const b = buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "excludeUnprojectable");
    const c = buildBlend(
      [
        { ticker: "SCHD", weight: 0.5 },
        { ticker: "DGRO", weight: 0.3 },
        { ticker: "VIG", weight: 0.2 },
      ],
      "strict"
    );
    const d = buildBlend(
      [
        { ticker: "SCHD", weight: 0.4 },
        { ticker: "VYMI", weight: 0.3 },
        { ticker: "DGRO", weight: 0.2 },
        { ticker: "VIG", weight: 0.1 },
      ],
      "excludeUnprojectable"
    );
    const e = makeFixtureE();

    for (const blend of [b, c, d, e]) {
      expect(blend.sharePriceGrowth).not.toBeNull();
      expect(blend.totalReturnAnnualised).not.toBeNull();
      expect(blend.dividendYield).not.toBeNull();
      expect(blend.sharePriceGrowth as number).toBeCloseTo(
        (blend.totalReturnAnnualised as number) - (blend.dividendYield as number),
        10
      );
    }
  });

  it("Blend AC6 — weighted, not plain, mean (Fixture C)", () => {
    const c = buildBlend(
      [
        { ticker: "SCHD", weight: 0.5 },
        { ticker: "DGRO", weight: 0.3 },
        { ticker: "VIG", weight: 0.2 },
      ],
      "strict"
    );

    expect(c.isComplete).toBe(true);
    expect(c.excluded).toEqual([]);
    expect(c.members.map((m) => m.weight)).toEqual([0.5, 0.3, 0.2]);
    // Cycle 1 / F3: `requested` must echo the caller's actual weights, not 1/n — with SCHD/DGRO/VIG
    // at 0.5/0.3/0.2 the two diverge (1/3 each), so this pins the mutation every other fixture
    // missed because they all use equalWeights, where requested and 1/n coincide.
    expect(c.requested.map((r) => r.weight)).toEqual([0.5, 0.3, 0.2]);

    expect(c.sharePriceGrowth).toBeCloseTo(0.1029, 10);
    expect(c.dividendYield).toBeCloseTo(0.02507, 10);
    expect(c.expenseRatio).toBeCloseTo(0.00062, 10);
    expect(c.totalReturnAnnualised).toBeCloseTo(0.12797, 10);

    // A plain (unweighted) mean over the same three funds fails all three ways.
    expect(c.sharePriceGrowth).not.toBeCloseTo(0.1069, 3);
    expect(c.dividendYield).not.toBeCloseTo(0.0222333333, 3);
    expect(c.expenseRatio).not.toBeCloseTo(0.0006, 5);
  });

  it("Blend AC7 — non-uniform renormalisation (Fixture D)", () => {
    const d = buildBlend(
      [
        { ticker: "SCHD", weight: 0.4 },
        { ticker: "VYMI", weight: 0.3 },
        { ticker: "DGRO", weight: 0.2 },
        { ticker: "VIG", weight: 0.1 },
      ],
      "excludeUnprojectable"
    );

    expect(d.members.map((m) => m.ticker)).toEqual(["SCHD", "DGRO", "VIG"]);
    expect(d.members[0].weight).toBeCloseTo(4 / 7, 10);
    expect(d.members[1].weight).toBeCloseTo(2 / 7, 10);
    expect(d.members[2].weight).toBeCloseTo(1 / 7, 10);
    const weightSum = d.members.reduce((sum, m) => sum + m.weight, 0);
    expect(Math.abs(weightSum - 1)).toBeLessThanOrEqual(1e-12);

    expect(d.sharePriceGrowth).toBeCloseTo(0.1011857142857143, 10);
    expect(d.dividendYield).toBeCloseTo(0.026285714285714286, 10);
    expect(d.expenseRatio).toBeCloseTo(0.0006285714285714286, 10);
    expect(d.totalReturnAnnualised).toBeCloseTo(0.1274714285714286, 10);

    expect(d.excluded).toEqual([{ ticker: "VYMI", requestedWeight: 0.3, reason: expect.any(String) }]);

    // Neither "VYMI counted as 0, no renormalisation" nor "renormalised by member count" (both
    // banned interpretations from the D1 table / AC7).
    expect(d.sharePriceGrowth).not.toBeCloseTo(0.07083, 3);
    expect(d.sharePriceGrowth).not.toBeCloseTo(0.1069, 3);
  });

  it("Blend AC8 — a null field nulls the field, not the member (Fixture E)", () => {
    const e = makeFixtureE();

    expect(e.expenseRatio).toBeNull();
    expect(e.expenseRatio).not.toBe(0.001); // per-field re-exclusion (dropping Q1 entirely)
    expect(e.expenseRatio).not.toBe(0.0005); // null-as-0

    expect(e.sharePriceGrowth).toBeCloseTo(0.12, 10);
    expect(e.dividendYield).toBeCloseTo(0.03, 10);
    expect(e.totalReturnAnnualised).toBeCloseTo(0.15, 10);
    expect(e.members).toHaveLength(2);
    expect(e.excluded).toEqual([]);
    expect(e.isComplete).toBe(true);
  });

  it("Blend AC9 — asOf is the oldest CONTRIBUTING member, not newest or first-listed", () => {
    expect(buildBlend(equalWeights(["VIG", "SCHD"]), "strict").asOf).toBe("2026-06-30");
    expect(buildBlend(equalWeights(["VIG"]), "strict").asOf).toBe("2026-07-31");

    const e = makeFixtureE();
    expect(e.asOf).toBe("2026-04-30");

    const b = buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "excludeUnprojectable");
    for (const s of b.sources) {
      const fund = getFund(s.ticker);
      expect(s.asOf).toBe(fund.asOf);
      expect(s.source).toBe(fund.source);
    }
  });

  it("Blend AC10 — weight-sum tolerance, not exact equality", () => {
    expect(() => buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "strict")).not.toThrow();

    expect(() =>
      buildBlend(
        [
          { ticker: "SCHD", weight: 0.5 },
          { ticker: "DGRO", weight: 0.5000001 },
        ],
        "strict"
      )
    ).toThrow(FundDataError);

    expect(() =>
      buildBlend(
        [
          { ticker: "SCHD", weight: 0.5 },
          { ticker: "DGRO", weight: 0.4 },
        ],
        "strict"
      )
    ).toThrow(FundDataError);

    expect(() =>
      buildBlend(
        [
          { ticker: "SCHD", weight: 0.5 },
          { ticker: "DGRO", weight: 0.5 + 1e-12 },
        ],
        "strict"
      )
    ).not.toThrow();
  });

  it("Blend AC11 — every invalid request throws FundDataError, naming the ticker or field", () => {
    expect(() => buildBlend([], "strict")).toThrow(FundDataError);
    expect(() => equalWeights([])).toThrow(FundDataError);

    const unknownErr = captureError(() => buildBlend([{ ticker: "VOO", weight: 1 }], "strict"));
    expect(unknownErr).toBeInstanceOf(FundDataError);
    expect(unknownErr.message).toContain("VOO");

    const dupErr = captureError(() =>
      buildBlend(
        [
          { ticker: "SCHD", weight: 0.5 },
          { ticker: "SCHD", weight: 0.5 },
        ],
        "strict"
      )
    );
    expect(dupErr).toBeInstanceOf(FundDataError);
    expect(dupErr.message).toContain("SCHD");

    for (const badWeight of [NaN, Infinity, -Infinity, -0.1, 0]) {
      const err = captureError(() =>
        buildBlend([{ ticker: "SCHD", weight: badWeight }], "strict")
      );
      expect(err).toBeInstanceOf(FundDataError);
      expect(err.message).toContain("SCHD");
    }

    const stringWeightErr = captureError(() =>
      buildBlend(
        [{ ticker: "SCHD", weight: "0.5" }] as unknown as { ticker: string; weight: number }[],
        "strict"
      )
    );
    expect(stringWeightErr).toBeInstanceOf(FundDataError);
    expect(stringWeightErr.message).toContain("SCHD");

    const policyErr = captureError(() =>
      buildBlend(equalWeights(["SCHD"]), "loose" as BlendPolicy)
    );
    expect(policyErr).toBeInstanceOf(FundDataError);
    expect(policyErr.message).toContain("policy");
  });

  it("Blend AC12 — types force the decision", () => {
    // @ts-expect-error sharePriceGrowth is number | null -- a caller must handle the null
    const g: number = buildBlend(equalWeights(["SCHD"]), "strict").sharePriceGrowth;
    // Not invoked -- omitting `policy` throws FundDataError at runtime (AC11: validated at
    // runtime, not only in the type), so this only needs to prove the *type* rejects it.
    // @ts-expect-error policy is required, not optional -- it must be typed in, not defaulted
    const callWithoutPolicy = () => buildBlend(equalWeights(["SCHD"]));
    // @ts-expect-error policy is required on blendFunds too, not just its buildBlend wrapper
    const callBlendFundsWithoutPolicy = () => blendFunds(loadFunds(), equalWeights(["SCHD"]));
    expect(typeof g === "number" || g === null).toBe(true);
    expect(typeof callWithoutPolicy).toBe("function");
    expect(typeof callBlendFundsWithoutPolicy).toBe("function");
    // A default parameter value drops a function's declared arity (Function.length excludes
    // every parameter from the first with a default onward) -- this catches `policy` silently
    // gaining a default even if every call site still happens to pass it explicitly.
    expect(blendFunds.length).toBe(3);
    expect(buildBlend.length).toBe(2);
  });

  it("Blend AC13 — pure and finite", () => {
    const funds = loadFunds();
    const fundsBefore = JSON.parse(JSON.stringify(funds));
    const members = equalWeights(["SCHD", "DGRO"]);
    const membersBefore = JSON.parse(JSON.stringify(members));

    blendFunds(funds, members, "excludeUnprojectable");

    expect(funds).toEqual(fundsBefore);
    expect(members).toEqual(membersBefore);

    const b = buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "excludeUnprojectable");
    const c = buildBlend(
      [
        { ticker: "SCHD", weight: 0.5 },
        { ticker: "DGRO", weight: 0.3 },
        { ticker: "VIG", weight: 0.2 },
      ],
      "strict"
    );
    const d = buildBlend(
      [
        { ticker: "SCHD", weight: 0.4 },
        { ticker: "VYMI", weight: 0.3 },
        { ticker: "DGRO", weight: 0.2 },
        { ticker: "VIG", weight: 0.1 },
      ],
      "excludeUnprojectable"
    );
    const e = makeFixtureE();

    for (const blend of [b, c, d, e]) {
      for (const value of [
        blend.sharePriceGrowth,
        blend.dividendYield,
        blend.expenseRatio,
        blend.totalReturnAnnualised,
      ]) {
        if (value !== null) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
      const weightSum = blend.members.reduce((sum, m) => sum + m.weight, 0);
      expect(Math.abs(weightSum - 1)).toBeLessThanOrEqual(1e-12);
    }
  });
});
