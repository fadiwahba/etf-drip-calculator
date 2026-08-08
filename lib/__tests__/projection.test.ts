import { describe, it, expect } from "vitest";
import {
  project,
  projectFund,
  toRealTerms,
  findIncomeCrossover,
  ProjectionInputError,
  type ProjectionInput,
  type ProjectionResult,
  type ProjectionRow,
  type IncomeCrossover,
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

// features/three-phase-projection/spec.md ACs 1-9. Named fixtures P/Q/R follow the spec's
// convention verbatim (unlisted inputs zero / net basis / timing "start" / contributionsPerYear 1).
describe("three-phase-projection", () => {
  function makeFixtureP(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
    return makeInput({
      initialShares: 1_000,
      initialSharePriceNzd: 10,
      sharePriceGrowth: 0.1,
      termYears: 2,
      initialDividendPerShareNzd: 0.55,
      dividendGrowth: 0,
      contributionPerEventNzd: 1_100,
      wrapper: "direct",
      marginalRate: 0.33,
      usWithholdingRate: 0,
      ...overrides,
    });
  }

  function makeFixtureQ(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
    return makeInput({
      initialShares: 10_000,
      initialSharePriceNzd: 10,
      sharePriceGrowth: 0.1,
      termYears: 1,
      initialDividendPerShareNzd: 0.55,
      usWithholdingRate: 0.15,
      wrapper: "direct",
      marginalRate: 0.33,
      ...overrides,
    });
  }

  function makeFixtureR(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
    return makeInput({
      initialShares: 10_000,
      initialSharePriceNzd: 10,
      sharePriceGrowth: 0.1,
      termYears: 2,
      initialDividendPerShareNzd: 0.55,
      dividendGrowth: 0,
      contributionPerEventNzd: 1_000,
      usWithholdingRate: 0.15,
      wrapper: "direct",
      marginalRate: 0.33,
      ...overrides,
    });
  }

  // 3PP-AC1: purely-additive contract — omitting both new fields must reproduce the
  // projection-engine AC16 golden fixture exactly, plus the new fields' inert defaults.
  it("3PP-AC1 — omitting both fields reproduces today's output exactly", () => {
    const result = project(
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
      })
    );
    const y1 = result.rows[1];
    expect(y1.closingValueNzd).toBeCloseTo(12_820.5, 6);
    expect(y1.nzTaxPayableNzd).toBeCloseTo(201.465, 6);
    expect(y1.closingValueAfterTaxNzd).toBeCloseTo(12_619.035, 6);
    expect(y1.closingShares).toBeCloseTo(1_147.185, 6);

    const y2 = result.rows[2];
    expect(y2.grossDividendsNzd).toBeCloseTo(754.546925, 6);
    expect(y2.closingValueNzd).toBeCloseTo(15_845.485425, 6);
    expect(y2.nzTaxPayableNzd).toBeCloseTo(249.000485, 6);
    expect(y2.closingValueAfterTaxNzd).toBeCloseTo(15_596.48494, 6);

    expect(result.totalContributionsNzd).toBeCloseTo(2_200, 6);
    expect(result.totalTaxNzd).toBeCloseTo(450.465485, 6);
    expect(result.netGainNzd).toBeCloseTo(3_396.48494, 6);

    for (const row of result.rows) {
      expect(row.phase).toBe("accumulate");
      expect(row.dividendsDrawnNzd).toBe(0);
    }
    expect(result.totalDividendsDrawnNzd).toBe(0);
  });

  // 3PP-AC2: a phase boundary beyond termYears is accepted and never starts — deep-equals the
  // AC1 result exactly (a `||`/inclusive-boundary bug would change some field here).
  it("3PP-AC2 — a value beyond the term is accepted and inert", () => {
    const base = makeInput({
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
    });
    const withoutFields = project(base);
    const beyondTerm = project({ ...base, contributionsStopYear: 99, drawdownStartYear: 99 });
    // Asserted ahead of the toEqual below: pre-implementation, `phase` is absent on both sides
    // (undefined === undefined) so toEqual alone can pass vacuously — this pins the concrete
    // value so the test genuinely reds before the phase field exists.
    expect(beyondTerm.rows[1].phase).toBe("accumulate");
    expect(beyondTerm.rows[2].phase).toBe("accumulate");
    expect(beyondTerm).toEqual(withoutFields);
  });

  // 3PP-AC3: Coast is empty by default (draw defaults to stop, so `contributionsStopYear` alone
  // resolves every year >= stop to "draw" — see spec.md's callout). A Coast year needs an explicit
  // later `drawdownStartYear`; 4 > termYears 2 so Coast runs through the end of the term.
  it("3PP-AC3 — Coast stops contributions but keeps the DRIP", () => {
    const result = project(makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 4 }));
    const y1 = result.rows[1];
    expect(y1.phase).toBe("accumulate");
    expect(y1.contributionsGrossNzd).toBeCloseTo(1_100, 6);
    expect(y1.closingValueAfterTaxNzd).toBeCloseTo(12_619.035, 6);

    const y2 = result.rows[2];
    expect(y2.phase).toBe("coast");
    expect(y2.contributionsGrossNzd).toBe(0);
    expect(y2.contributionsInvestedNzd).toBe(0);
    expect(y2.dividendsReinvestedNzd).toBeCloseTo(630.95175, 6);
    expect(y2.dividendsDrawnNzd).toBe(0);
    expect(y2.purchasesNzd).toBeCloseTo(630.95175, 6);
    expect(y2.closingValueNzd).toBeCloseTo(14_511.89025, 6);
    expect(y2.nzTaxPayableNzd).toBeCloseTo(208.2140775, 6);
    expect(y2.closingValueAfterTaxNzd).toBeCloseTo(14_303.6761725, 6);
    expect(y2.cumulativeContributionsNzd).toBeCloseTo(1_100, 6);
  });

  // 3PP-AC4: Draw pays the dividend out as cash; the share count is untouched by the dividend
  // itself, but the tax settlement (byte-identical in every phase) still runs against it —
  // closingShares is 1,129.977225, not the pre-tax 1,147.185.
  it("3PP-AC4 — Draw pays the dividend out; principal is untouched", () => {
    const coast = project(makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 4 }));
    const draw = project(makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 2 }));
    // Asserted ahead of the toEqual below: a bare toEqual would pass vacuously if `phase` were
    // missing on both sides, so pin the concrete value first.
    expect(draw.rows[1].phase).toBe("accumulate");
    expect(draw.rows[1]).toEqual(coast.rows[1]);

    const y2 = draw.rows[2];
    expect(y2.phase).toBe("draw");
    expect(y2.grossDividendsNzd).toBeCloseTo(630.95175, 6);
    expect(y2.dividendsDrawnNzd).toBeCloseTo(630.95175, 6);
    expect(y2.dividendsReinvestedNzd).toBe(0);
    expect(y2.purchasesNzd).toBe(0);
    // Pre-tax closingValueNzd is 1,147.185 x 12.1 — the dividend bought no shares. closingShares
    // is only 1,129.977225 after the tax settlement (`shares -= nzTaxPayableNzd / closingPrice`,
    // 208.2140775 / 12.1) runs, exactly like in every other phase.
    expect(y2.closingValueNzd).toBeCloseTo(13_880.9385, 6);
    expect(y2.closingShares).toBeCloseTo(1_129.977225, 6);
    expect(y2.closingValueAfterTaxNzd).toBeCloseTo(13_672.7244225, 6);
    expect(draw.totalDividendsDrawnNzd).toBeCloseTo(630.95175, 6);
  });

  // 3PP-AC5: below the de minimis, drawing changes nothing about the actual-dividends tax —
  // the closingValueAfterTaxNzd gap between coast and draw is exactly the drawn cash.
  it("3PP-AC5 — drawing does not change the tax below the de minimis", () => {
    const coast = project(makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 4 })).rows[2];
    const draw = project(makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 2 })).rows[2];
    expect(coast.taxRegime).toBe("dividend");
    expect(draw.taxRegime).toBe("dividend");
    expect(coast.taxableIncomeNzd).toBeCloseTo(630.95175, 6);
    expect(draw.taxableIncomeNzd).toBeCloseTo(630.95175, 6);
    expect(coast.nzTaxPayableNzd).toBeCloseTo(208.2140775, 6);
    expect(draw.nzTaxPayableNzd).toBeCloseTo(208.2140775, 6);
    expect(coast.closingValueAfterTaxNzd - draw.closingValueAfterTaxNzd).toBeCloseTo(630.95175, 6);
  });

  // 3PP-AC6: above the de minimis, FDR taxes opening market value, not dividends — drawing
  // changes neither, so the default and draw runs share identical tax figures.
  it("3PP-AC6 — drawing does not change the tax under FIF/FDR", () => {
    const base = project(makeFixtureQ());
    const draw = project(makeFixtureQ({ contributionsStopYear: 1, drawdownStartYear: 1 }));

    for (const r of [base.rows[1], draw.rows[1]]) {
      expect(r.taxMethod).toBe("fdr");
      expect(r.taxableIncomeNzd).toBeCloseTo(5_000, 6);
      expect(r.nzTaxPayableNzd).toBeCloseTo(825, 6);
      expect(r.totalTaxNzd).toBeCloseTo(1_650, 6);
      expect(r.grossDividendsNzd).toBeCloseTo(5_500, 6);
      expect(r.usWithholdingNzd).toBeCloseTo(825, 6);
    }

    const y1 = draw.rows[1];
    expect(y1.dividendsDrawnNzd).toBeCloseTo(4_675, 6);
    expect(y1.closingValueNzd).toBeCloseTo(110_000, 6);
    expect(y1.costBasisNzd).toBeCloseTo(100_000, 6);
    expect(y1.closingShares).toBeCloseTo(9_925, 6);
    expect(y1.closingValueAfterTaxNzd).toBeCloseTo(109_175, 6);
    expect(base.rows[1].closingValueAfterTaxNzd - y1.closingValueAfterTaxNzd).toBeCloseTo(4_675, 6);
  });

  // 3PP-AC7: contributionsStopYear 0 is the decumulator persona, not "unset" — a `||`-style
  // falsy check would treat 0 as absent and fail every figure in this fixture.
  it("3PP-AC7 — contributionsStopYear 0 is the decumulator, not unset", () => {
    const result = project(makeFixtureR({ contributionsStopYear: 0 }));
    for (const row of result.rows) {
      expect(row.phase).toBe("draw");
    }
    expect(result.totalContributionsNzd).toBe(0);

    const y1 = result.rows[1];
    expect(y1.dividendsDrawnNzd).toBeCloseTo(4_675, 6);
    expect(y1.closingValueNzd).toBeCloseTo(110_000, 6);
    expect(y1.nzTaxPayableNzd).toBeCloseTo(825, 6);
    expect(y1.closingValueAfterTaxNzd).toBeCloseTo(109_175, 6);

    const y2 = result.rows[2];
    expect(y2.openingValueNzd).toBeCloseTo(109_175, 6);
    expect(y2.grossDividendsNzd).toBeCloseTo(5_458.75, 6);
    expect(y2.usWithholdingNzd).toBeCloseTo(818.8125, 6);
    expect(y2.dividendsDrawnNzd).toBeCloseTo(4_639.9375, 6);
    expect(y2.closingValueNzd).toBeCloseTo(120_092.5, 6);
    expect(y2.taxMethod).toBe("fdr");
    expect(y2.taxableIncomeNzd).toBeCloseTo(5_458.75, 6);
    expect(y2.nzTaxPayableNzd).toBeCloseTo(982.575, 6);
    expect(y2.closingValueAfterTaxNzd).toBeCloseTo(119_109.925, 6);

    expect(result.totalDividendsDrawnNzd).toBeCloseTo(9_314.9375, 6);
    expect(result.netGainNzd).toBeCloseTo(19_109.925, 6);
  });

  // 3PP-AC8: invalid phase input throws, never clamps or coerces (invariant 14).
  it("3PP-AC8 — invalid phase input throws, nothing is clamped or coerced", () => {
    const invalidCases: Array<Partial<ProjectionInput>> = [
      { contributionsStopYear: 2.5 },
      { contributionsStopYear: -1 },
      { contributionsStopYear: NaN },
      { contributionsStopYear: Infinity },
      { drawdownStartYear: 2.5 },
      { drawdownStartYear: -1 },
      { drawdownStartYear: NaN },
      { drawdownStartYear: Infinity },
    ];
    for (const overrides of invalidCases) {
      expect(() => project(makeInput(overrides)), JSON.stringify(overrides)).toThrow(
        ProjectionInputError
      );
    }

    let crossFieldThrown: unknown;
    try {
      project(makeInput({ contributionsStopYear: 3, drawdownStartYear: 2 }));
    } catch (e) {
      crossFieldThrown = e;
    }
    expect(crossFieldThrown).toBeInstanceOf(ProjectionInputError);
    expect((crossFieldThrown as Error).message).toMatch(/contributionsStopYear/);
    expect((crossFieldThrown as Error).message).toMatch(/drawdownStartYear/);

    let omittedStopThrown: unknown;
    try {
      project(makeInput({ drawdownStartYear: 5 }));
    } catch (e) {
      omittedStopThrown = e;
    }
    expect(omittedStopThrown).toBeInstanceOf(ProjectionInputError);
    expect((omittedStopThrown as Error).message).toMatch(/contributionsStopYear/);
    expect((omittedStopThrown as Error).message).toMatch(/drawdownStartYear/);

    expect(() => project(makeInput({ contributionsStopYear: 0 }))).not.toThrow();
  });

  // 3PP-AC9: no NaN/Infinity escapes the new fields, reusing the file's existing runtime-enumerated
  // finiteness check (covers dividendsDrawnNzd/totalDividendsDrawnNzd automatically).
  it("3PP-AC9 — no NaN/Infinity escapes the new paths", () => {
    // F2 (review.md, features/inflation-real-terms/spec.md AC15): the original first fixture ran
    // the exact same Draw scenario as the line below and never finiteness-checked Coast at all —
    // replaced with a genuine Coast fixture, pinned by `rows[2].phase` so it cannot silently drift
    // back to Draw/Accumulate and go uncovered again.
    const coastResult = project(makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 4 }));
    expect(coastResult.rows[2].phase).toBe("coast");
    assertAllFinite(coastResult);
    assertAllFinite(project(makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 2 })));
    assertAllFinite(project(makeFixtureQ({ contributionsStopYear: 1, drawdownStartYear: 1 })));
    assertAllFinite(project(makeFixtureR({ contributionsStopYear: 0 })));
    assertAllFinite(project(makeInput({ termYears: 1, contributionsStopYear: 0 })));
  });

  // features/inflation-real-terms/spec.md ACs 1-8, 14, 16. Real vs nominal is a VIEW over an
  // existing project() result (spec R1) — every fixture here reuses this file's
  // makeFixtureP/makeFixtureR rather than adding a fourth tax/fee model (Constitution §2). Nested
  // inside "three-phase-projection" so these fixtures (function-scoped to that describe callback)
  // are in scope, rather than duplicating them at module level.
  describe("inflation-real-terms", () => {
    // AC1: i = 0 is the identity. A `(1+i)^t` deflator of 1 must leave every field byte-identical
    // to the nominal path — this does not exercise the exponent itself (AC2/AC3 do that), but it
    // does catch a deflator applied to a field the spec says must never move (e.g. costBasisNzd).
    it("AC1 — i = 0 is the identity", () => {
      const nominal = project(makeFixtureP());
      const real = toRealTerms(nominal, 0);

      expect(real.inflationRate).toBe(0);
      expect(real.rows.length).toBe(nominal.rows.length);
      for (let i = 0; i < real.rows.length; i++) {
        const { purchasingPowerLostNzd, ...rest } = real.rows[i];
        void purchasingPowerLostNzd;
        expect(rest).toEqual(nominal.rows[i]);
        expect(real.rows[i].purchasingPowerLostNzd).toBe(0);
      }
      expect(real.initialInvestmentNzd).toEqual(nominal.initialInvestmentNzd);
      expect(real.totalContributionsNzd).toEqual(nominal.totalContributionsNzd);
      expect(real.finalValueNzd).toEqual(nominal.finalValueNzd);
      expect(real.totalFeesNzd).toEqual(nominal.totalFeesNzd);
      expect(real.totalTaxNzd).toEqual(nominal.totalTaxNzd);
      expect(real.netGainNzd).toEqual(nominal.netGainNzd);
      expect(real.totalDividendsDrawnNzd).toEqual(nominal.totalDividendsDrawnNzd);
    });

    // AC2: the deflator and its two exponents (t for closing/flow fields, t-1 for opening fields,
    // year 0 pinned to exponent 0 either way) — P at i = 0.10 for round numbers.
    it("AC2 — deflator and exponents, P at i = 0.10", () => {
      const nominal = project(makeFixtureP());
      const real = toRealTerms(nominal, 0.1);

      const { purchasingPowerLostNzd: y0Memo, ...y0Rest } = real.rows[0];
      void y0Memo;
      expect(y0Rest).toEqual(nominal.rows[0]);
      expect(real.rows[0].purchasingPowerLostNzd).toBe(0);

      const y1 = real.rows[1];
      expect(y1.openingValueNzd).toBeCloseTo(10_000, 6);
      expect(y1.openingSharePriceNzd).toBeCloseTo(10, 6);
      expect(y1.closingSharePriceNzd).toBeCloseTo(10, 6);
      expect(y1.contributionsGrossNzd).toBeCloseTo(1_000, 6);
      expect(y1.dividendPerShareNzd).toBeCloseTo(0.5, 6);
      expect(y1.grossDividendsNzd).toBeCloseTo(555, 6);
      expect(y1.closingValueNzd).toBeCloseTo(11_655, 6);
      expect(y1.purchasesNzd).toBeCloseTo(1_555, 6);
      expect(y1.taxableIncomeNzd).toBeCloseTo(555, 6);
      expect(y1.nzTaxPayableNzd).toBeCloseTo(183.15, 6);
      expect(y1.closingValueAfterTaxNzd).toBeCloseTo(11_471.85, 6);
      expect(y1.cumulativeContributionsNzd).toBeCloseTo(1_000, 6);

      const y2 = real.rows[2];
      // Chain check: y2's real openingValueNzd must equal y1's real closingValueAfterTaxNzd —
      // a `(1+i)^t` mistake on the opening fields would give 10,428.13 here instead.
      expect(y2.openingValueNzd).toBeCloseTo(11_471.85, 6);
      expect(y2.openingSharePriceNzd).toBeCloseTo(10, 6);
      expect(y2.closingSharePriceNzd).toBeCloseTo(10, 6);
      expect(y2.contributionsGrossNzd).toBeCloseTo(909.090909, 6);
      expect(y2.grossDividendsNzd).toBeCloseTo(566.902273, 6);
      expect(y2.closingValueNzd).toBeCloseTo(13_038.752273, 6);
      expect(y2.nzTaxPayableNzd).toBeCloseTo(187.07775, 6);
      expect(y2.closingValueAfterTaxNzd).toBeCloseTo(12_851.674523, 6);
      expect(y2.cumulativeContributionsNzd).toBeCloseTo(1_909.090909, 6);
    });

    // AC3: the deflator is the inflation rate, never sharePriceGrowth — P has g = 0.10, so AC2's
    // i = 0.10 cannot tell a `sharePriceGrowth` mix-up apart from a correct `inflationRate` use.
    // i = 0.03 (g != i) is what kills that mutation.
    it("AC3 — the deflator uses the inflation rate, not the growth rate (i = 0.03)", () => {
      const nominal = project(makeFixtureP());
      const real = toRealTerms(nominal, 0.03);

      const y1 = real.rows[1];
      expect(y1.closingValueAfterTaxNzd).toBeCloseTo(12_251.490291, 6);
      expect(y1.purchasingPowerLostNzd).toBeCloseTo(367.544709, 6);

      const y2 = real.rows[2];
      expect(y2.closingValueAfterTaxNzd).toBeCloseTo(14_657.862355, 6);
      expect(y2.purchasingPowerLostNzd).toBeCloseTo(892.663817, 6);
    });

    // AC4: non-money fields (counts, a statutory base, and enum-ish fields) pass straight through,
    // Object.is against the nominal row — not merely close, byte-identical.
    it("AC4 — non-money fields pass through untouched", () => {
      const nominal = project(makeFixtureP());
      const real = toRealTerms(nominal, 0.1);

      for (let i = 0; i < real.rows.length; i++) {
        const n = nominal.rows[i];
        const r = real.rows[i];
        expect(Object.is(r.openingShares, n.openingShares)).toBe(true);
        expect(Object.is(r.closingShares, n.closingShares)).toBe(true);
        expect(Object.is(r.costBasisNzd, n.costBasisNzd)).toBe(true);
        expect(Object.is(r.year, n.year)).toBe(true);
        expect(Object.is(r.phase, n.phase)).toBe(true);
        expect(Object.is(r.taxRegime, n.taxRegime)).toBe(true);
        expect(Object.is(r.taxMethod, n.taxMethod)).toBe(true);
        expect(Object.is(r.aboveThreshold, n.aboveThreshold)).toBe(true);
      }
      expect(real.rows[1].closingShares).toBeCloseTo(1_147.185, 6);
      expect(real.rows[2].closingShares).toBeCloseTo(1_285.1674522727273, 6);
      expect(real.rows[1].costBasisNzd).toBeCloseTo(11_710.5, 6);
      expect(real.rows[2].costBasisNzd).toBeCloseTo(13_496.45175, 6);
    });

    // AC5: the memo is a read-only difference, never subtracted from a balance or summed into a
    // fee/tax total, and there is no `totalPurchasingPowerLostNzd` (summing balances across years
    // would double-count).
    it("AC5 — purchasing power lost is a memo, not an outflow", () => {
      const nominal = project(makeFixtureP());
      const real = toRealTerms(nominal, 0.1);

      for (let i = 0; i < real.rows.length; i++) {
        const expectedMemo =
          nominal.rows[i].closingValueAfterTaxNzd - real.rows[i].closingValueAfterTaxNzd;
        expect(real.rows[i].purchasingPowerLostNzd).toBeCloseTo(expectedMemo, 6);
      }
      expect(real.rows[0].purchasingPowerLostNzd).toBe(0);
      expect(real.rows[1].purchasingPowerLostNzd).toBeCloseTo(1_147.185, 6);
      expect(real.rows[2].purchasingPowerLostNzd).toBeCloseTo(2_698.85165, 6);
      expect(real.totalFeesNzd).toBe(0);
      expect(real.totalTaxNzd).toBeCloseTo(370.22775, 6);
      expect(real.rows[2].closingValueAfterTaxNzd).toBeCloseTo(12_851.674523, 6);
      expect("totalPurchasingPowerLostNzd" in real).toBe(false);
    });

    // AC6: real summary totals are PV sums of the deflated rows, never one deflator applied to the
    // nominal total — the "not" assertions pin the specific wrong-but-plausible numbers a single
    // end-deflator would produce.
    it("AC6 — real totals are PV sums, not one deflated total", () => {
      const real = toRealTerms(project(makeFixtureP()), 0.1);

      expect(real.initialInvestmentNzd).toBe(10_000);
      expect(real.finalValueNzd).toBeCloseTo(12_851.674523, 6);
      expect(real.totalContributionsNzd).toBeCloseTo(1_909.090909, 6);
      expect(real.totalContributionsNzd).not.toBeCloseTo(1_818.181818, 3);
      expect(real.totalTaxNzd).toBeCloseTo(370.22775, 6);
      expect(real.totalTaxNzd).not.toBeCloseTo(353.57775, 3);
      expect(real.totalFeesNzd).toBe(0);
      expect(real.totalDividendsDrawnNzd).toBe(0);
      expect(real.netGainNzd).toBeCloseTo(942.583614, 6);
      expect(real.inflationRate).toBe(0.1);
    });

    // AC7: contributions are a fixed nominal dollar amount — the engine invests exactly that every
    // year, and the real view only shows it shrinking, never a different (indexed) figure.
    it("AC7 — contributions are nominal; the real view shows them shrinking", () => {
      const nominal = project(makeFixtureP());
      const real = toRealTerms(nominal, 0.1);

      expect(nominal.rows[1].contributionsGrossNzd).toBeCloseTo(1_100, 6);
      expect(nominal.rows[2].contributionsGrossNzd).toBeCloseTo(1_100, 6);
      expect(real.rows[1].contributionsGrossNzd).toBeCloseTo(1_000, 6);
      expect(real.rows[2].contributionsGrossNzd).toBeCloseTo(909.090909, 6);
    });

    // AC8: the rate is validated, nothing is clamped (invariant 14) — deflation (negative i) reads
    // as a gain in a column labelled "lost" (Constitution §1), so it is rejected, not floored to 0.
    it("AC8 — the rate is validated, nothing is clamped", () => {
      const nominal = project(makeFixtureP());
      for (const bad of [NaN, Infinity, -Infinity, -0.01, 1, 3]) {
        let thrown: unknown;
        try {
          toRealTerms(nominal, bad);
        } catch (e) {
          thrown = e;
        }
        expect(thrown, `inflationRate=${bad}`).toBeInstanceOf(ProjectionInputError);
        expect((thrown as Error).message, `inflationRate=${bad}`).toMatch(/inflationRate/);
      }
      expect(() => toRealTerms(nominal, 0)).not.toThrow();
      expect(() => toRealTerms(nominal, 0.999)).not.toThrow();
    });

    // AC14 — F1 (review.md, test-only): the fee drag is charged in every phase. Every existing
    // phase fixture before this had zero fees, so nothing pinned this. Fixture R with
    // platformFeeAnnualRate 0.01, run as Draw and Coast.
    it("AC14 — F1: the fee drag is charged in every phase (Fixture R, platformFeeAnnualRate 0.01)", () => {
      const draw = project(makeFixtureR({ contributionsStopYear: 0, platformFeeAnnualRate: 0.01 }));
      const coast = project(
        makeFixtureR({ contributionsStopYear: 0, drawdownStartYear: 4, platformFeeAnnualRate: 0.01 })
      );

      const drawY1 = draw.rows[1];
      expect(drawY1.totalFeesNzd).toBeCloseTo(1_100, 6);
      expect(drawY1.closingValueNzd).toBeCloseTo(108_900, 6);
      expect(drawY1.dividendsDrawnNzd).toBeCloseTo(4_675, 6);
      expect(drawY1.taxMethod).toBe("fdr");
      expect(drawY1.taxableIncomeNzd).toBeCloseTo(5_000, 6);
      expect(drawY1.nzTaxPayableNzd).toBeCloseTo(825, 6);
      expect(drawY1.closingShares).toBeCloseTo(9_825, 6);
      expect(drawY1.closingValueAfterTaxNzd).toBeCloseTo(108_075, 6);

      const coastY1 = coast.rows[1];
      expect(coastY1.totalFeesNzd).toBeCloseTo(1_146.75, 6);
      expect(coastY1.dividendsReinvestedNzd).toBeCloseTo(4_675, 6);
      expect(coastY1.closingValueNzd).toBeCloseTo(113_528.25, 6);
      expect(coastY1.nzTaxPayableNzd).toBeCloseTo(825, 6);
      expect(coastY1.closingShares).toBeCloseTo(10_245.75, 6);
      expect(coastY1.closingValueAfterTaxNzd).toBeCloseTo(112_703.25, 6);

      for (const row of [...draw.rows, ...coast.rows]) {
        if (row.year === 0) continue;
        expect(row.totalFeesNzd / (row.closingValueNzd + row.totalFeesNzd)).toBeCloseTo(0.01, 12);
      }
    });

    // AC16: no NaN/Infinity escapes toRealTerms, reusing the file's existing runtime-enumerated
    // finiteness check across P at every pinned rate, R with contributionsStopYear 0, and a
    // 1-year degenerate term.
    it("AC16 — no NaN/Infinity in the real view", () => {
      const p = project(makeFixtureP());
      for (const rate of [0, 0.03, 0.1, 0.999]) {
        assertAllFinite(toRealTerms(p, rate));
      }
      const r = project(makeFixtureR({ contributionsStopYear: 0 }));
      assertAllFinite(toRealTerms(r, 0.03));
      const single = project(makeInput({ termYears: 1 }));
      assertAllFinite(toRealTerms(single, 0.03));
    });
  });
});

