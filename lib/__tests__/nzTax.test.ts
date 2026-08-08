import { describe, it, expect } from "vitest";
import {
  computeAnnualTax,
  TaxInputError,
  FDR_RATE,
  DEFAULT_FIF_DE_MINIMIS_NZD,
  PIR_CAP,
  type TaxYearInput,
  type TaxYearResult,
} from "@/lib/nzTax";

// Invariant 13 (calculator-invariants.md): NaN/Infinity must never escape a calculation.
function expectAllFinite(result: TaxYearResult): void {
  expect(Number.isFinite(result.taxableIncomeNzd)).toBe(true);
  expect(Number.isFinite(result.rate)).toBe(true);
  expect(Number.isFinite(result.grossTaxNzd)).toBe(true);
  expect(Number.isFinite(result.foreignTaxCreditNzd)).toBe(true);
  expect(Number.isFinite(result.nzTaxPayableNzd)).toBe(true);
  expect(Number.isFinite(result.totalTaxNzd)).toBe(true);
}

describe("computeAnnualTax", () => {
  // AC1: de minimis (cost <= NZ$50,000) means FIF does not apply — actual dividends taxed at
  // marginal rate, with US WHT credited against the resulting NZ liability.
  it("AC1 — below the FIF de minimis, actual dividends are taxed at marginal rate", () => {
    const input: TaxYearInput = {
      wrapper: "direct",
      foreignCostNzd: 40_000,
      openingValueNzd: 0,
      closingValueNzd: 0,
      grossDividendsNzd: 1_200,
      marginalRate: 0.33,
      usWithholdingPaidNzd: 180,
    };
    const result = computeAnnualTax(input);
    expect(result.regime).toBe("dividend");
    expect(result.method).toBe("actual-dividends");
    expect(result.aboveThreshold).toBe(false);
    expect(result.taxableIncomeNzd).toBeCloseTo(1_200, 6);
    expect(result.grossTaxNzd).toBeCloseTo(396, 6);
    expect(result.foreignTaxCreditNzd).toBeCloseTo(180, 6);
    expect(result.nzTaxPayableNzd).toBeCloseTo(216, 6);
    expect(result.totalTaxNzd).toBeCloseTo(396, 6);
    expectAllFinite(result);
  });

  // AC2: FDR taxes 5% of opening market value — a deemed return, not the dividends actually
  // received. Constitution §5.
  it("AC2 — FDR taxes a deemed return of opening value, not received dividends", () => {
    const base: TaxYearInput = {
      wrapper: "direct",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 230_000,
      grossDividendsNzd: 0,
      marginalRate: 0.33,
    };
    const withNoDividends = computeAnnualTax(base);
    const withDividends = computeAnnualTax({ ...base, grossDividendsNzd: 8_000 });

    for (const result of [withNoDividends, withDividends]) {
      expect(result.method).toBe("fdr");
      expect(result.taxableIncomeNzd).toBeCloseTo(10_000, 6);
      expect(result.grossTaxNzd).toBeCloseTo(3_300, 6);
      expectAllFinite(result);
    }
  });

  // AC3: wrapper decides the rate — PIE is capped at the 28% top PIR band, direct holdings pay
  // the investor's marginal rate. Same FDR income, different tax.
  it("AC3 — PIE wrapper caps the rate at 28% PIR; direct pays marginal rate", () => {
    const base: TaxYearInput = {
      wrapper: "direct",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 240_000,
      grossDividendsNzd: 0,
      marginalRate: 0.33,
    };
    const pieResult = computeAnnualTax({ ...base, wrapper: "pie", pir: 0.33 });
    expect(pieResult.rate).toBeCloseTo(0.28, 6);
    expect(pieResult.grossTaxNzd).toBeCloseTo(2_800, 6);

    const directResult = computeAnnualTax(base);
    expect(directResult.rate).toBeCloseTo(0.33, 6);
    expect(directResult.grossTaxNzd).toBeCloseTo(3_300, 6);

    expectAllFinite(pieResult);
    expectAllFinite(directResult);
  });

  // AC4: an individual may use the lower of FDR and CV each year (nz-tax.md). Here CV is lower.
  it("AC4 — the lower-of FDR/CV rule picks CV when CV is lower", () => {
    const result = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 205_000,
      grossDividendsNzd: 1_500,
      purchasesNzd: 0,
      marginalRate: 0.33,
    });
    expect(result.method).toBe("cv");
    expect(result.taxableIncomeNzd).toBeCloseTo(6_500, 6);
    expect(result.grossTaxNzd).toBeCloseTo(2_145, 6);
    expectAllFinite(result);
  });

  // AC5: CV floors at zero — a losing year produces $0 FIF tax, and a foreign tax credit never
  // creates a refund (payable floors at 0, but total still includes the WHT actually paid).
  it("AC5 — CV floors at zero in a losing year; a credit never refunds", () => {
    const result = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 170_000,
      grossDividendsNzd: 3_000,
      marginalRate: 0.33,
      usWithholdingPaidNzd: 450,
    });
    expect(result.method).toBe("cv");
    expect(result.taxableIncomeNzd).toBeCloseTo(0, 6);
    expect(result.grossTaxNzd).toBeCloseTo(0, 6);
    expect(result.foreignTaxCreditNzd).toBeCloseTo(0, 6);
    expect(result.nzTaxPayableNzd).toBeCloseTo(0, 6);
    expect(result.totalTaxNzd).toBeCloseTo(450, 6);
    expectAllFinite(result);
  });

  // AC6: US withholding is creditable against the FIF liability, capped at that liability — it
  // never turns into a refund (nz-tax.md — Withholding tax).
  it("AC6 — US WHT credits against FIF liability, capped at the liability", () => {
    const result = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 240_000,
      grossDividendsNzd: 8_000,
      marginalRate: 0.33,
      usWithholdingPaidNzd: 4_000,
    });
    expect(result.grossTaxNzd).toBeCloseTo(3_300, 6);
    expect(result.foreignTaxCreditNzd).toBeCloseTo(3_300, 6);
    expect(result.nzTaxPayableNzd).toBeCloseTo(0, 6);
    expect(result.totalTaxNzd).toBeCloseTo(4_000, 6);
    expectAllFinite(result);
  });

  // AC7: the de minimis tests cost, not market value — a holding can be worth far more than
  // $50,000 and still sit under the threshold if its cost basis does not.
  it("AC7 — the de minimis threshold tests cost, not market value", () => {
    const result = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 45_000,
      openingValueNzd: 70_000,
      closingValueNzd: 70_000,
      grossDividendsNzd: 2_100,
      marginalRate: 0.33,
    });
    expect(result.regime).toBe("dividend");
    expect(result.grossTaxNzd).toBeCloseTo(693, 6);
    expectAllFinite(result);
  });

  // AC8: the FIF de minimis is a parameter (nz-tax.md notes the unconfirmed 2026-27 $100,000
  // proposal) — callers can override it, and the default still applies when they don't.
  it("AC8 — the de minimis threshold is a caller-supplied parameter", () => {
    const withOverride = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 60_000,
      openingValueNzd: 0,
      closingValueNzd: 0,
      grossDividendsNzd: 1_800,
      marginalRate: 0.33,
      fifThresholdNzd: 100_000,
    });
    expect(withOverride.regime).toBe("dividend");
    expect(withOverride.grossTaxNzd).toBeCloseTo(594, 6);
    expectAllFinite(withOverride);

    const withoutOverride = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 60_000,
      openingValueNzd: 60_000,
      closingValueNzd: 60_000,
      grossDividendsNzd: 1_800,
      marginalRate: 0.33,
    });
    expect(withoutOverride.regime).toBe("fif");
    expectAllFinite(withoutOverride);
  });

  // AC9: threshold crossing is decided year by year — each independent call to computeAnnualTax
  // gets its own regime decision based on that year's cost.
  it("AC9 — threshold crossing is decided independently for each year", () => {
    const y1 = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 45_000,
      openingValueNzd: 0,
      closingValueNzd: 0,
      grossDividendsNzd: 1_350,
      marginalRate: 0.33,
      usWithholdingPaidNzd: 0,
    });
    expect(y1.regime).toBe("dividend");
    expect(y1.grossTaxNzd).toBeCloseTo(445.5, 6);

    const y2 = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 52_000,
      openingValueNzd: 55_000,
      closingValueNzd: 62_000,
      grossDividendsNzd: 1_600,
      purchasesNzd: 5_000,
      marginalRate: 0.33,
      usWithholdingPaidNzd: 0,
    });
    expect(y2.regime).toBe("fif");
    expect(y2.method).toBe("fdr");
    expect(y2.grossTaxNzd).toBeCloseTo(907.5, 6);

    const y3 = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 60_000,
      openingValueNzd: 62_000,
      closingValueNzd: 70_000,
      grossDividendsNzd: 1_800,
      purchasesNzd: 3_000,
      marginalRate: 0.33,
      usWithholdingPaidNzd: 0,
    });
    expect(y3.regime).toBe("fif");
    expect(y3.method).toBe("fdr");
    expect(y3.grossTaxNzd).toBeCloseTo(1_023, 6);

    expectAllFinite(y1);
    expectAllFinite(y2);
    expectAllFinite(y3);
  });

  // Boundary on AC1/AC7's de minimis test: nz-tax.md says "cost ≤ NZ$50,000 → FIF does not apply",
  // so a cost exactly at the threshold must stay in the dividend regime, and one cent over must
  // cross into FIF. Locks the `>` comparison at nzTax.ts:135 against being "tidied" to `>=`.
  it("boundary — cost exactly at the de minimis threshold stays below it; one cent over crosses it", () => {
    const atThreshold = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 50_000,
      openingValueNzd: 0,
      closingValueNzd: 0,
      grossDividendsNzd: 1_000,
      marginalRate: 0.33,
    });
    expect(atThreshold.regime).toBe("dividend");
    expect(atThreshold.aboveThreshold).toBe(false);
    expectAllFinite(atThreshold);

    const justOverThreshold = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 50_000.01,
      openingValueNzd: 100_000,
      closingValueNzd: 100_000,
      grossDividendsNzd: 1_000,
      marginalRate: 0.33,
    });
    expect(justOverThreshold.regime).toBe("fif");
    expect(justOverThreshold.aboveThreshold).toBe(true);
    expectAllFinite(justOverThreshold);
  });

  // Boundary on AC4's lower-of rule: spec.md says "Exact tie → method: fdr". Locks the `<=`
  // comparison at nzTax.ts:160 against being "tidied" to `<`, which would silently flip the
  // reported method on a tie without changing the taxable amount.
  it("boundary — FDR = CV exact tie resolves to method fdr, per spec", () => {
    const result = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 210_000,
      grossDividendsNzd: 0,
      marginalRate: 0.33,
    });
    expect(result.method).toBe("fdr");
    expect(result.taxableIncomeNzd).toBeCloseTo(10_000, 6);
    expectAllFinite(result);
  });

  // AC10: invalid input fails loudly — never coerced to 0 (invariant 14).
  describe("AC10 — invalid input throws TaxInputError naming the field", () => {
    const valid: TaxYearInput = {
      wrapper: "direct",
      foreignCostNzd: 40_000,
      openingValueNzd: 40_000,
      closingValueNzd: 40_000,
      grossDividendsNzd: 1_000,
      marginalRate: 0.33,
    };

    it("throws on NaN in a numeric field", () => {
      expect(() => computeAnnualTax({ ...valid, grossDividendsNzd: NaN })).toThrow(TaxInputError);
      expect(() => computeAnnualTax({ ...valid, grossDividendsNzd: NaN })).toThrow(
        /grossDividendsNzd/
      );
    });

    it("throws on Infinity in a numeric field", () => {
      expect(() => computeAnnualTax({ ...valid, openingValueNzd: Infinity })).toThrow(
        TaxInputError
      );
      expect(() => computeAnnualTax({ ...valid, openingValueNzd: Infinity })).toThrow(
        /openingValueNzd/
      );
    });

    it("throws on a negative money field", () => {
      expect(() => computeAnnualTax({ ...valid, foreignCostNzd: -1 })).toThrow(TaxInputError);
      expect(() => computeAnnualTax({ ...valid, foreignCostNzd: -1 })).toThrow(/foreignCostNzd/);
    });

    it("throws when marginalRate is outside 0-1 (a percent-shaped input, e.g. 33)", () => {
      expect(() => computeAnnualTax({ ...valid, marginalRate: 33 })).toThrow(TaxInputError);
      expect(() => computeAnnualTax({ ...valid, marginalRate: 33 })).toThrow(/marginalRate/);
    });

    it("throws when pir is outside 0-1", () => {
      expect(() =>
        computeAnnualTax({ ...valid, wrapper: "pie", pir: 28 })
      ).toThrow(TaxInputError);
      expect(() =>
        computeAnnualTax({ ...valid, wrapper: "pie", pir: 28 })
      ).toThrow(/pir/);
    });

    it("throws when wrapper is pie and pir is undefined", () => {
      expect(() => computeAnnualTax({ ...valid, wrapper: "pie" })).toThrow(TaxInputError);
      expect(() => computeAnnualTax({ ...valid, wrapper: "pie" })).toThrow(/pir/);
    });

    it("throws when fifThresholdNzd is <= 0", () => {
      expect(() => computeAnnualTax({ ...valid, fifThresholdNzd: 0 })).toThrow(TaxInputError);
      expect(() => computeAnnualTax({ ...valid, fifThresholdNzd: 0 })).toThrow(
        /fifThresholdNzd/
      );
      expect(() => computeAnnualTax({ ...valid, fifThresholdNzd: -100 })).toThrow(TaxInputError);
    });

    // The wrapper decides the rate (PIR-capped 28% vs marginal), so an unrecognised value must
    // not fall through to the direct branch and return a plausible wrong number.
    it("throws on an unrecognised wrapper instead of falling back to the marginal rate", () => {
      const bad = { ...valid, wrapper: "PIE" as unknown as TaxYearInput["wrapper"] };
      expect(() => computeAnnualTax(bad)).toThrow(TaxInputError);
      expect(() => computeAnnualTax(bad)).toThrow(/wrapper/);
    });
  });

  // AC11: no NaN/Infinity escapes for any valid fixture — checked inline via expectAllFinite
  // above for every AC1-9 fixture (invariant 13).
  it("AC11 — every numeric result field is finite for a representative fixture", () => {
    const result = computeAnnualTax({
      wrapper: "pie",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 240_000,
      grossDividendsNzd: 8_000,
      marginalRate: 0.33,
      pir: 0.28,
      usWithholdingPaidNzd: 1_000,
    });
    expectAllFinite(result);
  });

  // AC12: cited constants are exported with an IRD URL and the date checked, so no rate is ever
  // restated from memory elsewhere in the codebase.
  it("AC12 — cited tax constants are exported with their correct values", () => {
    expect(FDR_RATE).toBe(0.05);
    expect(DEFAULT_FIF_DE_MINIMIS_NZD).toBe(50_000);
    expect(PIR_CAP).toBe(0.28);
  });
});

