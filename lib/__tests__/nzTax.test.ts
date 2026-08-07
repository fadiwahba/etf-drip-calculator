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