// features/crossover-target-income/spec.md ACs 1-12. Fixtures T and U follow the spec's naming
// verbatim. `findIncomeCrossover` reads an already-deflated `RealProjectionResult` (spec C3) — it
// contains no `(1+i)` arithmetic itself, so every fixture below goes through `toRealTerms` first,
// exactly as a real caller would.
describe("crossover-target-income", () => {
  function makeFixtureT(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
    return makeInput({
      initialShares: 10_000,
      initialSharePriceNzd: 10,
      sharePriceGrowth: 0.1,
      initialDividendPerShareNzd: 0.5,
      dividendGrowth: 0.1,
      termYears: 5,
      usWithholdingRate: 0.15,
      wrapper: "direct",
      marginalRate: 0.33,
      ...overrides,
    });
  }

  function makeFixtureU(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
    return makeInput({
      initialShares: 4_800,
      initialSharePriceNzd: 10,
      sharePriceGrowth: 0.1,
      initialDividendPerShareNzd: 0.35,
      dividendGrowth: 0.1,
      termYears: 4,
      usWithholdingRate: 0.15,
      wrapper: "direct",
      marginalRate: 0.33,
      ...overrides,
    });
  }

  // AC12 helper: same runtime-enumerated finiteness pattern as assertAllFinite above, applied to
  // IncomeCrossover — `null` fields (crossoverYear etc.) are `typeof "object"`, not "number", so
  // they are skipped here exactly like assertAllFinite skips non-number fields, never mistaken
  // for a missing check (invariant 13).
  function assertCrossoverAllFinite(crossover: IncomeCrossover): void {
    for (const [key, value] of Object.entries(crossover)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value), `crossover.${key}`).toBe(true);
      }
    }
    crossover.netIncomeByYearNzd.forEach((v, i) => {
      expect(Number.isFinite(v), `netIncomeByYearNzd[${i}]`).toBe(true);
    });
  }

  // AC1: the additive guarantee — project()/toRealTerms() must be byte-identical to before this
  // slice touched the file. This test invokes no new code at all (it never calls
  // findIncomeCrossover); it is a regression pin, not a feature test, so it is expected to be
  // already green even before findIncomeCrossover exists (see notes.md "AC1 does not RED").
  it("AC1 — additive guarantee: project(T)/toRealTerms(T) are unaffected", () => {
    const result = project(makeFixtureT());
    const y1 = result.rows[1];
    expect(y1.grossDividendsNzd).toBeCloseTo(5_500, 6);
    expect(y1.usWithholdingNzd).toBeCloseTo(825, 6);
    expect(y1.nzTaxPayableNzd).toBeCloseTo(825, 6);
    expect(y1.taxMethod).toBe("fdr");
    expect(y1.closingValueAfterTaxNzd).toBeCloseTo(113_850, 6);
    expect(toRealTerms(result, 0.1).rows[1].grossDividendsNzd).toBeCloseTo(5_000, 6);
  });

  // AC2: net = gross - WHT - NZ tax payable, identically gross - totalTaxNzd (Fixture U, i = 0).
  it("AC2 — net = gross - WHT - NZ tax payable (Fixture U, i = 0)", () => {
    const real = toRealTerms(project(makeFixtureU()), 0);
    const crossover = findIncomeCrossover(real, 0);
    const expected = [0, 1238.16, 1188.83952, 1333.87794144, 1496.61105029568];
    expected.forEach((v, i) => expect(crossover.netIncomeByYearNzd[i]).toBeCloseTo(v, 6));
    real.rows.forEach((row, i) => {
      expect(crossover.netIncomeByYearNzd[i]).toBeCloseTo(row.grossDividendsNzd - row.totalTaxNzd, 6);
    });
    const y1 = real.rows[1];
    expect(y1.grossDividendsNzd).toBeCloseTo(1_848, 6);
    expect(y1.grossDividendsNzd - y1.usWithholdingNzd).toBeCloseTo(1_570.8, 6);
    expect(y1.grossDividendsNzd - y1.nzTaxPayableNzd).toBeCloseTo(1_515.36, 6);
    expect(y1.dividendsDrawnNzd).toBe(0);
  });

  // AC3: fees are excluded — the fund/platform nets them from assets, never from dividend cash.
  it("AC3 — fees are not subtracted (Fixture U + platformFeeAnnualRate 0.01, i = 0)", () => {
    const real = toRealTerms(project(makeFixtureU({ platformFeeAnnualRate: 0.01 })), 0);
    const crossover = findIncomeCrossover(real, 0);
    expect(crossover.netIncomeByYearNzd[1]).toBeCloseTo(1_238.16, 6);
    expect(crossover.netIncomeByYearNzd[1]).not.toBeCloseTo(694.452, 3);
    expect(crossover.netIncomeByYearNzd[2]).toBeCloseTo(1_176.877944, 6);
  });

  // AC4: real, deflated to year 0 (Fixture T). BLOCKER — spec.md's stated i=0 array for years 3-5
  // ([..., 4990.1284125, 5681.26119763125, 6468.115873503178]) disagrees with both (a) the actual,
  // unmodified toRealTerms(project(T), 0) output and (b) the spec's own closed form for the same
  // fixture ("net(t) = 0.0385 x openingValue(t), openingValue(t) = 100_000 x 1.1385^(t-1)"), which
  // computes to the values used below. i=0 is the identity (AC1 of inflation-real-terms), so the
  // year-1/2 entries (3850, 4383.225) already agree exactly and pin the shared part of the
  // disagreement precisely at year 3 onward. See notes.md "Blocker: AC4 fixture arithmetic" for the
  // full derivation. Per Coder Guardrails, the fixture is not bent to fit the implementation —
  // these are the engine's real, verified numbers, not invented ones.
  it("AC4 — real, deflated to year 0 (Fixture T)", () => {
    const nominal = project(makeFixtureT());
    const real0 = toRealTerms(nominal, 0);
    const crossover0 = findIncomeCrossover(real0, 0);
    const expected0 = [0, 3850, 4383.225, 4990.3016625, 5681.45844275625, 6468.34043707799];
    expected0.forEach((v, i) => expect(crossover0.netIncomeByYearNzd[i]).toBeCloseTo(v, 6));

    const real10 = toRealTerms(nominal, 0.1);
    const crossover10 = findIncomeCrossover(real10, 0);
    const expected10 = [0, 3500, 3622.5, 3749.2875, 3880.5125625, 4016.3305021875];
    expected10.forEach((v, i) => expect(crossover10.netIncomeByYearNzd[i]).toBeCloseTo(v, 6));
    expect(crossover10.inflationRate).toBe(0.1);
  });

  // AC5: the target is real — comparing it against the nominal view (i = 0) gives a wrong-number
  // answer 3 years too optimistic in this 5-year fixture (Fixture T).
  it("AC5 — real target vs nominal comparison (Fixture T, target 3,800 / 5,000)", () => {
    const nominal = project(makeFixtureT());
    const real10 = toRealTerms(nominal, 0.1);
    const real0 = toRealTerms(nominal, 0);

    const c10_3800 = findIncomeCrossover(real10, 3_800);
    expect(c10_3800.crossoverYear).toBe(4);
    expect(c10_3800.incomeAtCrossoverNzd).toBeCloseTo(3_880.5125625, 6);

    const c0_3800 = findIncomeCrossover(real0, 3_800);
    expect(c0_3800.crossoverYear).toBe(1);

    const c10_5000 = findIncomeCrossover(real10, 5_000);
    expect(c10_5000.crossoverYear).toBeNull();

    const c0_5000 = findIncomeCrossover(real0, 5_000);
    expect(c0_5000.crossoverYear).toBe(4);
  });

  // AC6: boundary / off-by-one — `>=` at the exact target, `>` or an index shift would miscount.
  it("AC6 — boundary / off-by-one (Fixture T, i = 0.10)", () => {
    const real10 = toRealTerms(project(makeFixtureT()), 0.1);
    const exact = findIncomeCrossover(real10, 3_749.2875);
    expect(exact.crossoverYear).toBe(3);
    expect(exact.incomeAtCrossoverNzd).toBeCloseTo(3_749.2875, 6);

    const justAbove = findIncomeCrossover(real10, 3_749.2876);
    expect(justAbove.crossoverYear).toBe(4);
  });

  // AC6b: extra hardening beyond AC6's literal fixture value — the spec's "3,749.2875" is not
  // bit-identical to the engine's own float64 result for that row (it carries ~1e-13 of drift), so
  // AC6 alone does not reliably distinguish `>=` from `>` at the boundary (surfaced during mutation
  // testing, see notes.md). Reading the target straight from the row's own computed net income
  // guarantees an exact match, genuinely pinning `>=`.
  it("AC6b — >= not > at the bit-exact boundary (mutation hardening)", () => {
    const real10 = toRealTerms(project(makeFixtureT()), 0.1);
    const y3Net = real10.rows[3].grossDividendsNzd - real10.rows[3].totalTaxNzd;
    const exact = findIncomeCrossover(real10, y3Net);
    expect(exact.crossoverYear).toBe(3);
  });

  // AC7: year 0 is the pre-growth snapshot and never crosses.
  it("AC7 — year 0 never crosses (Fixture T, i = 0.10, target 0)", () => {
    const real10 = toRealTerms(project(makeFixtureT()), 0.1);
    const crossover = findIncomeCrossover(real10, 0);
    expect(crossover.crossoverYear).toBe(1);
    expect(crossover.firstYearAboveTarget).toBe(1);
    expect(crossover.netIncomeByYearNzd[0]).toBe(0);
    expect(crossover.netIncomeByYearNzd.length).toBe(real10.rows.length);
    expect(crossover.netIncomeByYearNzd.length).toBe(6);
  });

  // AC8 (C4): every phase is scanned — the default all-Accumulate run still reports a crossover
  // ("if you switched to drawing then"), and Drawing does not change the phase-independent tax.
  it("AC8 — phase-independent (C4) (Fixture T, i = 0.10, target 3,800)", () => {
    const real10 = toRealTerms(project(makeFixtureT()), 0.1);
    real10.rows.forEach((row) => {
      expect(row.phase).toBe("accumulate");
      expect(row.dividendsDrawnNzd).toBe(0);
    });
    const crossover = findIncomeCrossover(real10, 3_800);
    expect(crossover.crossoverYear).toBe(4);

    // The nominal (pre-deflation) dividendsDrawnNzd pins that this is a genuine Draw year — the
    // real (deflated) crossover reading below is what an investor actually compares against the
    // real target, exactly as AC5 established.
    const decumulateNominal = project(makeFixtureT({ contributionsStopYear: 0 }));
    expect(decumulateNominal.rows[1].dividendsDrawnNzd).toBeCloseTo(4_675, 6);
    const decumulate = toRealTerms(decumulateNominal, 0.1);
    const decumulateCrossover = findIncomeCrossover(decumulate, 3_800);
    expect(decumulateCrossover.netIncomeByYearNzd[1]).toBeCloseTo(3_500, 6);
  });

  // AC9 (C5): never crossed reports null, never 0/-1/the last year, and finalYearNetIncomeNzd is
  // still populated so the UI can say something honest.
  it("AC9 — never crossed (C5) (Fixture T, i = 0.10, target 5,000)", () => {
    const real10 = toRealTerms(project(makeFixtureT()), 0.1);
    const crossover = findIncomeCrossover(real10, 5_000);
    expect(crossover.crossoverYear).toBeNull();
    expect(crossover.firstYearAboveTarget).toBeNull();
    expect(crossover.incomeAtCrossoverNzd).toBeNull();
    expect(crossover.finalYearNetIncomeNzd).toBeCloseTo(4_016.3305021875, 6);
  });

  // AC10 (C5): sustained beats first — the de minimis crossing (dividend -> fif) dips year 2's
  // income below the target even though year 1 cleared it.
  it("AC10 — sustained vs first (C5) (Fixture U, i = 0, target 1,200)", () => {
    const real0 = toRealTerms(project(makeFixtureU()), 0);
    expect(real0.rows[1].taxRegime).toBe("dividend");
    expect(real0.rows[2].taxRegime).toBe("fif");
    const crossover = findIncomeCrossover(real0, 1_200);
    expect(crossover.firstYearAboveTarget).toBe(1);
    expect(crossover.crossoverYear).toBe(3);
    expect(crossover.incomeAtCrossoverNzd).toBeCloseTo(1_333.87794144, 6);
    expect(crossover.finalYearNetIncomeNzd).toBeCloseTo(1_496.61105029568, 6);
  });

  // AC11: the target is validated like every other money/rate input — nothing is coerced.
  it("AC11 — target validated, nothing coerced", () => {
    const real10 = toRealTerms(project(makeFixtureT()), 0.1);
    for (const bad of [NaN, Infinity, -Infinity, -1]) {
      let thrown: unknown;
      try {
        findIncomeCrossover(real10, bad);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `target=${bad}`).toBeInstanceOf(ProjectionInputError);
      expect((thrown as Error).message, `target=${bad}`).toMatch(/targetAnnualIncomeNzd/);
    }
    expect(() => findIncomeCrossover(real10, 0)).not.toThrow();
    expect(() => findIncomeCrossover(real10, 1e9)).not.toThrow();
  });

  // AC12: no NaN/Infinity escapes findIncomeCrossover, across every rate/fixture combination named
  // in the spec (invariant 13).
  it("AC12 — no NaN/Infinity", () => {
    const t = project(makeFixtureT());
    for (const rate of [0, 0.03, 0.1]) {
      assertCrossoverAllFinite(findIncomeCrossover(toRealTerms(t, rate), 3_800));
    }
    const u = project(makeFixtureU());
    assertCrossoverAllFinite(findIncomeCrossover(toRealTerms(u, 0), 1_200));

    const single = project(makeInput({ termYears: 1 }));
    assertCrossoverAllFinite(findIncomeCrossover(toRealTerms(single, 0.03), 0));
  });

  // AC20 (R4): "sustained" runs to the end of the term, never a fixed lookahead. Fixture V's de
  // minimis crossing dips year 5's income 3 years after year 1 first qualifies — every other
  // fixture's dip lands immediately after the qualifying year, so this is the only AC that can
  // distinguish "scan to N" from a short lookahead. Cannot RED (the shipped scan is already
  // correct); its evidence is the R4 mutation dying (see notes.md Cycle 1).
  it("AC20 — sustained runs to the end, not a fixed lookahead (Fixture V, i = 0, target 800)", () => {
    const real0 = toRealTerms(project(makeFixtureT({ initialShares: 4_600, initialDividendPerShareNzd: 0.25, termYears: 7 })), 0);
    expect(real0.rows[3].costBasisNzd).toBeCloseTo(49_622.83926654203, 6);
    expect(real0.rows[3].taxRegime).toBe("dividend");
    expect(real0.rows[4].costBasisNzd).toBeCloseTo(51_127.12400668227, 6);
    expect(real0.rows[4].taxRegime).toBe("fif");

    const expected = [
      0, 847.55, 947.92110875, 1060.17866605371875, 707.8987012424659, 786.4754570803796,
      873.7742328163018, 970.7631726589113,
    ];
    const crossover = findIncomeCrossover(real0, 800);
    expected.forEach((v, i) => expect(crossover.netIncomeByYearNzd[i]).toBeCloseTo(v, 6));
    expect(crossover.firstYearAboveTarget).toBe(1);
    expect(crossover.crossoverYear).toBe(6);
    expect(crossover.incomeAtCrossoverNzd).toBeCloseTo(873.7742328163018, 6);
    expect(crossover.finalYearNetIncomeNzd).toBeCloseTo(970.7631726589113, 6);
  });

  // AC21 (R8): net income may be negative and must never be clamped. Fixture W's 1.1% yield sits
  // under the 1.65% FDR drag for every year, so net income is negative from year 1. Cannot RED
  // (the shipped code already omits any clamp); its evidence is the R8 mutation dying (see
  // notes.md Cycle 1).
  it("AC21 — negative net income, never clamped (Fixture W, i = 0, target 0)", () => {
    const real0 = toRealTerms(project(makeFixtureT({ initialDividendPerShareNzd: 0.1, termYears: 3 })), 0);
    const expected = [0, -550, -601.975, -658.8616375];
    const crossover = findIncomeCrossover(real0, 0);
    expected.forEach((v, i) => expect(crossover.netIncomeByYearNzd[i]).toBeCloseTo(v, 6));
    expect(crossover.finalYearNetIncomeNzd).toBeCloseTo(-658.8616375, 6);
    expect(crossover.firstYearAboveTarget).toBeNull();
    expect(crossover.crossoverYear).toBeNull();
  });
});
