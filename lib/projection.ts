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
  // Three-phase projection (features/three-phase-projection/spec.md), both optional and additive:
  // omitting both reproduces the pre-existing single-phase output exactly. Each field names the
  // FIRST year of the new behaviour, not the last year of the old one — `contributionsStopYear: 5`
  // means year 5 itself receives no contribution, not year 4.
  contributionsStopYear?: number; // integer >= 0 — 0 is the decumulator persona (AC7), not "unset"
  drawdownStartYear?: number; // integer >= 0 — defaults to contributionsStopYear when omitted
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
  // The amount fed to computeAnnualTax's purchasesNzd field (contributions + DRIP) — exposed as
  // its own field so a test can pin the CV base directly (invariant 11) instead of inferring it
  // from the costBasisNzd delta, which cannot distinguish "DRIP included" from "DRIP omitted" in
  // every fixture (review.md F1).
  purchasesNzd: number;
  // Three-phase projection: which phase this year ran in, and the cash paid out in a Draw year
  // (gross dividends less US WHT — the cash actually received, gross of NZ tax since that is
  // settled from the portfolio in every phase; spec.md "Drawn income reported gross or net").
  phase: "accumulate" | "coast" | "draw";
  dividendsDrawnNzd: number;
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
  // netGainNzd (unchanged formula, portfolio only) excludes cash already drawn out — this field
  // must be displayed beside it or a Draw run looks like it grew less than it actually returned.
  totalDividendsDrawnNzd: number;
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

// Phase-boundary years are counts, not rates: 0 is meaningful (AC7's decumulator), a fraction or
// a negative year cannot be a "first year", so both are rejected rather than floored/clamped.
function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new ProjectionInputError(`${field} must be a finite number`);
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ProjectionInputError(`${field} must be a non-negative integer`);
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

  if (input.contributionsStopYear !== undefined) {
    assertNonNegativeInteger(input.contributionsStopYear, "contributionsStopYear");
  }
  if (input.drawdownStartYear !== undefined) {
    assertNonNegativeInteger(input.drawdownStartYear, "drawdownStartYear");
    // A drawdownStartYear with no contributionsStopYear has no "stop" to be relative to (the
    // pseudocode's `stop` defaults to Infinity) — contributing and drawing would never be
    // distinguishable from plain accumulation, so this is rejected rather than silently ignored.
    if (input.contributionsStopYear === undefined) {
      throw new ProjectionInputError(
        "drawdownStartYear requires contributionsStopYear to also be set"
      );
    }
    // Contributing and drawing in the same year is not a modelled phase (spec.md decision table) —
    // clamping either value would silently run a plan the user did not ask for (Constitution §1).
    if (input.drawdownStartYear < input.contributionsStopYear) {
      throw new ProjectionInputError(
        `drawdownStartYear (${input.drawdownStartYear}) must not be before contributionsStopYear ` +
          `(${input.contributionsStopYear}) — contributing and drawing in the same year is not a modelled phase`
      );
    }
  }
}

