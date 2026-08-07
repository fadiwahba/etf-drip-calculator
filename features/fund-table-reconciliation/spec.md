# fund-table-reconciliation

## Scope

One authoritative, provenance-carrying fund table for the six agreed presets (SCHD, FDVV, VYMI, DGRO,
EUFN, VIG), plus a validated typed loader in `lib/`. No UI.

**Files.**

- **New `data/funds.json`** — the authority. Row shape below. Values are **decimals 0–1**, matching
  `lib/nzTax.ts`. Percent formatting happens at the display layer in a later slice, never here.
- **New `lib/funds.ts`** — types + validating loader. Types live here, **not** in root `types.ts`
  (same pattern as `lib/nzTax.ts`); `types.ts` is not touched.
- **New `lib/__tests__/funds.test.ts`** — one RED test per AC first.
- **Delete `data/dividend_portfolio.json`.** Grep confirms **zero importers** (only doc mentions).
  Its `sharePriceGrowth` column holds trailing 1-year TOTAL returns and is unusable.
- **`data/etfs.json` is NOT touched — byte-identical after this slice.** `app/etf-comparison/page.tsx`
  imports it as a bare array (`etfsData.map(...)`); editing its shape breaks `pnpm build`, and editing
  its numbers changes rendered output, which needs the UI slice's before/after. It becomes frozen
  legacy, consumed only by that one already-defective page (audit finding 8). Porting that page onto
  `lib/funds.ts` and deleting `etfs.json` is the **next** slice. `lib/funds.ts` must never import it.

**Data.** All figures, sources, conflicts and the arithmetic are in **`docs/fund-data-2026-08-07.md`**
— read it before writing a single number. Do not source numbers anywhere else; the coder has no web
access. Headline: yield convention is **TTM distribution yield** on every row (no SEC 30-day figure was
verifiable); returns are **annualised total return, NAV, 10-year**, except FDVV which is **9.9y
since-inception and flagged as such**; `dividendGrowth` is **`null` on all six rows**.

**Row shape** (`data/funds.json` is a bare JSON array of these):

```ts
type Domicile = "US" | "NZ" | "AU" | "IE";
interface FundRow {
  ticker: string; name: string; domicile: Domicile; currency: "USD" | "NZD";
  asOf: string;                            // ISO yyyy-mm-dd
  source: string;                          // http(s) URL
  expenseRatio: number;                    // decimal, required, >= 0
  totalReturnAnnualised: number | null;    // decimal, NAV basis
  totalReturnWindowYears: number;          // 10, or the true window if shorter
  totalReturnIsSinceInception: boolean;
  dividendYield: number | null;            // decimal, TTM distribution yield
  dividendGrowth: number | null;           // null = unverified, never 0
  notes: string | null;
}
interface Fund extends FundRow { priceGrowth: number | null; }  // DERIVED at load
```

**Loader contract** (`lib/funds.ts`):

```ts
export function parseFunds(raw: unknown): Fund[];   // pure; throws FundDataError
export function loadFunds(): Fund[];                // parseFunds(imported JSON)
export function getFund(ticker: string): Fund;      // throws on unknown ticker
export class FundDataError extends Error {}
export const FUND_DATA_AS_OF: string;               // "2026-07-31"
```

`priceGrowth = totalReturnAnnualised − dividendYield`, computed **only** in `parseFunds` and `null` if
either input is `null` (Constitution §6, invariant 5). It is never stored in JSON, so it cannot go
stale. `parseFunds` is exported so failure paths are testable without touching the on-disk file.

## Acceptance Criteria

Each AC is one RED test first. Rates are decimals; use `toBeCloseTo` (invariant 15), not `toBe`.

1. **Six rows, exact tickers.** `loadFunds()` returns 6 funds with tickers exactly
   `["SCHD","FDVV","VYMI","DGRO","EUFN","VIG"]`. `getFund("SCHD")` returns that row;
   `getFund("VOO")` throws `FundDataError`.
