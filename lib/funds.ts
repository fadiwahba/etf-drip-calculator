// The single authoritative, provenance-carrying fund table (Constitution §8) for the six presets
// (SCHD, FDVV, VYMI, DGRO, EUFN, VIG). Types live here, not in root `types.ts` -- same pattern as
// `lib/nzTax.ts` -- because this is a self-contained data-loading concern, not a UI-shared shape.
//
// Every figure in `data/funds.json` is primary-source (issuer's own page, HTTP 200) as of
// 2026-08-07 -- see `docs/fund-data-2026-08-07.md`, section "FINAL -- all six, primary source,
// 2026-08-07", which is the only authoritative source for this data. Each row carries its own
// `asOf` and `source`; do not flatten them to one date.
//
// VYMI's `dividendYield` and FDVV's `totalReturnAnnualised` are `null` because the issuer does not
// publish them in scrapable form as of the check date, not because they are zero (Constitution
// §8). FDVV becomes eligible for a true 10-year figure around 2026-09 (inception 2016-09-12).
//
// `dividendGrowth` is `null` on all six: no issuer publishes a multi-year per-share dividend CAGR,
// and using a trailing 1-year figure as a long-run assumption is banned by Constitution §6.
//
// `data/etfs.json` is frozen legacy pending the next slice (porting `app/etf-comparison/page.tsx`
// onto this loader) -- this module must never import it.
//
// Invariant 7 (calculator-invariants.md): these NAV total returns are already net of the expense
// ratio (issuer NAV performance is reported after fees), so a projection consuming
// `sharePriceGrowth` must not charge `expenseRatio` again on top of it.
//
// Pure module: no React/Next, no I/O beyond the static JSON import, no Date.now(), no module-level
// mutable state, no network.

import rawFundsData from "@/data/funds.json";

export type Domicile = "US" | "NZ" | "AU" | "IE";

export interface FundRow {
  ticker: string;
  name: string;
  domicile: Domicile;
  currency: "USD" | "NZD";
  asOf: string; // ISO yyyy-mm-dd, per row
  source: string; // issuer URL, https://
  expenseRatio: number | null; // decimal, net
  totalReturnAnnualised: number | null; // decimal, NAV, 10y
  totalReturnWindowYears: number | null; // 10 when the return is present, null when it is not
  dividendYield: number | null; // decimal, 30-day SEC yield
  dividendGrowth: number | null; // null on all six -- see module comment
  notes: string | null; // why a figure is null
}

export interface Fund extends FundRow {
  sharePriceGrowth: number | null; // DERIVED at load, never stored
}

export class FundDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FundDataError";
  }
}

export class MissingAssumptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingAssumptionError";
  }
}

type RawRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// AC9: a nullable field must be a deliberate `null`, never an absent key or `undefined` -- an
// omission is treated as a data-entry mistake, not "unknown".
function requirePresent(raw: RawRecord, field: string, idLabel: string): unknown {
  if (!(field in raw) || raw[field] === undefined) {
    throw new FundDataError(
      `${idLabel}: field "${field}" is missing -- it must be present, with null if unverified`
    );
  }
  return raw[field];
}

function assertNonEmptyString(raw: RawRecord, field: string, idLabel: string): string {
  const value = requirePresent(raw, field, idLabel);
  if (typeof value !== "string" || value.length === 0) {
    throw new FundDataError(`${idLabel}: field "${field}" must be a non-empty string`);
  }
  return value;
}

// A rate field stored as a decimal 0-1 (invariant 15): `min` bounds the low end (0 for
// expenseRatio/dividendYield), the high end is always "< 1" to catch a percent-shaped value
// (12.37 instead of 0.1237) before it reaches a projection.
function assertNullableRate(
  raw: RawRecord,
  field: string,
  idLabel: string,
  opts: { min?: number }
): number | null {
  const value = requirePresent(raw, field, idLabel);
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new FundDataError(`${idLabel}: field "${field}" must be a number or null`);
  }
  if (!Number.isFinite(value)) {
    throw new FundDataError(
      `${idLabel}: field "${field}" must be finite -- NaN/Infinity is not a valid figure`
    );
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new FundDataError(`${idLabel}: field "${field}" must be >= ${opts.min}`);
  }
  if (value >= 1) {
    throw new FundDataError(
      `${idLabel}: field "${field}" must be a decimal (0-1 convention), not a percent -- got ${value}`
    );
  }
  return value;
}

