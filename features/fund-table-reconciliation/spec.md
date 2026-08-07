# fund-table-reconciliation

## Scope

One authoritative, provenance-carrying fund table for the six presets (SCHD, FDVV, VYMI, DGRO, EUFN,
VIG), plus a validated typed loader in `lib/`. No UI.

Two of the six rows are **incomplete at the source**: VYMI has no scrapable yield, FDVV has no 10-year
return. That is not an edge case to tolerate — handling it correctly is the point of this slice.
`null` means *unverified*. It is never `0`, never defaulted, never substituted, and a projection can
never be run off it.

**Files.**

- **New `data/funds.json`** — the authority. Bare JSON array of the row shape below. Values are
  **decimals 0–1**, matching `lib/nzTax.ts` (`12.37%` → `0.1237`). Percent formatting happens at the
  display layer in a later slice, never here.
- **New `lib/funds.ts`** — types + validating loader. Types live here, **not** in root `types.ts`
  (same pattern as `lib/nzTax.ts`); `types.ts` is not touched.
- **New `lib/__tests__/funds.test.ts`** — one RED test per AC first.
- **Delete `data/dividend_portfolio.json`.** Grep confirms **zero code importers** (docs only). Its
  `sharePriceGrowth` column holds trailing 1-year TOTAL returns and is unusable.
- **`data/etfs.json` is NOT touched — byte-identical after this slice.** `app/etf-comparison/page.tsx`
  imports it as a bare array; changing either breaks `pnpm build` or changes rendered output. It is
  frozen legacy. Porting that page onto `lib/funds.ts` is the **next** slice. `lib/funds.ts` must
  never import it.

**Data.** Every number comes from **`docs/fund-data-2026-08-07.md`, section
`## FINAL — all six, primary source, 2026-08-07`** and nowhere else. All six rows are HTTP 200 from
the issuer's own page. Conventions on every row: yield is the **30-day SEC yield**; return is
**annualised total return, NAV basis, 10-year window**; expense ratio is **net**; `dividendGrowth` is
**`null` on all six**. `asOf` differs per row — carry the row's own date, do not flatten it.

**Row shape:**

```ts
type Domicile = "US" | "NZ" | "AU" | "IE";
interface FundRow {
  ticker: string; name: string; domicile: Domicile; currency: "USD" | "NZD";
  asOf: string;                           // ISO yyyy-mm-dd, per row
  source: string;                         // issuer URL, https://
  expenseRatio: number | null;            // decimal
  totalReturnAnnualised: number | null;   // decimal, NAV, 10y
  totalReturnWindowYears: number | null;  // 10 when the return is present, null when it is not
  dividendYield: number | null;           // decimal, 30-day SEC yield
  dividendGrowth: number | null;          // null on all six
  notes: string | null;                   // why a figure is null
}
interface Fund extends FundRow { sharePriceGrowth: number | null; }  // DERIVED at load
```

**Loader contract** (`lib/funds.ts`):

```ts
export function parseFunds(raw: unknown): Fund[];   // pure; throws FundDataError
export function loadFunds(): Fund[];                // parseFunds(imported JSON)
export function getFund(ticker: string): Fund;      // throws FundDataError on unknown ticker
export function isProjectable(fund: Fund): boolean; // sharePriceGrowth !== null; never throws
export function requirePriceGrowth(fund: Fund): number;  // throws MissingAssumptionError
export class FundDataError extends Error {}         // the data file is invalid
export class MissingAssumptionError extends Error {} // the data is valid; this use of it is not
export const FUND_DATA_AS_OF: string;               // oldest asOf across the rows
```

`sharePriceGrowth = totalReturnAnnualised − dividendYield`, computed **only** inside `parseFunds`
(Constitution §6, invariant 5), and `null` if either input is `null`. It is never stored in JSON, so
it cannot go stale.

## Acceptance Criteria

One RED test per AC, first. Rates are decimals; use `toBeCloseTo` (invariant 15), not `toBe`, for
derived values. Use `toBeNull` / `Object.is` for nulls.

1. **Six rows, exact tickers.** `loadFunds()` returns 6 funds with tickers exactly
   `["SCHD","FDVV","VYMI","DGRO","EUFN","VIG"]` (order-insensitive). `getFund("SCHD")` returns that
   row; `getFund("VOO")` throws `FundDataError`. Every `name` is a non-empty string.
2. **Stored inputs match the FINAL section.** `totalReturnAnnualised / dividendYield / expenseRatio`:
   SCHD `0.1237 / 0.0325 / 0.0006`; DGRO `0.1338 / 0.0198 / 0.0008`; VIG `0.1299 / 0.0144 / 0.0004`;
   EUFN `0.1436 / 0.0305 / 0.0049`; VYMI `0.1098 / null / 0.0007`; FDVV `null / 0.0259 / null`.
