// Pure per-year DRIP projection loop (Constitution §2 — one engine per concern). This module
// consumes `computeAnnualTax` (lib/nzTax.ts) and `requirePriceGrowth` (lib/funds.ts); it never
// re-derives tax or price-growth logic itself. No React/Next, no I/O, no module-level mutable
// state — see `.claude/rules/calculator-invariants.md` for the defect classes this retires.

import { computeAnnualTax, type Wrapper } from "@/lib/nzTax";
import { requirePriceGrowth, type Fund } from "@/lib/funds";

export interface ProjectionInput {
  termYears: number; // integer >= 1
  compoundingPeriodsPerYear: number; // integer >= 1 — growth model only
  contributionsPerYear: number; // integer >= 1 — deposit cadence only
  contributionTiming: "start" | "end"; // required; no default
  initialShares: number; // >= 0
  initialSharePriceNzd: number; // > 0
  contributionPerEventNzd: number; // >= 0, per event (0 = no contributions)
  sharePriceGrowth: number; // price-only, (-1, 1)
  initialDividendPerShareNzd: number; // >= 0
  dividendGrowth: number; // per share, (-1, 1)
  growthBasis: "net-of-expense-ratio" | "gross-of-expense-ratio";
  expenseRatioAnnual: number; // [0,1); must be 0 when growthBasis is net
  platformFeeAnnualRate: number; // [0,1) of value, charged yearly
  brokeragePerContributionNzd: number; // >= 0, per event
  fxSpreadRate: number; // [0,1), buy leg, per contribution; 0 for an NZD asset
  usWithholdingRate: number; // [0,1) — 0.15 with W-8BEN
  wrapper: Wrapper;
  marginalRate: number;
  pir?: number;
  fifThresholdNzd?: number;
}

export interface ProjectionRow {
  year: number;
  openingShares: number;
  closingShares: number;
  openingSharePriceNzd: number;
  closingSharePriceNzd: number;
  openingValueNzd: number;
  contributionsGrossNzd: number;
  contributionsInvestedNzd: number;
  brokerageFeeNzd: number;
  fxSpreadCostNzd: number;
  expenseFeeNzd: number;
  platformFeeNzd: number;
  totalFeesNzd: number;
  dividendPerShareNzd: number;
  grossDividendsNzd: number;
  usWithholdingNzd: number;
  dividendsReinvestedNzd: number;
  closingValueNzd: number;
  taxRegime: "fif" | "dividend";
  taxMethod: "fdr" | "cv" | "actual-dividends";
  aboveThreshold: boolean;
  taxableIncomeNzd: number;
  nzTaxPayableNzd: number;
  totalTaxNzd: number;
  closingValueAfterTaxNzd: number;
  cumulativeContributionsNzd: number;
  costBasisNzd: number;
}

export interface ProjectionResult {
  rows: ProjectionRow[];
  initialInvestmentNzd: number;
  totalContributionsNzd: number;
  finalValueNzd: number;
  totalFeesNzd: number;
  totalTaxNzd: number;
  netGainNzd: number;
}

export class ProjectionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionInputError";
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new ProjectionInputError(`${field} must be a finite number`);
  }
  if (value < 0) {
    throw new ProjectionInputError(`${field} must not be negative`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new ProjectionInputError(`${field} must be a positive integer`);
  }
}

// Growth rates are strictly between -1 and 1: -1 (or below) is a total loss and beyond, which is
// not a valid annualised rate; >=1 is almost always a percent-shaped mistake (e.g. 10 meaning
// 10%, not 1000%) rather than a real input (AC18).
function assertOpenRate(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new ProjectionInputError(`${field} must be a finite number`);
  }
  if (value <= -1 || value >= 1) {
    throw new ProjectionInputError(
      `${field} must be a decimal strictly between -1 and 1, not a percent (e.g. 0.10, not 10)`
    );
  }
}