// totalReturnAnnualised may be negative -- a losing decade is real -- but must be > -1 (a total
// loss and beyond is not a valid annualised return) and, like every other rate, < 1.
function assertNullableTotalReturn(raw: RawRecord, field: string, idLabel: string): number | null {
  const value = requirePresent(raw, field, idLabel);
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new FundDataError(`${idLabel}: field "${field}" must be a number or null`);
  }
  if (!Number.isFinite(value)) {
    throw new FundDataError(
      `${idLabel}: field "${field}" must be finite -- NaN/Infinity is not a valid figure`
    );
  }
  if (value <= -1) {
    throw new FundDataError(`${idLabel}: field "${field}" must be > -1`);
  }
  if (value >= 1) {
    throw new FundDataError(
      `${idLabel}: field "${field}" must be a decimal (0-1 convention), not a percent -- got ${value}`
    );
  }
  return value;
}

function assertNullableWindowYears(raw: RawRecord, field: string, idLabel: string): number | null {
  const value = requirePresent(raw, field, idLabel);
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FundDataError(`${idLabel}: field "${field}" must be a finite number or null`);
  }
  return value;
}

function assertNullableNotes(raw: RawRecord, field: string, idLabel: string): string | null {
  const value = requirePresent(raw, field, idLabel);
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new FundDataError(`${idLabel}: field "${field}" must be a string or null`);
  }
  return value;
}

function parseRow(raw: unknown, index: number, seenTickers: Set<string>): FundRow {
  if (!isPlainObject(raw)) {
    throw new FundDataError(`funds[${index}]: row is not an object`);
  }

  // Ticker itself may be missing/invalid, so error messages before it is validated fall back to
  // the array index -- a message must always name *something* locatable in the source file.
  const rawTicker = raw.ticker;
  const idLabel =
    typeof rawTicker === "string" && rawTicker.length > 0 ? rawTicker : `funds[${index}]`;

  const ticker = assertNonEmptyString(raw, "ticker", idLabel);
  if (seenTickers.has(ticker)) {
    throw new FundDataError(`${ticker}: duplicate ticker`);
  }
  seenTickers.add(ticker);

  const name = assertNonEmptyString(raw, "name", ticker);

  const asOf = assertNonEmptyString(raw, "asOf", ticker);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new FundDataError(`${ticker}: field "asOf" must be ISO yyyy-mm-dd`);
  }

  const source = assertNonEmptyString(raw, "source", ticker);
  if (!source.startsWith("https://")) {
    throw new FundDataError(`${ticker}: field "source" must start with https://`);
  }

  const domicile = assertNonEmptyString(raw, "domicile", ticker);
  if (domicile !== "US" && domicile !== "NZ" && domicile !== "AU" && domicile !== "IE") {
    throw new FundDataError(`${ticker}: field "domicile" must be one of US, NZ, AU, IE`);
  }

  const currency = assertNonEmptyString(raw, "currency", ticker);
  if (currency !== "USD" && currency !== "NZD") {
    throw new FundDataError(`${ticker}: field "currency" must be USD or NZD`);
  }

  const expenseRatio = assertNullableRate(raw, "expenseRatio", ticker, { min: 0 });
  const totalReturnAnnualised = assertNullableTotalReturn(raw, "totalReturnAnnualised", ticker);
  const totalReturnWindowYears = assertNullableWindowYears(raw, "totalReturnWindowYears", ticker);
  const dividendYield = assertNullableRate(raw, "dividendYield", ticker, { min: 0 });
  // dividendGrowth has no lower bound in the spec (a shrinking payout is representable) but is
  // still subject to the decimal-convention ceiling and the NaN/Infinity guard.
  const dividendGrowth = assertNullableRate(raw, "dividendGrowth", ticker, {});
  const notes = assertNullableNotes(raw, "notes", ticker);

  // Constitution §6: a shorter or life-of-fund window is never silently swapped in for a 10-year
  // CAGR -- the window is pinned to 10 whenever a return is present, and the pair must agree on
  // nullness.
  if (totalReturnAnnualised !== null && totalReturnWindowYears !== 10) {
    throw new FundDataError(
      `${ticker}: field "totalReturnWindowYears" must be 10 when totalReturnAnnualised is present`
    );
  }
  if ((totalReturnAnnualised === null) !== (totalReturnWindowYears === null)) {
    throw new FundDataError(
      `${ticker}: totalReturnAnnualised and totalReturnWindowYears must both be null or both be present`
    );
  }

  // A null figure must be explained (Constitution §8) -- dividendGrowth is exempt because it is
  // null on all six rows for the same reason, documented once in the module comment above.
  const requiresNotes = expenseRatio === null || totalReturnAnnualised === null || dividendYield === null;
  if (requiresNotes && (notes === null || notes.length === 0)) {
    throw new FundDataError(
      `${ticker}: field "notes" must explain why a figure is null when expenseRatio, totalReturnAnnualised or dividendYield is null`
    );
  }

  return {
    ticker,
    name,
    domicile,
    currency,
    asOf,
    source,
    expenseRatio,
    totalReturnAnnualised,
    totalReturnWindowYears,
    dividendYield,
    dividendGrowth,
    notes,
  };
}