2. **Price growth is derived, per fund.** `priceGrowth` ≈ SCHD **0.0957**, FDVV **0.1111**,
   VYMI **0.0751**, DGRO **0.1151**, EUFN **0.1053**, VIG **0.1150** (10 dp tolerance).
   Each equals that row's `totalReturnAnnualised − dividendYield` — assert the identity, not just
   the constant.
3. **Stored inputs match the sourced data.** `totalReturnAnnualised` / `dividendYield` /
   `expenseRatio`: SCHD `0.127 / 0.0313 / 0.0006`; FDVV `0.1388 / 0.0277 / 0.0015`;
   VYMI `0.110 / 0.0349 / 0.0007`; DGRO `0.134 / 0.0189 / 0.0008`; EUFN `0.145 / 0.0397 / 0.0049`;
   VIG `0.130 / 0.0150 / 0.0004`.
4. **The polluted values are gone.** No row has `totalReturnAnnualised` or `priceGrowth` within
   `0.005` of the old 1-year total returns (SCHD 0.2408, FDVV 0.1964, VYMI 0.3383, DGRO 0.2100,
   EUFN 0.2845, VIG 0.1753). SCHD's growth assumption is **0.0957**, not 0.2408.
5. **`null` means unverified, and `0` never does.** `dividendGrowth === null` on all six rows.
   No row has `dividendYield === 0` or `expenseRatio === 0`. A row with `dividendGrowth: 0` parses
   fine (0 is a legal growth rate) — the test asserts the shipped data uses `null`.
6. **`priceGrowth` is derived, not stored.** Every object in the raw `data/funds.json` array has no
   `priceGrowth` and no `sharePriceGrowth` key. Feed `parseFunds` a row with `dividendYield: null` →
   `priceGrowth === null` (not `0`, not `NaN`).
7. **Provenance is required on every row.** All six have non-empty `source` starting `https://`,
   `asOf` matching `/^\d{4}-\d{2}-\d{2}$/`, `domicile === "US"`, `currency === "USD"`, and a numeric
   `expenseRatio`. `FUND_DATA_AS_OF === "2026-07-31"`.
8. **A short window is declared, never silent.** FDVV has `totalReturnIsSinceInception === true` and
   `totalReturnWindowYears` ≈ `9.9`. The other five have `false` and `10`. `parseFunds` throws
   `FundDataError` when `totalReturnIsSinceInception === false` and `totalReturnWindowYears !== 10`.
9. **Missing required fields fail loudly, they do not default.** `parseFunds` throws `FundDataError`
   naming the offending ticker and field when any of `ticker`, `name`, `domicile`, `currency`,
   `asOf`, `source`, `expenseRatio`, `totalReturnWindowYears`, `totalReturnIsSinceInception` is
   absent or `null`. Nothing is coerced to `0` or `""` (invariant 14).
10. **Malformed shapes throw.** `FundDataError` for: `raw` not an array; a non-object element;
    duplicate tickers; `domicile` outside the union; `source` not `http(s)://`; `asOf` not ISO
    `yyyy-mm-dd`; a string where a number belongs.
11. **`NaN` / `Infinity` never escape.** `parseFunds` throws for `NaN` or `±Infinity` in any numeric
    field, including via a JSON `null`-vs-number mix-up. For the real data, every numeric field of
    every `Fund` — `priceGrowth` included — satisfies `Number.isFinite` (invariant 13).
12. **One percentage convention, enforced.** `expenseRatio`, `dividendYield`, `dividendGrowth` and
    `totalReturnAnnualised` must be `< 1`; a percent-shaped value (`3.13`, `0.06` meaning 6bp vs 6%
    is the trap) throws `FundDataError`. `expenseRatio` and `dividendYield` must be `>= 0`;
    `totalReturnAnnualised` may be negative (a losing decade is real) but must be `> -1`.