// Fee/cost rates are [0,1): 0 is a legitimate "no fee", 1 or above is a percent-shaped mistake.
function assertHalfOpenRate(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new ProjectionInputError(`${field} must be a finite number`);
  }
  if (value < 0 || value >= 1) {
    throw new ProjectionInputError(
      `${field} must be a decimal between 0 (inclusive) and 1 (exclusive), not a percent (e.g. 0.005, not 0.5)`
    );
  }
}

// wrapper/marginalRate/pir/fifThresholdNzd are deliberately NOT validated here (Constitution §2,
// guardrail "no de minimis comparison in this file"): they are computeAnnualTax's own concern,
// and its TaxInputError must propagate unwrapped, not be re-thrown as a ProjectionInputError.
function validateInput(input: ProjectionInput): void {
  assertPositiveInteger(input.termYears, "termYears");
  assertPositiveInteger(input.compoundingPeriodsPerYear, "compoundingPeriodsPerYear");
  assertPositiveInteger(input.contributionsPerYear, "contributionsPerYear");

  if (input.contributionTiming !== "start" && input.contributionTiming !== "end") {
    throw new ProjectionInputError('contributionTiming must be "start" or "end"');
  }

  assertFiniteNonNegative(input.initialShares, "initialShares");
  if (!Number.isFinite(input.initialSharePriceNzd) || input.initialSharePriceNzd <= 0) {
    throw new ProjectionInputError("initialSharePriceNzd must be a finite number greater than 0");
  }
  assertFiniteNonNegative(input.contributionPerEventNzd, "contributionPerEventNzd");
  assertOpenRate(input.sharePriceGrowth, "sharePriceGrowth");
  assertFiniteNonNegative(input.initialDividendPerShareNzd, "initialDividendPerShareNzd");
  assertOpenRate(input.dividendGrowth, "dividendGrowth");

  if (
    input.growthBasis !== "net-of-expense-ratio" &&
    input.growthBasis !== "gross-of-expense-ratio"
  ) {
    throw new ProjectionInputError(
      'growthBasis must be "net-of-expense-ratio" or "gross-of-expense-ratio"'
    );
  }
  assertHalfOpenRate(input.expenseRatioAnnual, "expenseRatioAnnual");
  if (input.growthBasis === "net-of-expense-ratio" && input.expenseRatioAnnual !== 0) {
    // Invariant 7: a net-of-fees historical return already has the expense ratio baked in —
    // charging expenseRatioAnnual again on top of it would double-charge the fee.
    throw new ProjectionInputError(
      'expenseRatioAnnual must be 0 when growthBasis is "net-of-expense-ratio" — the return is ' +
        'already net of the expense ratio; use "gross-of-expense-ratio" to charge it explicitly'
    );
  }

  assertHalfOpenRate(input.platformFeeAnnualRate, "platformFeeAnnualRate");
  assertFiniteNonNegative(input.brokeragePerContributionNzd, "brokeragePerContributionNzd");
  assertHalfOpenRate(input.fxSpreadRate, "fxSpreadRate");
  assertHalfOpenRate(input.usWithholdingRate, "usWithholdingRate");
}

// Pre-growth opening snapshot (invariant 1): year 0 runs no growth, so a caller can see the
// starting position without it being mistaken for a compounded year.
function buildYearZeroRow(input: ProjectionInput): ProjectionRow {
  const openingValue = input.initialShares * input.initialSharePriceNzd;
  return {
    year: 0,
    openingShares: input.initialShares,
    closingShares: input.initialShares,
    openingSharePriceNzd: input.initialSharePriceNzd,
    closingSharePriceNzd: input.initialSharePriceNzd,
    openingValueNzd: openingValue,
    contributionsGrossNzd: 0,
    contributionsInvestedNzd: 0,
    brokerageFeeNzd: 0,
    fxSpreadCostNzd: 0,
    expenseFeeNzd: 0,
    platformFeeNzd: 0,
    totalFeesNzd: 0,
    dividendPerShareNzd: 0,
    grossDividendsNzd: 0,
    usWithholdingNzd: 0,
    dividendsReinvestedNzd: 0,
    closingValueNzd: openingValue,
    // No tax event happens in year 0 (no income, no disposal) — these are placeholder values
    // consistent with "every flow 0", not a real computeAnnualTax result.
    taxRegime: "dividend",
    taxMethod: "actual-dividends",
    aboveThreshold: false,
    taxableIncomeNzd: 0,
    nzTaxPayableNzd: 0,
    totalTaxNzd: 0,
    closingValueAfterTaxNzd: openingValue,
    cumulativeContributionsNzd: 0,
    costBasisNzd: openingValue,
  };
}