export function parseFunds(raw: unknown): Fund[] {
  if (!Array.isArray(raw)) {
    throw new FundDataError("funds data must be an array");
  }

  const seenTickers = new Set<string>();
  return raw.map((entry, index) => {
    const parsedRow = parseRow(entry, index, seenTickers);
    // Constitution §6 / invariant 5: price return = total return - dividend yield, derived here
    // and only here so it can never be stored, go stale, or be summed twice with a yield.
    const sharePriceGrowth =
      parsedRow.totalReturnAnnualised !== null && parsedRow.dividendYield !== null
        ? parsedRow.totalReturnAnnualised - parsedRow.dividendYield
        : null;
    return { ...parsedRow, sharePriceGrowth };
  });
}

export function loadFunds(): Fund[] {
  return parseFunds(rawFundsData);
}

export function getFund(ticker: string): Fund {
  const fund = loadFunds().find((f) => f.ticker === ticker);
  if (!fund) {
    throw new FundDataError(`Unknown ticker "${ticker}"`);
  }
  return fund;
}

export function isProjectable(fund: Fund): boolean {
  return fund.sharePriceGrowth !== null;
}

export function requirePriceGrowth(fund: Fund): number {
  if (fund.sharePriceGrowth === null) {
    throw new MissingAssumptionError(
      `${fund.ticker}: sharePriceGrowth is unavailable -- cannot run a projection off a null assumption`
    );
  }
  return fund.sharePriceGrowth;
}

function computeAsOfFloor(funds: Fund[]): string {
  return funds.reduce((min, f) => (f.asOf < min ? f.asOf : min), funds[0].asOf);
}

// Computed from the parsed data, not typed in -- if a row's asOf changes on the next refresh,
// this floor moves with it automatically.
export const FUND_DATA_AS_OF: string = computeAsOfFloor(parseFunds(rawFundsData));

// --- Blend composition (D1-D4, PRODUCT-NOTES §8) ---------------------------------------------
//
// D1: `policy` is a *required* argument, no default, because PRODUCT-NOTES §8 names the six-fund
// "Dividend Blend" while VYMI (null dividendYield) and FDVV (null totalReturnAnnualised) are still
// unprojectable -- see docs/fund-data-2026-08-07.md § FINAL. Two honest answers exist, and only the
// caller may pick which one they want:
//   "strict"               -- the whole-membership answer: every blended figure is null while any
//                              requested member is unprojectable (Constitution §8 -- null, never 0).
//   "excludeUnprojectable" -- the only way to reach a number: drop the unprojectable members,
//                              renormalise the survivors' weights to sum 1, and carry `excluded` so
//                              no caller can present a partial blend as the full six-fund label.
// Coercing a null to 0 is banned outright (§8): equalWeights(DIVIDEND_BLEND_TICKERS) would give
// 0.0723 growth that way, against the honest four-fund 0.10845 -- a 3.615pp wrong number that is
// exactly the "plausible but wrong" failure this project exists to prevent.
//
// D2: PRODUCT-NOTES §8 records *membership*, not an allocation -- inventing one breaches
// Constitution §3. `equalWeights` is the only weight source exposed by this module; any other
// allocation is the caller's own input, never invented here. Weights are fractions of capital
// (NZD market value), never of units (PRODUCT-NOTES §7.3).
//
// D3: all four fields are weighted arithmetic means, Σ wᵢ·xᵢ. Expense ratio and dividend yield are
// exact this way -- both are a percentage of each holding's value, so total/portfolio value *is*
// the capital-weighted mean. Price growth is exact only under this project's model: each fund at
// one constant annual rate, weights held by *annual rebalancing* (PRODUCT-NOTES §7.5's accepted
// simplification) -- a buy-and-hold blend would need (Σ wᵢ(1+gᵢ)¹⁰)^(1/10) − 1 and drift weight
// toward the winner (50/50 of 20%/0% gives 10.00% rebalanced vs ≈13.65% buy-and-hold). Blending
// totalReturnAnnualised keeps §6 checkable: growth = TR − yield holds for the blend because all
// three are linear in the same weights.
//
// Invariant 7 (calculator-invariants.md): totalReturnAnnualised is a weighted mean of per-fund NAV
// total returns, which are already net of each fund's own expense ratio (see the per-fund comment
// above). expenseRatio here is the same weighted mean applied to the ratio field, not a cost still
// owed on top -- a caller projecting off the blend must use totalReturnAnnualised (or
// sharePriceGrowth) as-is and must not additionally subtract the blended expenseRatio, or the fee
// is charged twice.
//
// D4: `asOf` is the oldest among *contributing* members -- a blend is never fresher than its
// stalest input -- and null when nothing contributes. `sources` carries every requested member,
// excluded included, so provenance is never silently dropped. Membership is decided once, by
// isProjectable; a contributing member with a null in some other field (e.g. Fixture E's FDVV-like
// null expenseRatio) nulls that whole blended field, never a per-field re-exclusion, never 0 --
// every non-null figure still covers one identical membership.