// The one phase decision, made once per year and reused for every downstream branch (Constitution
// §2 — no phase logic anywhere else, including year 0). `??`, never `||`: 0 is `contributionsStopYear`'s
// decumulator persona (AC7), and `||` would treat it as unset and never stop contributing.
function resolvePhase(input: ProjectionInput, year: number): "accumulate" | "coast" | "draw" {
  const stop = input.contributionsStopYear ?? Infinity;
  const draw = input.drawdownStartYear ?? stop;
  return year < stop ? "accumulate" : year < draw ? "coast" : "draw";
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
    purchasesNzd: 0,
    // Year 0 gets the same phase decision as every other year (Constitution §2 — one helper, no
    // special-casing) — this is what makes AC7's decumulator persona ("every row is draw") true
    // for year 0 too, not just years 1..N.
    phase: resolvePhase(input, 0),
    dividendsDrawnNzd: 0,
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
    // The one phase decision for this year, made once and reused below — no second "is this a
    // draw year" check anywhere else in the loop (Constitution §2).
    const phase = resolvePhase(input, year);

    let contributionsGross = 0;
    let contributionsInvested = 0;
    let brokerageFee = 0;
    let fxSpreadCost = 0;
    if (phase === "accumulate") {
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
    }

    // Dividend grows per share, not as a yield (invariant 6) — yield falls out as
    // dividendPerShare / price, it is never grown directly.
    const dividendPerShare = input.initialDividendPerShareNzd * Math.pow(1 + input.dividendGrowth, year);
    // Dividends pay once at year end, on the post-contribution share count.
    const grossDividends = shares * dividendPerShare;
    const usWithholding = grossDividends * input.usWithholdingRate;
    // A Draw year pays the dividend out instead of reinvesting it — the share count does not grow
    // from it (spec.md "Draw pays the dividend out; principal is untouched"). Everywhere else
    // (growth, fees, the tax call and its arguments, the tax settlement below) is byte-identical
    // across all three phases: NZ taxes a deemed/actual return, not received dividends, so paying
    // cash out instead of reinvesting it is not a new taxable event and does not change the tax
    // (nz-tax.md "Tax on reinvested dividends").
    const isDraw = phase === "draw";
    const dividendsReinvested = isDraw ? 0 : grossDividends - usWithholding;
    const dividendsDrawn = isDraw ? grossDividends - usWithholding : 0;
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
      purchasesNzd: purchases,
      phase,
      dividendsDrawnNzd: dividendsDrawn,
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
    totalDividendsDrawnNzd: rows.reduce((sum, row) => sum + row.dividendsDrawnNzd, 0),
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

// features/inflation-real-terms/spec.md R1: real vs nominal is a VIEW over an existing project()
// result, never a second projection — inflation changes no maths (tax stays nominal, IRD taxes
// nominal dollars and FIF has no inflation adjustment), so threading it through ProjectionInput
// would imply it does and risk it reaching a tax base (Constitution §2).
export interface RealProjectionRow extends ProjectionRow {
  purchasingPowerLostNzd: number;
}

export interface RealProjectionResult extends Omit<ProjectionResult, "rows"> {
  rows: RealProjectionRow[];
  inflationRate: number;
}

// The rate domain is identical to platformFeeAnnualRate's et al: [0, 1) — deflation (a negative
// rate) is rejected here specifically because it would put a negative number in a column labelled
// "lost", which reads as a gain (Constitution §1, spec.md "Rate domain"). Reusing
// assertHalfOpenRate rather than a bespoke check keeps that domain defined in exactly one place.
export function toRealTerms(result: ProjectionResult, inflationRate: number): RealProjectionResult {
  assertHalfOpenRate(inflationRate, "inflationRate");

  let cumulativeContributions = 0;

  const rows: RealProjectionRow[] = result.rows.map((row) => {
    const t = row.year;
    // Year 0 is the pre-growth opening snapshot, already in today's dollars (buildYearZeroRow) —
    // every field there uses exponent 0, not (1+i)^-1, which would inflate rather than deflate it
    // (spec.md R2).
    const closingDeflator = t === 0 ? 1 : Math.pow(1 + inflationRate, t);
    // `opening*` money fields are dated t-1 (openingValueNzd(t) === closingValueAfterTaxNzd(t-1)
    // nominally) — they are deflated by one year less than the rest of the row's flows.
    const openingDeflator = t === 0 ? 1 : Math.pow(1 + inflationRate, t - 1);

    const closingSharePriceNzd = row.closingSharePriceNzd / closingDeflator;
    const closingValueNzd = row.closingValueNzd / closingDeflator;
    const contributionsGrossNzd = row.contributionsGrossNzd / closingDeflator;
    const contributionsInvestedNzd = row.contributionsInvestedNzd / closingDeflator;
    const brokerageFeeNzd = row.brokerageFeeNzd / closingDeflator;
    const fxSpreadCostNzd = row.fxSpreadCostNzd / closingDeflator;
    const expenseFeeNzd = row.expenseFeeNzd / closingDeflator;
    const platformFeeNzd = row.platformFeeNzd / closingDeflator;
    const totalFeesNzd = row.totalFeesNzd / closingDeflator;
    const dividendPerShareNzd = row.dividendPerShareNzd / closingDeflator;
    const grossDividendsNzd = row.grossDividendsNzd / closingDeflator;
    const usWithholdingNzd = row.usWithholdingNzd / closingDeflator;
    const dividendsReinvestedNzd = row.dividendsReinvestedNzd / closingDeflator;
    const dividendsDrawnNzd = row.dividendsDrawnNzd / closingDeflator;
    const purchasesNzd = row.purchasesNzd / closingDeflator;
    const taxableIncomeNzd = row.taxableIncomeNzd / closingDeflator;
    // Tax stays nominal in the sense that it is never re-derived (IRD taxes nominal dollars) — a
    // deflated *amount* here only re-expresses cash already paid in today's dollars, it does not
    // feed back into any tax base (that base is costBasisNzd, which is never deflated below).
    const nzTaxPayableNzd = row.nzTaxPayableNzd / closingDeflator;
    const totalTaxNzd = row.totalTaxNzd / closingDeflator;
    const closingValueAfterTaxNzd = row.closingValueAfterTaxNzd / closingDeflator;

    const openingSharePriceNzd = row.openingSharePriceNzd / openingDeflator;
    const openingValueNzd = row.openingValueNzd / openingDeflator;

    // A running PV sum of each year's own real contribution, not the nominal cumulative total
    // divided by one end-of-term deflator — the latter is a different (wrong) number (spec.md R3).
    cumulativeContributions += contributionsGrossNzd;

    // Not a cash outflow: nothing leaves the portfolio, so this is a read-only diff, never fed
    // back into totalFeesNzd/totalTaxNzd/netGainNzd or subtracted from any balance (spec.md R4).
    const purchasingPowerLostNzd = t === 0 ? 0 : row.closingValueAfterTaxNzd - closingValueAfterTaxNzd;

    return {
      ...row,
      openingSharePriceNzd,
      closingSharePriceNzd,
      openingValueNzd,
      contributionsGrossNzd,
      contributionsInvestedNzd,
      brokerageFeeNzd,
      fxSpreadCostNzd,
      expenseFeeNzd,
      platformFeeNzd,
      totalFeesNzd,
      dividendPerShareNzd,
      grossDividendsNzd,
      usWithholdingNzd,
      dividendsReinvestedNzd,
      closingValueNzd,
      purchasesNzd,
      dividendsDrawnNzd,
      taxableIncomeNzd,
      nzTaxPayableNzd,
      totalTaxNzd,
      closingValueAfterTaxNzd,
      cumulativeContributionsNzd: cumulativeContributions,
      purchasingPowerLostNzd,
      // openingShares, closingShares (counts), costBasisNzd (the statutory de minimis base), year,
      // phase, taxRegime, taxMethod, aboveThreshold all carry over unchanged from the `...row`
      // spread above — none of them is money that has lost purchasing power (spec.md R3).
    };
  });

  const lastRow = rows[rows.length - 1];

  return {
    rows,
    // Dated 0 (spec.md "Summary fields") — the initial investment is already in today's dollars,
    // so it is carried over unchanged rather than divided by (1+i)^0 for show.
    initialInvestmentNzd: result.initialInvestmentNzd,
    totalContributionsNzd: lastRow.cumulativeContributionsNzd,
    finalValueNzd: lastRow.closingValueAfterTaxNzd,
    // Sums of the deflated rows, never one deflator applied to the nominal total (spec.md
    // "Summary fields") — mirrors project()'s own totalFeesNzd/totalTaxNzd/totalDividendsDrawnNzd
    // reduction, just over the real rows instead of the nominal ones.
    totalFeesNzd: rows.reduce((sum, row) => sum + row.totalFeesNzd, 0),
    totalTaxNzd: rows.reduce((sum, row) => sum + row.totalTaxNzd, 0),
    // Same formula as project()'s netGainNzd (invariant 12), applied to the real parts.
    netGainNzd:
      lastRow.closingValueAfterTaxNzd - result.initialInvestmentNzd - lastRow.cumulativeContributionsNzd,
    totalDividendsDrawnNzd: rows.reduce((sum, row) => sum + row.dividendsDrawnNzd, 0),
    inflationRate,
  };
}
