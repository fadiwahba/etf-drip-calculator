// Pure mapping/validation module (Constitution §2 — one engine per concern): UI form state (raw
// strings) -> `project()`'s `ProjectionInput`. No React/Next import — Vitest runs `environment:
// "node"` and cannot import a `.tsx`. This module never re-derives a rate, a threshold, a
// compounding rule, or any tax/fee arithmetic; the only arithmetic here is a percent->decimal
// `/100` (each occurrence commented) and the unit-share assignment below. Anything the engine
// itself validates (rate ranges, wrapper/pir cross-field rules) is deliberately left unvalidated
// here so `runProjection` surfaces the engine's own error verbatim instead of duplicating it.

import {
  project,
  toRealTerms,
  findIncomeCrossover,
  ProjectionInputError,
  type ProjectionInput,
  type ProjectionResult,
  type RealProjectionResult,
  type IncomeCrossover,
} from "@/lib/projection";
import { TaxInputError, type Wrapper } from "@/lib/nzTax";
import { MissingAssumptionError, type Fund } from "@/lib/funds";

export interface FieldConstraints {
  min?: number;
  max?: number;
  integer?: boolean;
}

export type FieldParseResult = { ok: true; value: number } | { ok: false; error: string };

// AC1 (invariant 14): never falls back to a number. `Number()` (not `parseFloat`) is used
// deliberately — parseFloat("12abc") silently returns 12, which is exactly the kind of coercion
// this function exists to refuse.
export function parseNumericField(
  raw: string,
  fieldLabel: string,
  constraints: FieldConstraints = {}
): FieldParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: `${fieldLabel} is required` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${fieldLabel} must be a finite number` };
  }
  if (constraints.integer && !Number.isInteger(value)) {
    return { ok: false, error: `${fieldLabel} must be a whole number` };
  }
  if (constraints.min !== undefined && value < constraints.min) {
    return { ok: false, error: `${fieldLabel} must be at least ${constraints.min}` };
  }
  if (constraints.max !== undefined && value > constraints.max) {
    return { ok: false, error: `${fieldLabel} must be at most ${constraints.max}` };
  }
  return { ok: true, value };
}

// Already checked ok:true by the caller before this is invoked (see the early `errors` return in
// buildProjectionInput below) — this re-checks at runtime rather than trusting that, so there is
// no `as`/`!` assertion anywhere in this module (Coder Guardrails).
function mustParse(result: FieldParseResult): number {
  if (!result.ok) {
    throw new Error("unreachable: mustParse called on a failed field parse");
  }
  return result.value;
}

export interface ProjectionFormState {
  initialCapital: string;
  termYears: string;
  extraMonthlyContribution: string;
  sharePriceGrowthPercent: string;
  dividendYieldPercent: string;
  dividendGrowthPercent: string;
  wrapper: Wrapper;
  pirPercent: string; // only meaningful when wrapper === "pie"; ignored otherwise
  marginalRatePercent: string;
  usWithholdingPercent: string;
  platformFeePercent: string;
  brokeragePerContribution: string;
  fxSpreadPercent: string;
  // Three-phase projection (spec.md "Blank means absent"): "" maps to the engine's own
  // `undefined` default, never to 0 (invariant 14) — parseOptionalPhaseYearField below is the one
  // place that distinction is made.
  contributionsStopYear: string;
  drawdownStartYear: string;
  // features/inflation-real-terms/spec.md R6: off means nominal, no memo column, and the rate
  // field disabled with its value kept but never parsed — parseInflationRate below is the one
  // place that distinction is made (mirrors the contributionsStopYear/drawdownStartYear pattern).
  showRealTerms: boolean;
  inflationRatePercent: string;
  // features/crossover-target-income/spec.md: "" maps to no target, never to 0 (invariant 14) —
  // parseTargetIncome below is the one place that distinction is made, mirroring
  // inflationRatePercent's own pattern. Meaningful regardless of showRealTerms (parsed the same
  // either way); runProjection only ever computes a crossover when a real view also exists (C3).
  targetAnnualIncome: string;
}

export type FieldErrors = Record<string, string>;

export type BuildProjectionInputResult =
  | { ok: true; value: ProjectionInput }
  | { ok: false; errors: FieldErrors };

type PirParseResult = { ok: true; value: number | undefined } | { ok: false; error: string };

// wrapper "direct" -> pir is always undefined, never 0 (Constitution §8) — the field is not shown
// for direct (spec: "PIR (%) — shown only when wrapper = PIE"). A blank pir under "pie" is also
// passed through as undefined rather than rejected here: computeAnnualTax's own "pir is required
// when wrapper is pie" TaxInputError is the single source of truth for that cross-field rule
// (Constitution §2) and must surface verbatim through runProjection (AC9), not be pre-empted by a
// mapper-level message.
function parsePir(wrapper: Wrapper, pirPercent: string): PirParseResult {
  if (wrapper !== "pie") {
    return { ok: true, value: undefined };
  }
  const trimmed = pirPercent.trim();
  if (trimmed === "") {
    return { ok: true, value: undefined };
  }
  const parsed = parseNumericField(pirPercent, "PIR (%)");
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  // /100: percent field -> decimal, exactly once.
  return { ok: true, value: parsed.value / 100 };
}

// Same "already checked ok:true by the caller" pattern as mustParse above, for the pir field's
// value: number|undefined (undefined is a legitimate result, not a failure).
function mustParsePir(result: PirParseResult): number | undefined {
  if (!result.ok) {
    throw new Error("unreachable: mustParsePir called on a failed field parse");
  }
  return result.value;
}

type OptionalPhaseYearParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

// AC10 (spec.md): blank is a real "unset" state, distinct from "0" — this is the one place that
// distinction is made; a `Number("")` coercion here would silently turn "unset" into 0 and disable
// the AC7 decumulator persona for every blank-field user. Bounded to termYears' own 0-50 range
// (FieldConstraints below) since a phase year beyond the UI's own term cap can never be reached.
function parseOptionalPhaseYearField(raw: string, fieldLabel: string): OptionalPhaseYearParseResult {
  if (raw.trim() === "") {
    return { ok: true, value: undefined };
  }
  const parsed = parseNumericField(raw, fieldLabel, { min: 0, max: 50, integer: true });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, value: parsed.value };
}

// Same "already checked ok:true by the caller" pattern as mustParse above.
function mustParseOptionalPhaseYear(result: OptionalPhaseYearParseResult): number | undefined {
  if (!result.ok) {
    throw new Error("unreachable: mustParseOptionalPhaseYear called on a failed field parse");
  }
  return result.value;
}

type InflationRateParseResult = { ok: true; value: number | undefined } | { ok: false; error: string };

// AC9 (spec.md R6): off means "not parsed" — the field's raw value is kept in form state (so the
// disabled input still shows what the user typed) but never validated or converted, so an invalid
// string cannot block a nominal-only run. On, it is a required percent field like any other, /100
// exactly once — the actual rate-domain check (0 <= i < 1) lives in toRealTerms, not here
// (Constitution §2), so a percent-shaped value like "150" deliberately passes this parse and is
// caught by the engine instead (AC12).
export function parseInflationRate(form: ProjectionFormState): InflationRateParseResult {
  if (!form.showRealTerms) {
    return { ok: true, value: undefined };
  }
  const parsed = parseNumericField(form.inflationRatePercent, "Inflation rate (%)");
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  // /100: percent field -> decimal, exactly once.
  return { ok: true, value: parsed.value / 100 };
}

type TargetIncomeParseResult = { ok: true; value: number | undefined } | { ok: false; error: string };

// features/crossover-target-income/spec.md AC13/invariant 14: blank is a real "no target" state,
// distinct from "0" — a `Number("")` coercion here would silently turn "unset" into a $0 target and
// hide the whole table behind a crossover that reports "year 1" for everyone. Not gated on
// showRealTerms (unlike parseInflationRate): the field is meaningful on its own, and it is
// runProjection's job, not this parse, to decide a crossover needs a real view to mean anything.
export function parseTargetIncome(form: ProjectionFormState): TargetIncomeParseResult {
  if (form.targetAnnualIncome.trim() === "") {
    return { ok: true, value: undefined };
  }
  const parsed = parseNumericField(form.targetAnnualIncome, "Target annual income (NZD)", { min: 0 });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, value: parsed.value };
}

export function buildProjectionInput(form: ProjectionFormState): BuildProjectionInputResult {
  const initialCapital = parseNumericField(form.initialCapital, "Initial Capital (NZD)", { min: 0 });
  const termYears = parseNumericField(form.termYears, "Investment Term (years)", {
    min: 1,
    max: 50,
    integer: true,
  });
  const extraMonthlyContribution = parseNumericField(
    form.extraMonthlyContribution,
    "Extra Monthly Contribution (NZD)",
    { min: 0 }
  );
  const sharePriceGrowthPercent = parseNumericField(
    form.sharePriceGrowthPercent,
    "Share price growth (%, price only)"
  );
  const dividendYieldPercent = parseNumericField(form.dividendYieldPercent, "Dividend yield (%)");
  const dividendGrowthPercent = parseNumericField(form.dividendGrowthPercent, "Dividend growth (%)");
  const marginalRatePercent = parseNumericField(form.marginalRatePercent, "Marginal tax rate (%)");
  const usWithholdingPercent = parseNumericField(form.usWithholdingPercent, "US withholding (%)");
  const platformFeePercent = parseNumericField(form.platformFeePercent, "Platform fee (%)");
  const brokeragePerContribution = parseNumericField(
    form.brokeragePerContribution,
    "Brokerage per contribution (NZD)",
    { min: 0 }
  );
  const fxSpreadPercent = parseNumericField(form.fxSpreadPercent, "FX spread (%)");
  const pirResult = parsePir(form.wrapper, form.pirPercent);
  const contributionsStopYear = parseOptionalPhaseYearField(
    form.contributionsStopYear,
    "Stop contributing from year"
  );
  const drawdownStartYear = parseOptionalPhaseYearField(
    form.drawdownStartYear,
    "Start drawing dividends from year"
  );
  const inflationRateResult = parseInflationRate(form);
  const targetIncomeResult = parseTargetIncome(form);

  const errors: FieldErrors = {};
  if (!initialCapital.ok) errors.initialCapital = initialCapital.error;
  if (!termYears.ok) errors.termYears = termYears.error;
  if (!extraMonthlyContribution.ok) errors.extraMonthlyContribution = extraMonthlyContribution.error;
  if (!sharePriceGrowthPercent.ok) errors.sharePriceGrowthPercent = sharePriceGrowthPercent.error;
  if (!dividendYieldPercent.ok) errors.dividendYieldPercent = dividendYieldPercent.error;
  if (!dividendGrowthPercent.ok) errors.dividendGrowthPercent = dividendGrowthPercent.error;
  if (!marginalRatePercent.ok) errors.marginalRatePercent = marginalRatePercent.error;
  if (!usWithholdingPercent.ok) errors.usWithholdingPercent = usWithholdingPercent.error;
  if (!platformFeePercent.ok) errors.platformFeePercent = platformFeePercent.error;
  if (!brokeragePerContribution.ok) errors.brokeragePerContribution = brokeragePerContribution.error;
  if (!fxSpreadPercent.ok) errors.fxSpreadPercent = fxSpreadPercent.error;
  if (!pirResult.ok) errors.pirPercent = pirResult.error;
  if (!contributionsStopYear.ok) errors.contributionsStopYear = contributionsStopYear.error;
  if (!drawdownStartYear.ok) errors.drawdownStartYear = drawdownStartYear.error;
  // inflationRatePercent is validated here (AC10) but deliberately never written into `value`
  // below — R1: inflation is not a ProjectionInput, so a mapper-level check on the field cannot
  // let its parsed number leak into the engine's input shape.
  if (!inflationRateResult.ok) errors.inflationRatePercent = inflationRateResult.error;
  // targetAnnualIncome is validated here (AC14) but, like inflationRatePercent above, deliberately
  // never written into `value` below — it is not a ProjectionInput field (same reasoning as R1's
  // "inflation is not a ProjectionInput").
  if (!targetIncomeResult.ok) errors.targetAnnualIncome = targetIncomeResult.error;

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const initialCapitalNzd = mustParse(initialCapital);

  const value: ProjectionInput = {
    termYears: mustParse(termYears),
    compoundingPeriodsPerYear: 1, // fixed convention, stated as UI text not an input (spec)
    contributionsPerYear: 12, // fixed cadence: the extra contribution is monthly, never *12'd (invariant 3)
    contributionTiming: "start", // fixed convention, stated as UI text not an input (spec)
    // Unit-share convention (spec): `project()` works in shares; data/funds.json publishes
    // neither a share price nor a dividend per share. A synthetic 1 NZD unit makes every NZD
    // input absolute (project() is scale-invariant in price), inventing no price.
    initialShares: initialCapitalNzd,
    initialSharePriceNzd: 1,
    contributionPerEventNzd: mustParse(extraMonthlyContribution),
    sharePriceGrowth: mustParse(sharePriceGrowthPercent) / 100, // /100: percent -> decimal, once
    initialDividendPerShareNzd: mustParse(dividendYieldPercent) / 100, // /100, same unit-share convention
    dividendGrowth: mustParse(dividendGrowthPercent) / 100, // /100: percent -> decimal, once
    // Fixed net basis (spec): the seeded CAGR is already net of the expense ratio (invariant 7);
    // there is no expense-ratio input to make this otherwise.
    growthBasis: "net-of-expense-ratio",
    expenseRatioAnnual: 0,
    platformFeeAnnualRate: mustParse(platformFeePercent) / 100, // /100: percent -> decimal, once
    brokeragePerContributionNzd: mustParse(brokeragePerContribution),
    fxSpreadRate: mustParse(fxSpreadPercent) / 100, // /100: percent -> decimal, once
    usWithholdingRate: mustParse(usWithholdingPercent) / 100, // /100: percent -> decimal, once
    wrapper: form.wrapper,
    marginalRate: mustParse(marginalRatePercent) / 100, // /100: percent -> decimal, once
    pir: mustParsePir(pirResult),
    // fifThresholdNzd intentionally omitted — left at the engine default (spec: "FIF threshold
    // left at the engine default").
    contributionsStopYear: mustParseOptionalPhaseYear(contributionsStopYear),
    drawdownStartYear: mustParseOptionalPhaseYear(drawdownStartYear),
  };

  return { ok: true, value };
}

export type SeededAssumption = {
  ok: true;
  ticker: string;
  sharePriceGrowthPercent: number;
  dividendYieldPercent: number;
  asOf: string;
  source: string;
};

export type UnavailableAssumption = {
  ok: false;
  ticker: string;
  sharePriceGrowthPercent: "";
  message: string;
};

export type SeedAssumptionResult = SeededAssumption | UnavailableAssumption;

// AC7/AC8, Constitution §8: reads `fund.sharePriceGrowth` (already derived once by lib/funds.ts —
// never `totalReturnAnnualised - dividendYield` here, Constitution §6) and `fund.dividendYield`
// directly; a null on either means the assumption is unpublished, not zero.
export function seedAssumptionsFromFund(fund: Fund): SeedAssumptionResult {
  if (fund.sharePriceGrowth === null || fund.dividendYield === null) {
    return {
      ok: false,
      ticker: fund.ticker,
      sharePriceGrowthPercent: "",
      message: `${fund.ticker}: sharePriceGrowth is unpublished for this fund -- cannot seed a growth assumption`,
    };
  }
  return {
    ok: true,
    ticker: fund.ticker,
    // *100 mirrors the /100 conversions above, in reverse: the fund table stores a decimal, the
    // form field is percent-entry.
    sharePriceGrowthPercent: fund.sharePriceGrowth * 100,
    dividendYieldPercent: fund.dividendYield * 100,
    asOf: fund.asOf,
    source: fund.source,
  };
}

export type RunProjectionResult =
  | {
      ok: true;
      value: ProjectionResult;
      real: RealProjectionResult | undefined;
      // features/crossover-target-income/spec.md C3: only ever populated alongside `real` — a
      // nominal answer to a real ("today's dollars") question is the wrong-number failure mode, so
      // the toggle being off (real undefined) means no crossover is reported either.
      crossover: IncomeCrossover | undefined;
    }
  | { ok: false; errors: string[] };

// AC9: the three engine error classes this module imports (ProjectionInputError, TaxInputError,
// MissingAssumptionError) are surfaced as "<name>: <message>", verbatim, never swallowed. Any
// other thrown value is a genuine bug, not a validated-input rejection, and is rethrown rather
// than reported as a plausible-looking projection error.
export function formatEngineError(error: unknown): string {
  if (
    error instanceof ProjectionInputError ||
    error instanceof TaxInputError ||
    error instanceof MissingAssumptionError
  ) {
    return `${error.name}: ${error.message}`;
  }
  throw error;
}

// AC11 (spec.md R1): one project() call, then toRealTerms on its result — never a second
// projection for the real view. AC12: toRealTerms' own ProjectionInputError surfaces through
// formatEngineError exactly like project()'s does above, not caught and reworded.
export function runProjection(form: ProjectionFormState): RunProjectionResult {
  const built = buildProjectionInput(form);
  if (!built.ok) {
    return { ok: false, errors: Object.values(built.errors) };
  }

  let value: ProjectionResult;
  try {
    value = project(built.value);
  } catch (error) {
    return { ok: false, errors: [formatEngineError(error)] };
  }

  if (!form.showRealTerms) {
    // C3: no real view, so no crossover either, whatever the target field says.
    return { ok: true, value, real: undefined, crossover: undefined };
  }

  // buildProjectionInput already returned ok:false above if inflationRatePercent failed to parse,
  // so this second parse can only hit its ok:true branch here — re-parsing rather than trusting
  // that keeps this module's only percent->decimal arithmetic inside parseInflationRate itself.
  const inflationRateResult = parseInflationRate(form);
  if (!inflationRateResult.ok) {
    return { ok: false, errors: [inflationRateResult.error] };
  }
  const inflationRate = inflationRateResult.value;
  if (inflationRate === undefined) {
    // Unreachable: parseInflationRate only returns undefined when showRealTerms is false, and
    // this branch is guarded by `form.showRealTerms` above.
    throw new Error(
      "unreachable: parseInflationRate returned undefined while showRealTerms is true"
    );
  }

  let real: RealProjectionResult;
  try {
    real = toRealTerms(value, inflationRate);
  } catch (error) {
    return { ok: false, errors: [formatEngineError(error)] };
  }

  // Same "already validated by buildProjectionInput" re-parse pattern as inflationRate above — a
  // failed parse here is unreachable once buildProjectionInput returned ok:true.
  const targetIncomeResult = parseTargetIncome(form);
  if (!targetIncomeResult.ok) {
    throw new Error(
      "unreachable: parseTargetIncome failed after buildProjectionInput validated targetAnnualIncome"
    );
  }
  const target = targetIncomeResult.value;
  // AC16: one project() call total — findIncomeCrossover only ever reads the `real` result already
  // computed above, never re-running project() or toRealTerms() for the target.
  const crossover = target === undefined ? undefined : findIncomeCrossover(real, target);

  return { ok: true, value, real, crossover };
}

// The only place a phase is turned into display text (Constitution §2 — no phase logic or string
// mapping in the .tsx).
export function formatPhase(phase: "accumulate" | "coast" | "draw"): string {
  switch (phase) {
    case "accumulate":
      return "Accumulate";
    case "coast":
      return "Coast";
    case "draw":
      return "Draw";
  }
}

// AC14 (invariant 13): NaN/Infinity must never reach the UI. `-0` is finite and renders as a
// plain "$0" — it is a legitimate zero (e.g. a rounding artifact), not a small negative real.
export function formatNzd(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const normalised = value === 0 ? 0 : value;
  return `$${normalised.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
