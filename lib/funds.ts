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
