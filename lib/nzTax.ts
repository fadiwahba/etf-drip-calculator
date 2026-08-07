// The single shared NZ tax engine (Constitution §2, calculator-invariants.md #10). Every rate and
// threshold below is cited against ird.govt.nz — see .claude/rules/nz-tax.md for the full context
// and the 2026-08-06 audit that found four contradictory tax models before this module existed.
//
// Pure function over one tax year: no I/O, no Date.now(), no module-level mutable state, no
// imports from data/*. Threshold crossing across years is a caller concern — this module decides
// one year at a time (spec: "the caller loops, each year decides independently").

export type Wrapper = "pie" | "direct";

export interface TaxYearInput {
  wrapper: Wrapper;
  foreignCostNzd: number; // highest total cost of foreign holdings during the year (de minimis test)
  openingValueNzd: number;
  closingValueNzd: number;
  grossDividendsNzd: number;
  purchasesNzd?: number; // default 0 — CV input
  salesProceedsNzd?: number; // default 0 — CV input
  marginalRate: number; // decimal 0-1, direct holdings
  pir?: number; // decimal 0-1, required when wrapper === "pie"
  usWithholdingPaidNzd?: number; // default 0
  fifThresholdNzd?: number; // default DEFAULT_FIF_DE_MINIMIS_NZD
}

export interface TaxYearResult {
  regime: "fif" | "dividend";
  method: "fdr" | "cv" | "actual-dividends";
  aboveThreshold: boolean;
  taxableIncomeNzd: number;
  rate: number;
  grossTaxNzd: number;
  foreignTaxCreditNzd: number;
  nzTaxPayableNzd: number; // grossTax − credit, floored at 0
  totalTaxNzd: number; // nzTaxPayable + usWithholdingPaid (the credit caps at the liability, not at what was paid)
}

export class TaxInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxInputError";
  }
}

// Fair Dividend Rate: deemed income = 5% of opening market value, one of the two FIF methods an
// individual may choose between (lower of FDR/CV). Source:
// https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-income/foreign-investment-funds-fifs/foreign-investment-fund-rules-exemptions
// Verified 2026-08-06.
export const FDR_RATE = 0.05;

// FIF de minimis: total *cost* (not market value) of foreign holdings at or below this amount
// means FIF does not apply — actual dividends are taxed at marginal rate instead. Source: as
// above (IRD — FIF rules and exemptions). Verified 2026-08-06.
// Budget 2026 signalled raising this to NZ$100,000 from the 2026-27 year — UNCONFIRMED, so the
// default stays at the current statutory $50,000 and callers can override it via
// `fifThresholdNzd` once/if the change is enacted.
export const DEFAULT_FIF_DE_MINIMIS_NZD = 50_000;

// Prescribed Investor Rate cap for a multi-rate PIE: PIR bands are 10.5% / 17.5% / 28%, capped at
// 28% regardless of the investor's marginal rate — the reason a high earner can pay less tax via
// a PIE wrapper than holding the same exposure directly. Source:
// https://www.ird.govt.nz/roles/portfolio-investment-entities/multi-rate-pies-and-prescribed-investor-rates
// Verified 2026-08-06.
export const PIR_CAP = 0.28;

function assertFiniteMoney(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new TaxInputError(`${field} must be a finite number`);
  }
  if (value < 0) {
    throw new TaxInputError(`${field} must not be negative`);
  }
}

function assertRate(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new TaxInputError(`${field} must be a finite number`);
  }
  if (value < 0 || value > 1) {
    throw new TaxInputError(
      `${field} must be a decimal between 0 and 1, not a percent (e.g. 0.33, not 33)`
    );
  }
}

// Narrows input.pir to `number` via control-flow analysis on the property access itself, so the
// caller never needs a non-null assertion on validated-but-optional input.
function resolvePir(input: TaxYearInput): number {
  if (input.pir === undefined) {
    throw new TaxInputError('pir is required when wrapper is "pie"');
  }
  return input.pir;
}

