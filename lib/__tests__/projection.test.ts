import { describe, it, expect } from "vitest";
import {
  project,
  projectFund,
  ProjectionInputError,
  type ProjectionInput,
  type ProjectionResult,
  type ProjectionRow,
} from "@/lib/projection";
import { getFund, MissingAssumptionError } from "@/lib/funds";
import { TaxInputError } from "@/lib/nzTax";

// Defaults follow the spec convention: "unless stated, a fixture's unlisted inputs are zero /
// growthBasis net-of-expense-ratio / timing start / contributionsPerYear 1". wrapper/marginalRate
// are not covered by that convention (not money/rate fields the ACs zero out) — direct at 33% is
// an arbitrary-but-valid placeholder for fixtures where tax nets to zero anyway (below the FIF de
// minimis, no dividends), overridden explicitly whenever a fixture's numbers depend on it.
function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    termYears: 1,
    compoundingPeriodsPerYear: 1,
    contributionsPerYear: 1,
    contributionTiming: "start",
    initialShares: 0,
    initialSharePriceNzd: 10,
    contributionPerEventNzd: 0,
    sharePriceGrowth: 0,
    initialDividendPerShareNzd: 0,
    dividendGrowth: 0,
    growthBasis: "net-of-expense-ratio",
    expenseRatioAnnual: 0,
    platformFeeAnnualRate: 0,
    brokeragePerContributionNzd: 0,
    fxSpreadRate: 0,
    usWithholdingRate: 0,
    wrapper: "direct",
    marginalRate: 0.33,
    ...overrides,
  };
}

// Invariant 13/AC19: NaN/Infinity must never escape a calculation into a row or the summary.
// The field list is derived at runtime, not hardcoded (review.md F3) — a hardcoded list silently
// stops covering any numeric field added to ProjectionRow/ProjectionResult later (it already
// missed `purchasesNzd` once). It does NOT catch a missing field: `typeof undefined === "number"`
// is false, so an absent key is skipped silently. TypeScript strict is what guards that case.
function assertAllFinite(result: ProjectionResult): void {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "number") {
      expect(Number.isFinite(value), `summary.${key}`).toBe(true);
    }
  }
  for (const row of result.rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value), `row.${key} (year ${row.year})`).toBe(true);
      }
    }
  }
}