3. **`sharePriceGrowth` is derived, per fund.** SCHD ≈ `0.0912`, DGRO ≈ `0.1140`, VIG ≈ `0.1155`,
   EUFN ≈ `0.1131`; VYMI `null`; FDVV `null`. For the four numeric rows, also assert the identity
   `sharePriceGrowth === totalReturnAnnualised − dividendYield`, not just the constant.
4. **`null` is unverified and is never `0`.** `dividendGrowth === null` on all six.
   `getFund("VYMI").dividendYield` and `getFund("FDVV").totalReturnAnnualised` and
   `getFund("FDVV").expenseRatio` are each `null` — assert `Object.is(x, 0) === false` and
   `x !== 0` as well as `x === null`, so a future `0` default fails the test. No row anywhere has a
   `0` in `dividendYield`, `expenseRatio` or `totalReturnAnnualised`.
5. **Nullability is in the type.** `lib/__tests__/funds.test.ts` contains, and `pnpm build` passes
   with:
   ```ts
   // @ts-expect-error sharePriceGrowth is number | null — a caller must handle the null
   const g: number = getFund("SCHD").sharePriceGrowth;
   ```
   (reference `g` afterwards so lint stays clean). If the field were ever widened to `number`, the
   now-unused `@ts-expect-error` becomes TS2578 and the build fails. tsconfig `include` covers
   `**/*.ts`, so this is enforced, not decorative.
6. **The two incomplete rows still load and stay selectable.** `loadFunds()` contains VYMI and FDVV;
   neither is filtered, skipped or throws on parse. `getFund("VYMI")` and `getFund("FDVV")` return
   full rows with their `asOf`, `source`, `name` and every non-null figure intact.
   `isProjectable` is `false` for VYMI and FDVV, `true` for SCHD, DGRO, VIG and EUFN, and never
   throws — a caller can list all six and mark two as *assumption unavailable*.
7. **A projection cannot run off a `null` growth figure.** `requirePriceGrowth(getFund("SCHD"))`
   ≈ `0.0912`. `requirePriceGrowth(getFund("VYMI"))` and `requirePriceGrowth(getFund("FDVV"))` each
   throw `MissingAssumptionError` whose message names the ticker and `sharePriceGrowth`. It returns
   `number` — never `0`, `NaN` or `null` — for every projectable fund. `MissingAssumptionError` is
   not a `FundDataError`: the file is valid, the use is not.
8. **A null figure must be explained.** VYMI and FDVV have a non-empty `notes` string.
   `parseFunds` throws `FundDataError` when `totalReturnAnnualised`, `dividendYield` or
   `expenseRatio` is `null` while `notes` is `null` or empty. (`dividendGrowth` is exempt — it is
   `null` on all six and explained once in the module comment.)
9. **Explicit `null` only; an absent key is an error.** For every nullable field, `parseFunds` accepts
   the key present with value `null`, and throws `FundDataError` naming the ticker and field when the
   key is **absent** or `undefined`. A missing figure must be a deliberate statement, not an omission.
10. **The window is pinned, never substituted.** `totalReturnWindowYears === 10` for SCHD, DGRO, VIG,
    EUFN and VYMI; `null` for FDVV. `parseFunds` throws `FundDataError` when
    `totalReturnAnnualised` is non-null and the window is anything other than `10`, and when exactly
    one of the two is `null` (Constitution §6 — a shorter or life-of-fund window is never swapped in
    for a 10-year CAGR).
11. **Provenance is required on every row, including the null ones.** All six have `source` starting
    `https://`, `asOf` matching `/^\d{4}-\d{2}-\d{2}$/`, `domicile === "US"`, `currency === "USD"`.
    `asOf` is `"2026-06-30"` for SCHD, DGRO, EUFN and FDVV, and `"2026-07-31"` for VIG and VYMI.
    `FUND_DATA_AS_OF === "2026-06-30"` and equals the minimum `asOf` across the parsed rows — computed
    from the data, not typed in.
12. **`sharePriceGrowth` is derived, not stored.** No object in the raw `data/funds.json` array has a
    `sharePriceGrowth` or `priceGrowth` key. Feed `parseFunds` a hand-built row with
    `dividendYield: null` → `sharePriceGrowth === null` (not `0`, not `NaN`); same with
    `totalReturnAnnualised: null`.
13. **Malformed shapes fail loudly, nothing is coerced.** `parseFunds` throws `FundDataError` naming
    the ticker and field for: `raw` not an array; a non-object element; a missing or empty `ticker`,
    `name`, `asOf` or `source`; duplicate tickers; `domicile` outside the union; `source` not
    `https://`; `asOf` not ISO `yyyy-mm-dd`; a string where a number belongs. Nothing becomes `0` or
    `""` (invariant 14), no row is silently dropped.
14. **`NaN` / `Infinity` never escape.** `parseFunds` throws for `NaN` or `±Infinity` in any numeric
    field. For the real data, every non-null numeric field of every `Fund` — `sharePriceGrowth`
    included — satisfies `Number.isFinite` (invariant 13).