export type BlendPolicy = "strict" | "excludeUnprojectable";

export interface BlendWeight {
  ticker: string;
  weight: number; // fraction of capital; effective weights in `members` sum to 1
}

export interface BlendExclusion {
  ticker: string;
  requestedWeight: number;
  reason: string;
}

export interface BlendProvenance {
  ticker: string;
  asOf: string;
  source: string;
}

export interface Blend {
  policy: BlendPolicy;
  requested: BlendWeight[];
  members: BlendWeight[];
  excluded: BlendExclusion[];
  isComplete: boolean;
  sharePriceGrowth: number | null;
  dividendYield: number | null;
  expenseRatio: number | null;
  totalReturnAnnualised: number | null;
  asOf: string | null;
  sources: BlendProvenance[];
}

// PRODUCT-NOTES §8's "Dividend Blend" preset membership, in the order the preset is documented --
// every other array in a Blend (requested/members/excluded/sources) preserves this request order.
export const DIVIDEND_BLEND_TICKERS: readonly string[] = [
  "SCHD",
  "FDVV",
  "VYMI",
  "DGRO",
  "EUFN",
  "VIG",
];

const BLEND_WEIGHT_SUM_TOLERANCE = 1e-9;

function requireValidBlendWeight(weight: unknown, ticker: string): number {
  if (typeof weight !== "number") {
    throw new FundDataError(`${ticker}: weight must be a number`);
  }
  if (!Number.isFinite(weight)) {
    throw new FundDataError(
      `${ticker}: weight must be finite -- NaN/Infinity is not a valid weight`
    );
  }
  if (weight <= 0) {
    throw new FundDataError(
      `${ticker}: weight must be > 0 -- a zero or negative weight is not a valid allocation`
    );
  }
  return weight;
}

function requireValidBlendPolicy(policy: BlendPolicy): BlendPolicy {
  if (policy !== "strict" && policy !== "excludeUnprojectable") {
    throw new FundDataError(
      `policy must be "strict" or "excludeUnprojectable" -- got ${JSON.stringify(policy)}`
    );
  }
  return policy;
}

export function equalWeights(tickers: readonly string[]): BlendWeight[] {
  if (tickers.length === 0) {
    throw new FundDataError("equalWeights: tickers must be non-empty -- 1/0 is not a weight");
  }
  const weight = 1 / tickers.length;
  return tickers.map((ticker) => ({ ticker, weight }));
}

interface ResolvedBlendMember {
  ticker: string;
  weight: number;
  fund: Fund;
}

// A single blended field is null the moment any contributing member's own value is null (D4) --
// never re-excluded per field, never coerced to 0 (Constitution §8).
function blendField(
  contributing: ResolvedBlendMember[],
  select: (fund: Fund) => number | null
): number | null {
  if (contributing.length === 0) return null;
  let sum = 0;
  for (const member of contributing) {
    const value = select(member.fund);
    if (value === null) return null;
    sum += member.weight * value;
  }
  return sum;
}