// features/pie-de-minimis-wrapper-aware/spec.md — nz-tax.md "⚠️ The de minimis is a
// DIRECT-HOLDING rule only — it never applies to a PIE". A NZ PIE runs FIF at fund level from the
// first dollar; the de minimis relief is a direct-holding rule only. Fixture "PIE-30k" below is
// the spec's own "Before / after" fixture, hand-verified independently by this coder before
// implementation (see notes.md's arithmetic-check table).
describe("computeAnnualTax — PIE de minimis is wrapper-aware", () => {
  function pie30k(overrides: Partial<TaxYearInput> = {}): TaxYearInput {
    return {
      wrapper: "pie",
      foreignCostNzd: 30_000,
      openingValueNzd: 30_000,
      closingValueNzd: 32_700,
      grossDividendsNzd: 975,
      pir: 0.28,
      marginalRate: 0.33,
      ...overrides,
    };
  }

  // AC1: a PIE below the de minimis still runs FIF, from the first dollar.
  it("AC1 — a sub-$50k PIE runs FIF (fdr), not the dividend regime", () => {
    const result = computeAnnualTax(pie30k());
    expect(result.regime).toBe("fif");
    expect(result.method).toBe("fdr");
    expect(result.aboveThreshold).toBe(false);
    expect(result.taxableIncomeNzd).toBeCloseTo(1_500, 6);
    expect(result.rate).toBeCloseTo(0.28, 6);
    expect(result.grossTaxNzd).toBeCloseTo(420, 6);
    expect(result.nzTaxPayableNzd).toBeCloseTo(420, 6);
    expect(result.totalTaxNzd).toBeCloseTo(420, 6);
    expectAllFinite(result);
  });

  // AC2: the same fixture as a direct holding is untouched — asserted in the same test body as AC1
  // so a regression that reverted the gate (both wrappers agreeing again) cannot pass silently.
  it("AC2 — the same fixture as a direct holding keeps the dividend regime (regression pin)", () => {
    const pieResult = computeAnnualTax(pie30k());
    const directResult = computeAnnualTax(pie30k({ wrapper: "direct", pir: undefined }));

    expect(directResult.regime).toBe("dividend");
    expect(directResult.method).toBe("actual-dividends");
    expect(directResult.aboveThreshold).toBe(false);
    expect(directResult.taxableIncomeNzd).toBeCloseTo(975, 6);
    expect(directResult.rate).toBeCloseTo(0.33, 6);
    expect(directResult.grossTaxNzd).toBeCloseTo(321.75, 6);
    expect(directResult.totalTaxNzd).toBeCloseTo(321.75, 6);
    expectAllFinite(directResult);

    // Same inputs, only the wrapper differs — regimes must differ.
    expect(pieResult.regime).not.toBe(directResult.regime);
  });

  // AC3: the PIE drag is 1.40% of opening portfolio value, not 0.91% of the (irrelevant) dividend
  // stream — calculator-invariants.md #11's "mixing the two bases is a ~100× error" restated in
  // FIF terms.
  it("AC3 — PIE drag is 1.40% of value, not the shipped 273 (= 975 × 0.28)", () => {
    const result = computeAnnualTax(pie30k());
    const openingValueNzd = 30_000; // pie30k()'s own openingValueNzd, restated here since
    // TaxYearResult does not echo the input back (spec.md AC3: "grossTaxNzd / openingValueNzd").
    expect(result.grossTaxNzd / openingValueNzd).toBeCloseTo(0.014, 10);
    expect(result.grossTaxNzd).toBeCloseTo(FDR_RATE * 30_000 * 0.28, 6);
    expect(result.grossTaxNzd).not.toBeCloseTo(273, 6);
  });

  // AC4: boundary — cost exactly at the threshold. Direct stays in the dividend regime (untouched);
  // PIE runs FIF regardless.
  it("AC4 — boundary at the threshold: direct untouched, PIE runs FIF anyway", () => {
    const directResult = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 50_000,
      openingValueNzd: 50_000,
      closingValueNzd: 54_000,
      grossDividendsNzd: 1_000,
      marginalRate: 0.33,
    });
    expect(directResult.regime).toBe("dividend");
    expect(directResult.aboveThreshold).toBe(false);
    expect(directResult.taxableIncomeNzd).toBeCloseTo(1_000, 6);
    expect(directResult.grossTaxNzd).toBeCloseTo(330, 6);
    expectAllFinite(directResult);

    const pieResult = computeAnnualTax({
      wrapper: "pie",
      foreignCostNzd: 50_000,
      openingValueNzd: 50_000,
      closingValueNzd: 54_000,
      grossDividendsNzd: 1_000,
      pir: 0.28,
      marginalRate: 0.33,
    });
    expect(pieResult.regime).toBe("fif");
    expect(pieResult.method).toBe("fdr");
    expect(pieResult.aboveThreshold).toBe(false);
    expect(pieResult.taxableIncomeNzd).toBeCloseTo(2_500, 6);
    expect(pieResult.grossTaxNzd).toBeCloseTo(700, 6);
    expectAllFinite(pieResult);
  });

  // AC5: boundary — one cent over. Direct jumps into FIF; PIE's result is identical to AC4's PIE
  // (its regime/tax never depended on the threshold in the first place).
  it("AC5 — one cent over: direct jumps to FIF; PIE is unchanged from AC4's boundary", () => {
    const directResult = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 50_000.01,
      openingValueNzd: 50_000,
      closingValueNzd: 54_000,
      grossDividendsNzd: 1_000,
      marginalRate: 0.33,
    });
    expect(directResult.regime).toBe("fif");
    expect(directResult.aboveThreshold).toBe(true);
    expect(directResult.taxableIncomeNzd).toBeCloseTo(2_500, 6);
    expect(directResult.grossTaxNzd).toBeCloseTo(825, 6);

    const pieResult = computeAnnualTax({
      wrapper: "pie",
      foreignCostNzd: 50_000.01,
      openingValueNzd: 50_000,
      closingValueNzd: 54_000,
      grossDividendsNzd: 1_000,
      pir: 0.28,
      marginalRate: 0.33,
    });
    expect(pieResult.regime).toBe("fif");
    expect(pieResult.aboveThreshold).toBe(true);
    expect(pieResult.grossTaxNzd).toBeCloseTo(700, 6);
  });

  // AC6: a PIE above the de minimis is byte-identical to the pre-fix behaviour (regression pin) —
  // the gate must only change the sub-$50k path.
  it("AC6 — a PIE above the de minimis is unchanged (regression pin)", () => {
    const result = computeAnnualTax({
      wrapper: "pie",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 240_000,
      grossDividendsNzd: 8_000,
      pir: 0.28,
      usWithholdingPaidNzd: 1_000,
      marginalRate: 0.33,
    });
    expect(result.regime).toBe("fif");
    expect(result.method).toBe("fdr");
    expect(result.aboveThreshold).toBe(true);
    expect(result.taxableIncomeNzd).toBeCloseTo(10_000, 6);
    expect(result.rate).toBeCloseTo(0.28, 6);
    expect(result.grossTaxNzd).toBeCloseTo(2_800, 6);
    expect(result.foreignTaxCreditNzd).toBeCloseTo(1_000, 6);
    expect(result.nzTaxPayableNzd).toBeCloseTo(1_800, 6);
    expect(result.totalTaxNzd).toBeCloseTo(2_800, 6);
    expectAllFinite(result);
  });

  // AC7: direct holdings at every size are byte-identical (regression pin) — three fixtures copied
  // from the pre-existing suite (AC1/AC2/AC8 above).
  it("AC7 — direct holdings at every size are unchanged (regression pin)", () => {
    const below = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 40_000,
      openingValueNzd: 0,
      closingValueNzd: 0,
      grossDividendsNzd: 1_200,
      marginalRate: 0.33,
      usWithholdingPaidNzd: 180,
    });
    expect(below.regime).toBe("dividend");
    expect(below.taxableIncomeNzd).toBeCloseTo(1_200, 6);
    expect(below.grossTaxNzd).toBeCloseTo(396, 6);
    expect(below.foreignTaxCreditNzd).toBeCloseTo(180, 6);
    expect(below.nzTaxPayableNzd).toBeCloseTo(216, 6);
    expect(below.totalTaxNzd).toBeCloseTo(396, 6);

    const above = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 200_000,
      openingValueNzd: 200_000,
      closingValueNzd: 230_000,
      grossDividendsNzd: 0,
      marginalRate: 0.33,
    });
    expect(above.regime).toBe("fif");
    expect(above.method).toBe("fdr");
    expect(above.taxableIncomeNzd).toBeCloseTo(10_000, 6);
    expect(above.grossTaxNzd).toBeCloseTo(3_300, 6);

    const overriddenThreshold = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 60_000,
      openingValueNzd: 0,
      closingValueNzd: 0,
      grossDividendsNzd: 1_800,
      marginalRate: 0.33,
      fifThresholdNzd: 100_000,
    });
    expect(overriddenThreshold.regime).toBe("dividend");
    expect(overriddenThreshold.grossTaxNzd).toBeCloseTo(594, 6);
  });

  // AC8 (decision 2): fifThresholdNzd cannot change a PIE's tax — it still sets the reported
  // `aboveThreshold` fact, and validation still applies (fifThresholdNzd: 0 still throws).
  it("AC8 — fifThresholdNzd cannot change a PIE's tax, but still sets aboveThreshold and is still validated", () => {
    const noOverride = computeAnnualTax(pie30k());
    const highThreshold = computeAnnualTax(pie30k({ fifThresholdNzd: 100_000 }));
    const lowThreshold = computeAnnualTax(pie30k({ fifThresholdNzd: 10_000 }));

    for (const result of [noOverride, highThreshold, lowThreshold]) {
      expect(result.regime).toBe("fif");
      expect(result.method).toBe("fdr");
      expect(result.taxableIncomeNzd).toBeCloseTo(1_500, 6);
      expect(result.grossTaxNzd).toBeCloseTo(420, 6);
    }
    expect(noOverride.aboveThreshold).toBe(false);
    expect(highThreshold.aboveThreshold).toBe(false);
    expect(lowThreshold.aboveThreshold).toBe(true);

    expect(() => computeAnnualTax(pie30k({ fifThresholdNzd: 0 }))).toThrow(TaxInputError);
    expect(() => computeAnnualTax(pie30k({ fifThresholdNzd: 0 }))).toThrow(/fifThresholdNzd/);
  });

  // AC9 (decision 4): the lower-of FDR/CV rule still applies to a PIE below the threshold.
  describe("AC9 — lower-of FDR/CV still applies to a PIE below the threshold", () => {
    it("(a) a losing year floors CV at zero, so tax is $0 even though FDR is positive", () => {
      const result = computeAnnualTax({
        wrapper: "pie",
        foreignCostNzd: 30_000,
        openingValueNzd: 30_000,
        closingValueNzd: 24_000,
        grossDividendsNzd: 900,
        pir: 0.28,
        usWithholdingPaidNzd: 135,
        marginalRate: 0.33,
      });
      expect(result.method).toBe("cv");
      expect(result.taxableIncomeNzd).toBeCloseTo(0, 6);
      expect(result.grossTaxNzd).toBeCloseTo(0, 6);
      expect(result.foreignTaxCreditNzd).toBeCloseTo(0, 6);
      expect(result.nzTaxPayableNzd).toBeCloseTo(0, 6);
      expect(result.totalTaxNzd).toBeCloseTo(135, 6);
      expectAllFinite(result);
    });

    it("(b) an exact FDR/CV tie resolves to method fdr, per spec", () => {
      const result = computeAnnualTax({
        wrapper: "pie",
        foreignCostNzd: 30_000,
        openingValueNzd: 30_000,
        closingValueNzd: 31_500,
        grossDividendsNzd: 0,
        pir: 0.28,
        marginalRate: 0.33,
      });
      expect(result.method).toBe("fdr");
      expect(result.taxableIncomeNzd).toBeCloseTo(1_500, 6);
      expect(result.grossTaxNzd).toBeCloseTo(420, 6);
      expectAllFinite(result);
    });
  });

  // AC10: a projection crossing $50k mid-run diverges by wrapper — three independent calls per
  // wrapper, mirroring the pre-existing "AC9 — threshold crossing is decided independently for each
  // year" direct-only test above, but comparing both wrappers side by side.
  it("AC10 — a run crossing $50k mid-projection diverges by wrapper", () => {
    const directY1 = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 45_000,
      openingValueNzd: 45_000,
      closingValueNzd: 49_500,
      grossDividendsNzd: 1_350,
      purchasesNzd: 0,
      marginalRate: 0.33,
    });
    expect(directY1.regime).toBe("dividend");
    expect(directY1.grossTaxNzd).toBeCloseTo(445.5, 6);

    const directY2 = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 52_000,
      openingValueNzd: 55_000,
      closingValueNzd: 62_000,
      grossDividendsNzd: 1_600,
      purchasesNzd: 5_000,
      marginalRate: 0.33,
    });
    expect(directY2.regime).toBe("fif");
    expect(directY2.grossTaxNzd).toBeCloseTo(907.5, 6);

    const directY3 = computeAnnualTax({
      wrapper: "direct",
      foreignCostNzd: 60_000,
      openingValueNzd: 62_000,
      closingValueNzd: 70_000,
      grossDividendsNzd: 1_800,
      purchasesNzd: 3_000,
      marginalRate: 0.33,
    });
    expect(directY3.regime).toBe("fif");
    expect(directY3.grossTaxNzd).toBeCloseTo(1_023, 6);

    const pieY1 = computeAnnualTax({
      wrapper: "pie",
      foreignCostNzd: 45_000,
      openingValueNzd: 45_000,
      closingValueNzd: 49_500,
      grossDividendsNzd: 1_350,
      purchasesNzd: 0,
      pir: 0.28,
      marginalRate: 0.33,
    });
    expect(pieY1.regime).toBe("fif");
    expect(pieY1.taxableIncomeNzd).toBeCloseTo(2_250, 6);
    expect(pieY1.grossTaxNzd).toBeCloseTo(630, 6);
    // Not the shipped-bug shape (dividends × PIR): 1,350 × 0.28 = 378.
    expect(pieY1.grossTaxNzd).not.toBeCloseTo(378, 6);

    const pieY2 = computeAnnualTax({
      wrapper: "pie",
      foreignCostNzd: 52_000,
      openingValueNzd: 55_000,
      closingValueNzd: 62_000,
      grossDividendsNzd: 1_600,
      purchasesNzd: 5_000,
      pir: 0.28,
      marginalRate: 0.33,
    });
    expect(pieY2.regime).toBe("fif");
    expect(pieY2.taxableIncomeNzd).toBeCloseTo(2_750, 6);
    expect(pieY2.grossTaxNzd).toBeCloseTo(770, 6);

    const pieY3 = computeAnnualTax({
      wrapper: "pie",
      foreignCostNzd: 60_000,
      openingValueNzd: 62_000,
      closingValueNzd: 70_000,
      grossDividendsNzd: 1_800,
      purchasesNzd: 3_000,
      pir: 0.28,
      marginalRate: 0.33,
    });
    expect(pieY3.regime).toBe("fif");
    expect(pieY3.taxableIncomeNzd).toBeCloseTo(3_100, 6);
    expect(pieY3.grossTaxNzd).toBeCloseTo(868, 6);
  });
});