15. **One percentage convention, enforced.** Non-null `expenseRatio`, `dividendYield`,
    `dividendGrowth` and `totalReturnAnnualised` must be `< 1`; a percent-shaped value (`12.37`,
    `3.25`) throws `FundDataError`. `expenseRatio` and `dividendYield` must be `>= 0`;
    `totalReturnAnnualised` may be negative (a losing decade is real) but must be `> -1`.
16. **Old file gone, legacy untouched, build survives.** `data/dividend_portfolio.json` does not
    exist. `lib/funds.ts` and `data/funds.json` reference neither `etfs.json` nor
    `dividend_portfolio.json`. `data/etfs.json` and `app/etf-comparison/page.tsx` are unchanged
    (`git diff --exit-code` clean on both). `pnpm test` green, `pnpm lint` zero warnings,
    `pnpm build` succeeds.

## Out of Scope

- **Any UI.** No component, page, hook, dropdown, preset selector or `asOf` footer. No rendered number
  changes, so **no before/after comparison applies** to this slice.
- A user-supplied override for a missing assumption. `requirePriceGrowth` fails loudly; letting a
  caller pass its own growth figure is a later slice with its own provenance question.
- Editing `data/etfs.json`, `app/etf-comparison/page.tsx`, root `types.ts`, `lib/nzTax.ts`, or any
  component. Migrating the comparison page off `etfs.json` is the next slice.
- Sourcing the two missing figures. VYMI's yield and FDVV's 10-year return stay `null` until a
  primary source publishes them (FDVV reaches a true 10-year window around 2026-09).
- Sourcing `dividendGrowth`. It stays `null`; a per-share CAGR from distribution history is its own
  slice.
- Blend/weighted-portfolio maths, share prices, FX, NZD conversion, risk ratings, 1/3/5-year returns.
- Any projection, fee, DRIP or tax maths. The loader computes nothing but `sharePriceGrowth`.
- Adding funds beyond the six. No live feed, no fetching at runtime or build time.
- A runtime schema library (Zod etc.). **Do not add a dependency** — hand-write the validator.

## Coder Guardrails

- **`docs/fund-data-2026-08-07.md` § `FINAL — all six, primary source, 2026-08-07` is the only
  authoritative data in this repo. Every table above that heading in that file is superseded history —
  do not read a figure from it, do not carry one forward, do not "reconcile" the two.** All six FINAL
  rows are primary-source (issuer page, HTTP 200). If a number in this spec disagrees with the FINAL
  section, stop and raise a blocker; do not pick one.
- **Nothing is invented.** If a figure is not in the FINAL section it is `null` — never `0`, never a
  value from `data/dividend_portfolio.json` or `etfs.json` (Constitution §3, §8). You have no web
  access.
- **TDD is mandatory.** One failing test per AC before any implementation. Never edit an expected
  value to match your code — raise a blocker instead.
- Touch only: create `data/funds.json`, `lib/funds.ts`, `lib/__tests__/funds.test.ts`; delete
  `data/dividend_portfolio.json`. Nothing else. `data/etfs.json` and `app/etf-comparison/page.tsx`
  are off limits, which is what keeps `pnpm build` passing.
- **`null` is a first-class value, not a hole.** Type it `number | null` (never `undefined`, never
  widened to `number`). Do not use `?? 0`, `|| 0`, `Number(x)` on a possibly-empty value, a default
  parameter, or a non-null assertion anywhere on these fields. Every read path either handles `null`
  or goes through `requirePriceGrowth`.
- **Fail loudly, never default** (Constitution §1, invariant 14). Every validation path throws with a
  message naming the ticker and the field. No silent row-skipping.
- `sharePriceGrowth` is derived in exactly one place, inside `parseFunds`, with a `why` comment citing
  Constitution §6 / invariant 5 and the FINAL section for the arithmetic.
- Add `why` comments in `lib/funds.ts` recording: (a) figures are primary-source as of 2026-08-07 via
  the FINAL section, with per-row `asOf` and `source`; (b) VYMI's yield and FDVV's 10-year return are
  `null` because the issuer does not publish them, not because they are zero, and FDVV becomes
  eligible around 2026-09; (c) `dividendGrowth` is `null` on all six — no issuer publishes a
  multi-year per-share CAGR, and a 1-year figure as a long-run assumption is banned by §6;
  (d) `data/etfs.json` is frozen legacy pending the next slice; (e) invariant 7 — these NAV returns
  are already net of the expense ratio, so a projection must not charge `expenseRatio` on top of
  `sharePriceGrowth`. Comments explain *why*, not *what* (Constitution §9).
- Decimals 0–1 everywhere, same as `lib/nzTax.ts`. **No percent conversion in `lib/funds.ts`** — that
  belongs in the display layer, later.
- Pure module: no React/Next, no I/O beyond the static JSON import, no `Date.now()`, no module-level
  mutable state, no network.
- TypeScript strict. **No `any`**, no non-null assertions, no unchecked cast of the imported JSON —
  take it as `unknown` and validate it. `pnpm lint` zero warnings before close.