13. **The old file is gone and the legacy one is untouched.** `data/dividend_portfolio.json` does not
    exist. `lib/funds.ts` and `data/funds.json` contain no reference to `etfs.json` or
    `dividend_portfolio.json`. `data/etfs.json` is unchanged (`git diff --exit-code data/etfs.json`
    is clean) and `app/etf-comparison/page.tsx` is unchanged.
14. **Build and lint survive.** `pnpm test` green, `pnpm lint` zero warnings, `pnpm build` succeeds.

## Out of Scope

- **Any UI.** No component, page, hook, dropdown, preset selector or `asOf` footer. No rendered number
  changes, so **no before/after comparison applies** to this slice.
- Editing `data/etfs.json`, `app/etf-comparison/page.tsx`, root `types.ts`, `lib/nzTax.ts`, or any
  component. Migrating the comparison page off `etfs.json` and deleting it is the next slice.
- Blend/weighted-portfolio maths, `weight` fields, SCHD-vs-Blend comparison.
- Sourcing `dividendGrowth`. It stays `null`; deriving a per-share CAGR from distribution history is
  its own slice.
- Share prices, FX rates, NZD conversion, risk ratings, 1/3/5-year returns, AUM, holdings.
- Any projection, fee, DRIP or tax maths. The loader returns data; it computes nothing but
  `priceGrowth`.
- Adding funds beyond the six. No live data feed, no fetching at runtime or build time.
- A runtime schema library (Zod etc.). **Do not add a dependency** — hand-write the validator.

## Coder Guardrails

- **Read `docs/fund-data-2026-08-07.md` first and take every number from it.** You have no web access.
  If a figure you need is not there, it is `null` — **do not invent one, do not carry forward a value
  from `data/dividend_portfolio.json`, do not use `0`** (Constitution §3, §8). If a number in this spec
  disagrees with that doc, stop and raise a blocker; do not pick one.
- **TDD is mandatory.** One failing test per AC before any implementation. If an expected value here
  contradicts your reading, raise a blocker rather than editing the fixture to match your code.
- Touch only: create `data/funds.json`, `lib/funds.ts`, `lib/__tests__/funds.test.ts`; delete
  `data/dividend_portfolio.json`. Nothing else. `pnpm build` must still pass, which is why
  `data/etfs.json` and `app/etf-comparison/page.tsx` are off limits.
- **Fail loudly, never default** (Constitution §1, invariant 14). Every validation path throws
  `FundDataError` with a message naming the ticker and the field. No `?? 0`, no `|| ""`, no
  `Number(x)` on a possibly-empty value, no silent row-skipping.
- `null` is a first-class "unverified" value and must be distinct from `0` in the type
  (`number | null`, not `number`). Do not widen to `undefined`.
- Decimals 0–1 everywhere, same as `lib/nzTax.ts`. **No conversion happens in `lib/funds.ts`** — it
  belongs in the display layer, later.
- `priceGrowth` is derived in exactly one place, inside `parseFunds`, with a comment citing
  Constitution §6 / invariant 5 and `docs/fund-data-2026-08-07.md` §3 for the arithmetic.
- Add a `why` comment in `lib/funds.ts` recording: (a) issuer pages returned HTTP 403 on 2026-08-07 so
  figures come from AAII with a stockanalysis.com cross-check, and the table is to be re-verified
  against the issuer when reachable; (b) `data/etfs.json` is frozen legacy pending the next slice;
  (c) invariant 7 — these NAV returns are already net of the expense ratio, so a projection must not
  charge `expenseRatio` on top of `priceGrowth`. Comments explain *why*, not *what* (Constitution §9).
- Pure module: no React/Next, no I/O beyond the static JSON import, no `Date.now()`, no module-level
  mutable state, no network.
- TypeScript strict. **No `any`**, no non-null assertions, no unchecked casts of the imported JSON —
  take it as `unknown` and validate it. `pnpm lint` zero warnings before close.