function validateInput(input: TaxYearInput): void {
  assertFiniteMoney(input.foreignCostNzd, "foreignCostNzd");
  assertFiniteMoney(input.openingValueNzd, "openingValueNzd");
  assertFiniteMoney(input.closingValueNzd, "closingValueNzd");
  assertFiniteMoney(input.grossDividendsNzd, "grossDividendsNzd");
  assertFiniteMoney(input.purchasesNzd ?? 0, "purchasesNzd");
  assertFiniteMoney(input.salesProceedsNzd ?? 0, "salesProceedsNzd");
  assertFiniteMoney(input.usWithholdingPaidNzd ?? 0, "usWithholdingPaidNzd");
  assertRate(input.marginalRate, "marginalRate");

  if (input.pir !== undefined) {
    assertRate(input.pir, "pir");
  }
  if (input.wrapper === "pie" && input.pir === undefined) {
    throw new TaxInputError('pir is required when wrapper is "pie"');
  }

  const fifThresholdNzd = input.fifThresholdNzd ?? DEFAULT_FIF_DE_MINIMIS_NZD;
  if (!Number.isFinite(fifThresholdNzd)) {
    throw new TaxInputError("fifThresholdNzd must be a finite number");
  }
  if (fifThresholdNzd <= 0) {
    throw new TaxInputError("fifThresholdNzd must be greater than 0");
  }
}

export function computeAnnualTax(input: TaxYearInput): TaxYearResult {
  validateInput(input);

  const purchasesNzd = input.purchasesNzd ?? 0;
  const salesProceedsNzd = input.salesProceedsNzd ?? 0;
  const usWithholdingPaidNzd = input.usWithholdingPaidNzd ?? 0;
  const fifThresholdNzd = input.fifThresholdNzd ?? DEFAULT_FIF_DE_MINIMIS_NZD;

  // PIE modelling convention: a PIE actually runs the FIF calc at fund level, distributing net
  // income to investors. We model the equivalent single-investor outcome as a rate substitution —
  // the same FIF taxable income, taxed at the investor's PIR (capped) instead of marginal rate —
  // which is the convention .claude/rules/nz-tax.md specifies for this calculator's scope.
  const rate = input.wrapper === "pie" ? Math.min(resolvePir(input), PIR_CAP) : input.marginalRate;

  // De minimis tests cost, not market value (nz-tax.md — "Threshold crossing matters").
  const aboveThreshold = input.foreignCostNzd > fifThresholdNzd;

  let regime: "fif" | "dividend";
  let method: "fdr" | "cv" | "actual-dividends";
  let taxableIncomeNzd: number;

  if (!aboveThreshold) {
    // Below the de minimis: FIF does not apply, actual dividends are taxed instead.
    regime = "dividend";
    method = "actual-dividends";
    taxableIncomeNzd = input.grossDividendsNzd;
  } else {
    regime = "fif";
    const fdrIncome = FDR_RATE * input.openingValueNzd;
    // CV floors at zero (nz-tax.md — "tax is $0 in a losing year"); a flat 5%-always model would
    // overstate tax in a down year.
    const cv = Math.max(
      0,
      input.closingValueNzd +
        input.grossDividendsNzd +
        salesProceedsNzd -
        (input.openingValueNzd + purchasesNzd)
    );
    // An individual may use the lower of FDR and CV each year; an exact tie keeps FDR (spec: "Exact
    // tie → method: fdr").
    method = fdrIncome <= cv ? "fdr" : "cv";
    taxableIncomeNzd = Math.min(fdrIncome, cv);
  }

  const grossTaxNzd = taxableIncomeNzd * rate;
  // US WHT credits against the FIF/dividend liability, capped at that liability — never a refund.
  const foreignTaxCreditNzd = Math.min(usWithholdingPaidNzd, grossTaxNzd);
  const nzTaxPayableNzd = Math.max(0, grossTaxNzd - foreignTaxCreditNzd);
  // Total includes the full WHT actually paid, not just the portion credited — the excess (if any)
  // was still paid to the US, it just didn't reduce the NZ bill below zero.
  const totalTaxNzd = nzTaxPayableNzd + usWithholdingPaidNzd;

  return {
    regime,
    method,
    aboveThreshold,
    taxableIncomeNzd,
    rate,
    grossTaxNzd,
    foreignTaxCreditNzd,
    nzTaxPayableNzd,
    totalTaxNzd,
  };
}