function oldestContributingAsOf(contributing: ResolvedBlendMember[]): string | null {
  if (contributing.length === 0) return null;
  return contributing.reduce(
    (min, member) => (member.fund.asOf < min ? member.fund.asOf : min),
    contributing[0].fund.asOf
  );
}

// Mirrors `parseFunds` -- all blend arithmetic lives here (invariant §2), `buildBlend` only
// supplies `loadFunds()`.
export function blendFunds(funds: Fund[], members: BlendWeight[], policy: BlendPolicy): Blend {
  requireValidBlendPolicy(policy);

  if (members.length === 0) {
    throw new FundDataError("blendFunds: members must be non-empty");
  }

  const seenTickers = new Set<string>();
  for (const member of members) {
    requireValidBlendWeight(member.weight, member.ticker);
    if (seenTickers.has(member.ticker)) {
      throw new FundDataError(`${member.ticker}: duplicate ticker in blend membership`);
    }
    seenTickers.add(member.ticker);
  }

  const weightSum = members.reduce((sum, member) => sum + member.weight, 0);
  if (Math.abs(weightSum - 1) > BLEND_WEIGHT_SUM_TOLERANCE) {
    throw new FundDataError(
      `blendFunds: weights must sum to 1 (within ${BLEND_WEIGHT_SUM_TOLERANCE}) -- got ${weightSum}`
    );
  }

  const resolved: ResolvedBlendMember[] = members.map((member) => {
    const fund = funds.find((f) => f.ticker === member.ticker);
    if (!fund) {
      throw new FundDataError(`Unknown ticker "${member.ticker}"`);
    }
    return { ticker: member.ticker, weight: member.weight, fund };
  });

  const requested: BlendWeight[] = members.map((member) => ({
    ticker: member.ticker,
    weight: member.weight,
  }));
  const sources: BlendProvenance[] = resolved.map((member) => ({
    ticker: member.ticker,
    asOf: member.fund.asOf,
    source: member.fund.source,
  }));

  const nonProjectable = resolved.filter((member) => !isProjectable(member.fund));
  const projectable = resolved.filter((member) => isProjectable(member.fund));

  let contributing: ResolvedBlendMember[];
  let excluded: BlendExclusion[];

  if (policy === "strict") {
    if (nonProjectable.length > 0) {
      // The honest six-fund answer: no partial number, so nothing contributes.
      contributing = [];
      excluded = nonProjectable.map((member) => ({
        ticker: member.ticker,
        requestedWeight: member.weight,
        reason: member.fund.notes ?? "",
      }));
    } else {
      contributing = resolved;
      excluded = [];
    }
  } else {
    excluded = nonProjectable.map((member) => ({
      ticker: member.ticker,
      requestedWeight: member.weight,
      reason: member.fund.notes ?? "",
    }));
    const survivorWeightSum = projectable.reduce((sum, member) => sum + member.weight, 0);
    contributing =
      survivorWeightSum > 0
        ? projectable.map((member) => ({
            ticker: member.ticker,
            weight: member.weight / survivorWeightSum,
            fund: member.fund,
          }))
        : [];
  }

  const blendMembers: BlendWeight[] = contributing.map((member) => ({
    ticker: member.ticker,
    weight: member.weight,
  }));

  return {
    policy,
    requested,
    members: blendMembers,
    excluded,
    isComplete: excluded.length === 0,
    sharePriceGrowth: blendField(contributing, (f) => f.sharePriceGrowth),
    dividendYield: blendField(contributing, (f) => f.dividendYield),
    expenseRatio: blendField(contributing, (f) => f.expenseRatio),
    totalReturnAnnualised: blendField(contributing, (f) => f.totalReturnAnnualised),
    asOf: oldestContributingAsOf(contributing),
    sources,
  };
}

export function buildBlend(members: BlendWeight[], policy: BlendPolicy): Blend {
  return blendFunds(loadFunds(), members, policy);
}

export function requireBlendPriceGrowth(blend: Blend): number {
  if (blend.sharePriceGrowth === null) {
    const excludedNames = blend.excluded.map((e) => e.ticker).join(", ");
    throw new MissingAssumptionError(
      `blend: sharePriceGrowth is unavailable${
        excludedNames.length > 0 ? ` -- ${excludedNames} cannot be projected` : ""
      }`
    );
  }
  return blend.sharePriceGrowth;
}