describe("project", () => {
  // AC1: a term of N years compounds N times, not N+1 (calculator-invariants.md #1).
  it("AC1 — N years compounds N times, not N+1", () => {
    const result = project(
      makeInput({ initialShares: 1000, initialSharePriceNzd: 10, sharePriceGrowth: 0.1, termYears: 3 })
    );
    expect(result.rows.length).toBe(4);
    const year0 = result.rows[0];
    expect(year0.closingValueNzd).toBeCloseTo(10_000, 6);
    expect(year0.contributionsGrossNzd).toBe(0);
    expect(year0.grossDividendsNzd).toBe(0);
    expect(year0.totalFeesNzd).toBe(0);
    expect(year0.totalTaxNzd).toBe(0);
    const year3 = result.rows[3];
    expect(year3.closingSharePriceNzd).toBeCloseTo(13.31, 10);
    expect(year3.closingValueNzd).toBeCloseTo(13_310, 6);
  });

  // AC2: annual-to-period rate conversion is geometric, so compounding frequency is not a growth
  // lever (calculator-invariants.md #2).
  it("AC2 — period rates are geometric, so compounding frequency is not a growth lever", () => {
    const base = makeInput({
      initialShares: 1000,
      initialSharePriceNzd: 10,
      sharePriceGrowth: 0.1,
      termYears: 3,
    });
    const periods = [1, 4, 12, 52];
    const results = periods.map((p) => project({ ...base, compoundingPeriodsPerYear: p }));
    for (const result of results) {
      expect(result.rows.length).toBe(4);
    }
    const round = (rows: ProjectionRow[]) =>
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(10)) : v])
        )
      );
    const first = round(results[0].rows);
    for (const result of results.slice(1)) {
      expect(round(result.rows)).toEqual(first);
    }
    expect(results[0].rows[3].closingValueNzd).toBeCloseTo(13_310, 6);
  });

  // AC3: deposit cadence never changes the growth model (calculator-invariants.md #3).
  it("AC3 — deposit cadence never changes the growth model", () => {
    const cadences = [1, 4, 12];
    const expectedCumulative = [200, 800, 2_400];
    cadences.forEach((c, i) => {
      const result = project(
        makeInput({
          initialSharePriceNzd: 10,
          sharePriceGrowth: 0.1,
          termYears: 2,
          contributionPerEventNzd: 100,
          contributionsPerYear: c,
        })
      );
      expect(result.rows.length).toBe(3);
      expect(result.rows[1].closingSharePriceNzd).toBeCloseTo(11, 10);
      expect(result.rows[2].closingSharePriceNzd).toBeCloseTo(12.1, 10);
      expect(result.rows[1].dividendPerShareNzd).toBeCloseTo(0, 10);
      expect(result.rows[2].dividendPerShareNzd).toBeCloseTo(0, 10);
      expect(result.rows[2].cumulativeContributionsNzd).toBeCloseTo(expectedCumulative[i], 6);
    });
  });

  // AC4: contribution timing is applied per event, not credited at year start
  // (calculator-invariants.md #4).
  it("AC4 — contribution timing is applied per event, not credited at year start", () => {
    const base = makeInput({
      initialShares: 0,
      initialSharePriceNzd: 100,
      sharePriceGrowth: 0.21,
      termYears: 1,
      contributionsPerYear: 2,
      contributionPerEventNzd: 121,
    });
    const end = project({ ...base, contributionTiming: "end" });
    expect(end.rows[1].closingShares).toBeCloseTo(2.1, 10);
    expect(end.rows[1].closingValueNzd).toBeCloseTo(254.1, 6);

    const start = project({ ...base, contributionTiming: "start" });
    expect(start.rows[1].closingShares).toBeCloseTo(2.31, 10);
    expect(start.rows[1].closingValueNzd).toBeCloseTo(279.51, 6);
  });

  // AC5: price-only growth plus a dividend stream, never both — sharePriceGrowth comes only from
  // lib/funds.ts's total-return-minus-yield derivation (calculator-invariants.md #5).
  it("AC5 — projectFund uses funds.ts-derived price-only growth, never total return", () => {
    const rest: Omit<ProjectionInput, "sharePriceGrowth"> = {
      termYears: 1,
      compoundingPeriodsPerYear: 1,
      contributionsPerYear: 1,
      contributionTiming: "start",
      initialShares: 0,
      initialSharePriceNzd: 10,
      contributionPerEventNzd: 0,
      initialDividendPerShareNzd: 0,
      dividendGrowth: 0,
      growthBasis: "net-of-expense-ratio",
      expenseRatioAnnual: 0,
      platformFeeAnnualRate: 0,
      brokeragePerContributionNzd: 0,
      fxSpreadRate: 0,
      usWithholdingRate: 0,
      wrapper: "direct",
      marginalRate: 0.33,
    };
    const result = projectFund(getFund("SCHD"), rest);
    expect(result.rows[1].closingSharePriceNzd).toBeCloseTo(10 * 1.0912, 10);
  });

  // AC6: dividend grows per share, not as a yield (calculator-invariants.md #6).
  it("AC6 — dividend grows per share, not as a yield", () => {
    const result = project(
      makeInput({
        initialShares: 1000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 3,
        initialDividendPerShareNzd: 0.5,
        dividendGrowth: 0.2,
      })
    );
    expect(result.rows[1].dividendPerShareNzd).toBeCloseTo(0.6, 10);
    expect(result.rows[2].dividendPerShareNzd).toBeCloseTo(0.72, 10);
    expect(result.rows[3].dividendPerShareNzd).toBeCloseTo(0.864, 10);

    expect(result.rows[1].dividendPerShareNzd / result.rows[1].closingSharePriceNzd).toBeCloseTo(
      0.054545,
      5
    );
    expect(result.rows[2].dividendPerShareNzd / result.rows[2].closingSharePriceNzd).toBeCloseTo(
      0.059504,
      5
    );
    expect(result.rows[3].dividendPerShareNzd / result.rows[3].closingSharePriceNzd).toBeCloseTo(
      0.064914,
      5
    );

    // No contributions in this fixture, so the contribution loop adds 0 shares — the
    // post-contribution share count equals openingShares exactly, for all three years.
    for (const row of [result.rows[1], result.rows[2], result.rows[3]]) {
      expect(row.grossDividendsNzd).toBeCloseTo(row.openingShares * row.dividendPerShareNzd, 6);
    }
  });

  // AC7: a net-of-fees return is not charged the expense ratio again (calculator-invariants.md #7).
  it("AC7 — a net-of-fees return is not charged the expense ratio again", () => {
    const base = makeInput({
      initialShares: 1000,
      initialSharePriceNzd: 10,
      termYears: 2,
    });

    let thrown: unknown;
    try {
      project({ ...base, growthBasis: "net-of-expense-ratio", expenseRatioAnnual: 0.0006 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProjectionInputError);
    expect((thrown as Error).message).toMatch(/growthBasis/);
    expect((thrown as Error).message).toMatch(/expenseRatioAnnual/);

    const net = project({ ...base, growthBasis: "net-of-expense-ratio", expenseRatioAnnual: 0 });
    for (const row of net.rows) {
      expect(row.expenseFeeNzd).toBe(0);
    }

    const gross = project({ ...base, growthBasis: "gross-of-expense-ratio", expenseRatioAnnual: 0.0006 });
    expect(gross.rows[1].expenseFeeNzd).toBeGreaterThan(0);
  });

  // AC8: fee drag compounds through the share count, growth rate used unmodified
  // (calculator-invariants.md #8).
  it("AC8 — fee drag compounds through the share count", () => {
    const result = project(
      makeInput({
        initialShares: 1000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0,
        termYears: 3,
        growthBasis: "gross-of-expense-ratio",
        expenseRatioAnnual: 0.01,
      })
    );
    expect(result.rows[1].closingValueNzd).toBeCloseTo(9_900, 6);
    expect(result.rows[2].closingValueNzd).toBeCloseTo(9_801, 6);
    expect(result.rows[3].closingValueNzd).toBeCloseTo(9_702.99, 6);
    expect(result.rows[1].closingShares).toBeCloseTo(990, 6);
    expect(result.rows[2].closingShares).toBeCloseTo(980.1, 6);
    expect(result.rows[3].closingShares).toBeCloseTo(970.299, 6);
  });

  // AC8b: the fee base is the post-DRIP closing value, not opening value — AC8's g=0,
  // no-dividend fixture can't tell the two apart since they're equal there (review.md F2).
  // With g 0.10 and a dividend: closingPrice 11, dividend 500 → 1000 + 500/11 shares,
  // valueBeforeFees = 11,500 exactly (not the 10,000 opening value); expenseFee = 1% × 11,500 =
  // 115, platformFee = 0.2% × 11,500 = 23.
  it("AC8b — fee base is the post-DRIP closing value, not opening value", () => {
    const result = project(
      makeInput({
        initialShares: 1000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.5,
        growthBasis: "gross-of-expense-ratio",
        expenseRatioAnnual: 0.01,
        platformFeeAnnualRate: 0.002,
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
    const row = result.rows[1];
    expect(row.expenseFeeNzd).toBeCloseTo(115, 6);
    expect(row.platformFeeNzd).toBeCloseTo(23, 6);
  });

  // AC9: brokerage and FX spread are charged on every contribution (calculator-invariants.md #9).
  it("AC9 — brokerage and FX spread are charged on every contribution", () => {
    const base = makeInput({
      initialShares: 0,
      initialSharePriceNzd: 10,
      sharePriceGrowth: 0,
      termYears: 1,
      contributionsPerYear: 4,
      contributionPerEventNzd: 1_000,
      brokeragePerContributionNzd: 3,
      fxSpreadRate: 0.005,
      contributionTiming: "end",
    });
    const withFx = project(base);
    expect(withFx.rows[1].brokerageFeeNzd).toBeCloseTo(12, 6);
    expect(withFx.rows[1].fxSpreadCostNzd).toBeCloseTo(19.94, 6);
    expect(withFx.rows[1].contributionsGrossNzd).toBeCloseTo(4_000, 6);
    expect(withFx.rows[1].contributionsInvestedNzd).toBeCloseTo(3_968.06, 6);
    expect(withFx.rows[1].closingValueNzd).toBeCloseTo(3_968.06, 6);

    const withoutFx = project({ ...base, fxSpreadRate: 0 });
    expect(withoutFx.rows[1].contributionsInvestedNzd).toBeCloseTo(3_988, 6);
  });

  // AC10: contributions are not returns (calculator-invariants.md #12).
  it("AC10 — contributions are not returns", () => {
    const result = project(
      makeInput({
        initialShares: 1000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0,
        termYears: 2,
        contributionPerEventNzd: 1_000,
      })
    );
    expect(result.finalValueNzd).toBeCloseTo(12_000, 6);
    expect(result.totalContributionsNzd).toBeCloseTo(2_000, 6);
    expect(result.netGainNzd).toBeCloseTo(0, 6);
  });

  // AC11: FIF taxes the opening market value; DRIP is taxed in the year it arises
  // (calculator-invariants.md #11, nz-tax.md "Tax on reinvested dividends").
  it("AC11 — FIF taxes opening market value; DRIP is taxed in the year it arises", () => {
    const result = project(
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
    const row = result.rows[1];
    expect(row.grossDividendsNzd).toBeCloseTo(5_500, 6);
    expect(row.usWithholdingNzd).toBeCloseTo(825, 6);
    expect(row.dividendsReinvestedNzd).toBeCloseTo(4_675, 6);
    expect(row.closingValueNzd).toBeCloseTo(114_675, 6);
    // costBasis already includes this year's purchases (pseudocode: "costBasis += purchases"
    // precedes the tax call) — the delta from the 100,000 opening cost is the purchases figure
    // actually fed to computeAnnualTax.
    expect(row.costBasisNzd - 100_000).toBeCloseTo(4_675, 6);
    expect(row.costBasisNzd).toBeCloseTo(104_675, 6);
    expect(row.taxMethod).toBe("fdr");
    expect(row.taxableIncomeNzd).toBeCloseTo(5_000, 6);
    expect(row.nzTaxPayableNzd).toBeCloseTo(825, 6);
    expect(row.totalTaxNzd).toBeCloseTo(1_650, 6);
  });

  // AC12: only nzTaxPayableNzd is settled from the portfolio — deducting totalTaxNzd would
  // double-charge the already-withheld US tax (calculator-invariants.md #11).
  it("AC12 — only nzTaxPayableNzd is settled from the portfolio, not totalTaxNzd", () => {
    const result = project(
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
    const row = result.rows[1];
    expect(row.closingShares).toBeCloseTo(10_350, 6);
    expect(row.closingValueAfterTaxNzd).toBeCloseTo(113_850, 6);
  });

  // AC13: a reinvested dividend counts as a purchase in the CV base. `purchasesNzd` is pinned
  // directly (review.md F1) — the costBasisNzd-delta proxy previously used here cannot
  // distinguish "DRIP included" from "DRIP omitted" in this fixture, because FDR 5,000 is the
  // lower figure either way (CV 15,500 with the DRIP, 20,175 without) — AC13b below is the
  // fixture where the FDR/CV choice actually flips (calculator-invariants.md #11, "Comparative
  // Value").
  it("AC13 — a reinvested dividend counts as a purchase in the CV base", () => {
    const result = project(
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
    const row = result.rows[1];
    expect(row.purchasesNzd).toBeCloseTo(4_675, 6);
    const purchasesFedToTax = row.costBasisNzd - 100_000;
    expect(purchasesFedToTax).toBeCloseTo(4_675, 6);
    expect(row.taxMethod).toBe("fdr");
    expect(row.taxableIncomeNzd).toBeCloseTo(5_000, 6);
  });

  // AC13b: a discriminating fixture for the same invariant — AC13's growth (+10%) leaves CV above
  // FDR whether or not the DRIP is in the CV base, so it can't catch the DRIP being dropped from
  // `purchasesNzd`. A falling share price (-1%) does: with the DRIP in the CV base, CV = 4,500 <
  // FDR 5,000 → "cv"; omit the DRIP and CV rises to 9,175 > FDR 5,000 → flips to "fdr" (review.md
  // F1, reviewer-supplied fixture).
  it("AC13b — omitting the DRIP from the CV base would flip FDR/CV here", () => {
    const result = project(
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: -0.01,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
    const row = result.rows[1];
    expect(row.closingValueNzd).toBeCloseTo(103_675, 6);
    expect(row.purchasesNzd).toBeCloseTo(4_675, 6);
    expect(row.costBasisNzd).toBeCloseTo(104_675, 6);
    expect(row.taxMethod).toBe("cv");
    expect(row.taxableIncomeNzd).toBeCloseTo(4_500, 6);
    expect(row.nzTaxPayableNzd).toBeCloseTo(660, 6);
    expect(row.totalTaxNzd).toBeCloseTo(1_485, 6);
  });

  // AC14: the wrapper is passed through, never re-derived (calculator-invariants.md #10).
  it("AC14 — the wrapper is passed through, never re-derived", () => {
    const result = project(
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "pie",
        pir: 0.33,
        marginalRate: 0.33,
      })
    );
    const row = result.rows[1];
    expect(row.taxableIncomeNzd).toBeCloseTo(5_000, 6);
    expect(row.nzTaxPayableNzd).toBeCloseTo(575, 6);
    expect(row.closingValueAfterTaxNzd).toBeCloseTo(114_100, 6);
  });

  // AC15: the de minimis crosses mid-projection and tests cost, not market value (nz-tax.md
  // "Threshold crossing matters").
  it("AC15 — the de minimis crosses mid-projection and tests cost, not market value", () => {
    const result = project(
      makeInput({
        initialShares: 4_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 2,
        contributionPerEventNzd: 6_600,
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
    const y1 = result.rows[1];
    expect(y1.costBasisNzd).toBeCloseTo(46_600, 6);
    expect(y1.aboveThreshold).toBe(false);
    expect(y1.taxRegime).toBe("dividend");
    expect(y1.nzTaxPayableNzd).toBeCloseTo(0, 6);
    expect(y1.closingValueNzd).toBeCloseTo(51_260, 6);

    const y2 = result.rows[2];
    expect(y2.costBasisNzd).toBeCloseTo(53_200, 6);
    expect(y2.aboveThreshold).toBe(true);
    expect(y2.taxRegime).toBe("fif");
    expect(y2.taxMethod).toBe("fdr");
    expect(y2.taxableIncomeNzd).toBeCloseTo(2_563, 6);
    expect(y2.nzTaxPayableNzd).toBeCloseTo(845.79, 2);
    expect(y2.closingValueAfterTaxNzd).toBeCloseTo(62_800.21, 2);
  });

  // AC16: golden 2-year end-to-end — pins the whole loop against a hand-computed spreadsheet
  // (calculator-invariants.md #16).
  it("AC16 — golden 2-year end-to-end", () => {
    const result = project(
      makeInput({
        initialShares: 1000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 2,
        initialDividendPerShareNzd: 0.5,
        dividendGrowth: 0.1,
        contributionPerEventNzd: 1_100,
        contributionTiming: "start",
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
    const y1 = result.rows[1];
    expect(y1.closingShares).toBeCloseTo(1_147.185, 6);
    expect(y1.dividendPerShareNzd).toBeCloseTo(0.55, 10);
    expect(y1.grossDividendsNzd).toBeCloseTo(610.5, 6);
    expect(y1.closingValueNzd).toBeCloseTo(12_820.5, 6);
    expect(y1.nzTaxPayableNzd).toBeCloseTo(201.465, 6);
    expect(y1.closingValueAfterTaxNzd).toBeCloseTo(12_619.035, 6);

    const y2 = result.rows[2];
    expect(y2.dividendPerShareNzd).toBeCloseTo(0.605, 10);
    expect(y2.grossDividendsNzd).toBeCloseTo(754.546925, 6);
    expect(y2.closingValueNzd).toBeCloseTo(15_845.485425, 6);
    expect(y2.nzTaxPayableNzd).toBeCloseTo(249.000485, 6);
    expect(y2.closingValueAfterTaxNzd).toBeCloseTo(15_596.48494, 6);

    expect(result.totalContributionsNzd).toBeCloseTo(2_200, 6);
    expect(result.totalTaxNzd).toBeCloseTo(450.465485, 6);
    expect(result.netGainNzd).toBeCloseTo(3_396.48494, 6);
  });

  // AC17: a missing assumption fails loudly — no projection runs on a null sharePriceGrowth
  // (calculator-invariants.md "failure mode to fear").
  it("AC17 — a missing assumption fails loudly, never substitutes 0", () => {
    const rest: Omit<ProjectionInput, "sharePriceGrowth"> = {
      termYears: 1,
      compoundingPeriodsPerYear: 1,
      contributionsPerYear: 1,
      contributionTiming: "start",
      initialShares: 0,
      initialSharePriceNzd: 10,
      contributionPerEventNzd: 0,
      initialDividendPerShareNzd: 0,
      dividendGrowth: 0,
      growthBasis: "net-of-expense-ratio",
      expenseRatioAnnual: 0,
      platformFeeAnnualRate: 0,
      brokeragePerContributionNzd: 0,
      fxSpreadRate: 0,
      usWithholdingRate: 0,
      wrapper: "direct",
      marginalRate: 0.33,
    };
    expect(() => projectFund(getFund("VYMI"), rest)).toThrow(MissingAssumptionError);
    expect(() => projectFund(getFund("FDVV"), rest)).toThrow(MissingAssumptionError);
    expect(() => project(makeInput({ sharePriceGrowth: NaN }))).toThrow(ProjectionInputError);
  });

  // AC18: invalid input throws, nothing is coerced to 0 (calculator-invariants.md #14).
  it("AC18 — invalid input throws, nothing is coerced to 0", () => {
    expect(() => project(makeInput({ initialShares: -1 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ initialDividendPerShareNzd: Infinity }))).toThrow(
      ProjectionInputError
    );
    expect(() => project(makeInput({ initialSharePriceNzd: 0 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ initialSharePriceNzd: -5 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ termYears: 0 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ termYears: 1.5 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ compoundingPeriodsPerYear: 0 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ contributionsPerYear: 0 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ platformFeeAnnualRate: 1 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ fxSpreadRate: -0.1 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ sharePriceGrowth: 12.37 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ usWithholdingRate: 33 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ sharePriceGrowth: -1 }))).toThrow(ProjectionInputError);
    expect(() => project(makeInput({ dividendGrowth: -1 }))).toThrow(ProjectionInputError);
    expect(() =>
      project(makeInput({ contributionTiming: "middle" as unknown as "start" }))
    ).toThrow(ProjectionInputError);
    expect(() =>
      project(makeInput({ growthBasis: "bogus" as unknown as "net-of-expense-ratio" }))
    ).toThrow(ProjectionInputError);

    // TaxInputError from computeAnnualTax propagates unwrapped — not re-thrown as
    // ProjectionInputError — because tax-field validation is nzTax.ts's concern, not this
    // module's (Constitution §2, one engine per concern).
    let thrown: unknown;
    try {
      project(makeInput({ wrapper: "pie", pir: undefined }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TaxInputError);
    expect(thrown).not.toBeInstanceOf(ProjectionInputError);
  });

  // AC19: no NaN/Infinity escapes any row or the summary, for every fixture above plus the
  // degenerate cases (calculator-invariants.md #13). Previously only 3 of 16 fixtures were run
  // through this check — tax, brokerage/FX and fee paths were never finiteness-checked
  // (review.md F3). Each fixture below is the exact input from its named AC.
  it("AC19 — no NaN/Infinity escapes any row or the summary", () => {
    const fixtures: ProjectionInput[] = [
      // AC1/AC2 — N-year compounding.
      makeInput({ initialShares: 1_000, initialSharePriceNzd: 10, sharePriceGrowth: 0.1, termYears: 3 }),
      // AC3 — deposit cadence independent of the growth model.
      makeInput({
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 2,
        contributionPerEventNzd: 100,
        contributionsPerYear: 12,
      }),
      // AC4 — per-event contribution timing.
      makeInput({
        initialShares: 0,
        initialSharePriceNzd: 100,
        sharePriceGrowth: 0.21,
        termYears: 1,
        contributionsPerYear: 2,
        contributionPerEventNzd: 121,
        contributionTiming: "end",
      }),
      // AC6 — dividend grown per share.
      makeInput({
        initialShares: 1_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 3,
        initialDividendPerShareNzd: 0.5,
        dividendGrowth: 0.2,
      }),
      // AC7 — gross-of-expense-ratio expense charge.
      makeInput({
        initialShares: 1_000,
        initialSharePriceNzd: 10,
        termYears: 2,
        growthBasis: "gross-of-expense-ratio",
        expenseRatioAnnual: 0.0006,
      }),
      // AC8 — fee drag through the share count.
      makeInput({
        initialShares: 1_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0,
        termYears: 3,
        growthBasis: "gross-of-expense-ratio",
        expenseRatioAnnual: 0.01,
      }),
      // AC8b — fee base with non-zero growth and a dividend (F2).
      makeInput({
        initialShares: 1_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.5,
        growthBasis: "gross-of-expense-ratio",
        expenseRatioAnnual: 0.01,
        platformFeeAnnualRate: 0.002,
        wrapper: "direct",
        marginalRate: 0.33,
      }),
      // AC9 — brokerage and FX spread, charged per contribution.
      makeInput({
        initialShares: 0,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0,
        termYears: 1,
        contributionsPerYear: 4,
        contributionPerEventNzd: 1_000,
        brokeragePerContributionNzd: 3,
        fxSpreadRate: 0.005,
        contributionTiming: "end",
      }),
      // AC10 — contributions are not returns.
      makeInput({
        initialShares: 1_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0,
        termYears: 2,
        contributionPerEventNzd: 1_000,
      }),
      // AC11/AC12/AC13 — FIF, FDR tax path.
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "direct",
        marginalRate: 0.33,
      }),
      // AC13b — FIF, CV tax path (F1 discriminating fixture).
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: -0.01,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "direct",
        marginalRate: 0.33,
      }),
      // AC14 — PIE wrapper tax path.
      makeInput({
        initialShares: 10_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 1,
        initialDividendPerShareNzd: 0.55,
        usWithholdingRate: 0.15,
        wrapper: "pie",
        pir: 0.33,
        marginalRate: 0.33,
      }),
      // AC15 — de minimis crossing mid-projection.
      makeInput({
        initialShares: 4_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 2,
        contributionPerEventNzd: 6_600,
        wrapper: "direct",
        marginalRate: 0.33,
      }),
      // AC16 — golden 2-year end-to-end.
      makeInput({
        initialShares: 1_000,
        initialSharePriceNzd: 10,
        sharePriceGrowth: 0.1,
        termYears: 2,
        initialDividendPerShareNzd: 0.5,
        dividendGrowth: 0.1,
        contributionPerEventNzd: 1_100,
        contributionTiming: "start",
        wrapper: "direct",
        marginalRate: 0.33,
      }),
      // Degenerate cases: termYears 1, initialShares 0, contributionPerEventNzd 0, g 0, d0 0 — all
      // defaults in makeInput() already.
      makeInput({ termYears: 1 }),
    ];
    for (const fixture of fixtures) {
      assertAllFinite(project(fixture));
    }
    // AC5 — projectFund's fund-derived growth path.
    assertAllFinite(
      projectFund(getFund("SCHD"), {
        termYears: 1,
        compoundingPeriodsPerYear: 1,
        contributionsPerYear: 1,
        contributionTiming: "start",
        initialShares: 0,
        initialSharePriceNzd: 10,
        contributionPerEventNzd: 0,
        initialDividendPerShareNzd: 0,
        dividendGrowth: 0,
        growthBasis: "net-of-expense-ratio",
        expenseRatioAnnual: 0,
        platformFeeAnnualRate: 0,
        brokeragePerContributionNzd: 0,
        fxSpreadRate: 0,
        usWithholdingRate: 0,
        wrapper: "direct",
        marginalRate: 0.33,
      })
    );
  });
});