export function project(input: ProjectionInput): ProjectionResult {
  validateInput(input);

  const rows: ProjectionRow[] = [buildYearZeroRow(input)];

  let shares = input.initialShares;
  let openingPrice = input.initialSharePriceNzd;
  let costBasis = input.initialShares * input.initialSharePriceNzd;
  let cumulativeContributions = 0;

  for (let year = 1; year <= input.termYears; year++) {
    const openingShares = shares;
    const openingValue = openingShares * openingPrice;
    // Growth is applied to the price exactly once per year (invariant 1/2) — purchased shares
    // inherit the remaining growth automatically via the per-event eventPrice below, so
    // compoundingPeriodsPerYear (validated above) never re-enters the growth calculation.
    const closingPrice = openingPrice * (1 + input.sharePriceGrowth);

    let contributionsGross = 0;
    let contributionsInvested = 0;
    let brokerageFee = 0;
    let fxSpreadCost = 0;
    for (let k = 1; k <= input.contributionsPerYear; k++) {
      // Contribution timing is applied per event (invariant 4): "start" credits growth from the
      // beginning of the period the event falls in, "end" credits none yet — never averaged or
      // credited in bulk at year start.
      const f =
        input.contributionTiming === "start"
          ? (k - 1) / input.contributionsPerYear
          : k / input.contributionsPerYear;
      const eventPrice = openingPrice * Math.pow(1 + input.sharePriceGrowth, f);
      const perEvent = input.contributionPerEventNzd;
      const fx = (perEvent - input.brokeragePerContributionNzd) * input.fxSpreadRate;
      const invested = perEvent - input.brokeragePerContributionNzd - fx;
      shares += invested / eventPrice;
      contributionsGross += perEvent;
      contributionsInvested += invested;
      brokerageFee += input.brokeragePerContributionNzd;
      fxSpreadCost += fx;
    }

    // Dividend grows per share, not as a yield (invariant 6) — yield falls out as
    // dividendPerShare / price, it is never grown directly.
    const dividendPerShare = input.initialDividendPerShareNzd * Math.pow(1 + input.dividendGrowth, year);
    // Dividends pay once at year end, on the post-contribution share count.
    const grossDividends = shares * dividendPerShare;
    const usWithholding = grossDividends * input.usWithholdingRate;
    // DRIP does not defer tax: the investor owes NZ tax on this income in the year it arises even
    // though dripCash below never reaches them as cash (nz-tax.md "Tax on reinvested dividends").
    const dividendsReinvested = grossDividends - usWithholding;
    shares += dividendsReinvested / closingPrice;

    // Fee drag reduces the share count, never the displayed value only (invariant 8) — that is
    // what makes the drag compound into every subsequent year's opening value.
    const valueBeforeFees = shares * closingPrice;
    const expenseFee =
      input.growthBasis === "gross-of-expense-ratio" ? input.expenseRatioAnnual * valueBeforeFees : 0;
    const platformFee = input.platformFeeAnnualRate * valueBeforeFees;
    const totalFees = expenseFee + platformFee;
    shares -= totalFees / closingPrice;

    const closingValue = shares * closingPrice;

    // NZ has no general CGT (nz-tax.md) so the tax settlement below is not a disposal:
    // salesProceedsNzd is always 0 and costBasis only ever rises, including for the DRIP, which
    // is a real purchase for the Comparative Value base (invariant 11).
    const purchases = contributionsInvested + dividendsReinvested;
    costBasis += purchases;

    const tax = computeAnnualTax({
      openingValueNzd: openingValue,
      closingValueNzd: closingValue,
      grossDividendsNzd: grossDividends,
      purchasesNzd: purchases,
      salesProceedsNzd: 0,
      foreignCostNzd: costBasis,
      usWithholdingPaidNzd: usWithholding,
      wrapper: input.wrapper,
      marginalRate: input.marginalRate,
      pir: input.pir,
      fifThresholdNzd: input.fifThresholdNzd,
    });

    // Only the NZ liability net of the WHT credit leaves the portfolio — the WHT itself was
    // already withheld before the dividend was ever received, so deducting totalTaxNzd here would
    // double-charge it (invariant 11 / AC12).
    shares -= tax.nzTaxPayableNzd / closingPrice;
    const closingValueAfterTax = shares * closingPrice;

    cumulativeContributions += contributionsGross;

    rows.push({
      year,
      openingShares,
      closingShares: shares,
      openingSharePriceNzd: openingPrice,
      closingSharePriceNzd: closingPrice,
      openingValueNzd: openingValue,
      contributionsGrossNzd: contributionsGross,
      contributionsInvestedNzd: contributionsInvested,
      brokerageFeeNzd: brokerageFee,
      fxSpreadCostNzd: fxSpreadCost,
      expenseFeeNzd: expenseFee,
      platformFeeNzd: platformFee,
      totalFeesNzd: totalFees,
      dividendPerShareNzd: dividendPerShare,
      grossDividendsNzd: grossDividends,
      usWithholdingNzd: usWithholding,
      dividendsReinvestedNzd: dividendsReinvested,
      closingValueNzd: closingValue,
      taxRegime: tax.regime,
      taxMethod: tax.method,
      aboveThreshold: tax.aboveThreshold,
      taxableIncomeNzd: tax.taxableIncomeNzd,
      nzTaxPayableNzd: tax.nzTaxPayableNzd,
      totalTaxNzd: tax.totalTaxNzd,
      closingValueAfterTaxNzd: closingValueAfterTax,
      cumulativeContributionsNzd: cumulativeContributions,
      costBasisNzd: costBasis,
    });

    openingPrice = closingPrice;
  }

  const lastRow = rows[rows.length - 1];
  const initialInvestmentNzd = input.initialShares * input.initialSharePriceNzd;
  // Contributions are not returns (invariant 12): netGainNzd subtracts both the starting
  // investment and every deposit made along the way, so it never mistakes principal for growth.
  const netGainNzd = lastRow.closingValueAfterTaxNzd - initialInvestmentNzd - lastRow.cumulativeContributionsNzd;

  return {
    rows,
    initialInvestmentNzd,
    totalContributionsNzd: lastRow.cumulativeContributionsNzd,
    finalValueNzd: lastRow.closingValueAfterTaxNzd,
    // Sum of the share-count fee drag only (expense ratio + platform fee) — brokerage and FX
    // spread are contribution-time costs already reflected in the gap between
    // contributionsGrossNzd and contributionsInvestedNzd, not a recurring drag on the balance.
    totalFeesNzd: rows.reduce((sum, row) => sum + row.totalFeesNzd, 0),
    totalTaxNzd: rows.reduce((sum, row) => sum + row.totalTaxNzd, 0),
    netGainNzd,
  };
}

export function projectFund(
  fund: Fund,
  rest: Omit<ProjectionInput, "sharePriceGrowth">
): ProjectionResult {
  // requirePriceGrowth throws MissingAssumptionError on a null sharePriceGrowth (VYMI, FDVV) —
  // never substitutes 0, per the "failure mode to fear" (a plausible wrong number, not a crash).
  const sharePriceGrowth = requirePriceGrowth(fund);
  return project({ ...rest, sharePriceGrowth });
}
