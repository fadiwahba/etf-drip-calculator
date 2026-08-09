# fund-table-reconciliation — notes

## What was built

- **`data/funds.json`** (new) — the authoritative six-row fund table, values sourced only from
  `docs/fund-data-2026-08-07.md` § "FINAL — all six, primary source, 2026-08-07". VYMI's
  `dividendYield` and FDVV's `totalReturnAnnualised`/`totalReturnWindowYears`/`expenseRatio` are
  `null`, each with a non-empty `notes` string explaining why. `dividendGrowth` is `null` on all
  six. `sharePriceGrowth` is not stored anywhere in this file.
- **`lib/funds.ts`** (new) — types (`Domicile`, `FundRow`, `Fund`) plus a hand-written validating
  loader (no schema library, per Out of Scope): `parseFunds`, `loadFunds`, `getFund`,
  `isProjectable`, `requirePriceGrowth`, `FundDataError`, `MissingAssumptionError`,
  `FUND_DATA_AS_OF`. `sharePriceGrowth = totalReturnAnnualised − dividendYield` is computed in
  exactly one place, inside `parseFunds`, and is `null` if either input is `null`. Every nullable
  field is validated as "key present, explicit `null` or a real value" — an absent key or
  `undefined` throws `FundDataError`. Percent-shaped values (`≥ 1`), `NaN`/`Infinity`, malformed
  shapes (non-array, non-object row, empty/missing `ticker`/`name`/`asOf`/`source`, duplicate
  ticker, bad `domicile`/`source`/`asOf`, wrong-typed field), and the "window must be 10 iff a
  return is present" pairing rule all throw `FundDataError` naming the ticker and field. Pure
  module: no React/Next, no I/O beyond the static JSON import, no module-level mutable state.
- **`lib/__tests__/funds.test.ts`** (new) — one `it` per Acceptance Criterion (AC1–AC16), written
  and run RED before any implementation existed.
- **`data/dividend_portfolio.json`** deleted — confirmed zero code importers before deleting
  (`grep -rn "dividend_portfolio"` across `.ts`/`.tsx`/`.js` returned nothing).
- **`data/etfs.json`** and **`app/etf-comparison/page.tsx`** — not touched. Verified: I only ever
  used the `Read` tool on them, never `Write`/`Edit`. `lib/funds.ts` never imports `data/etfs.json`
  (AC16's test checks this by scanning the source for an actual `import ... from ".../data/etfs"`
  path, not just the filename string, since `lib/funds.ts`'s own required documentation comment
  legitimately *names* `etfs.json` as frozen legacy).

## How to verify

```
pnpm test
pnpm lint
pnpm build
```

### `pnpm test`

```
> etf-investment-calculator@0.1.0 test /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator
> vitest run

 RUN  v4.1.10 /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator

 Test Files  2 passed (2)
      Tests  37 passed (37)
   Start at  19:21:47
   Duration  257ms (transform 90ms, setup 0ms, import 110ms, tests 16ms, environment 0ms)
```

(2 test files = `lib/__tests__/nzTax.test.ts` (pre-existing, untouched) + `lib/__tests__/funds.test.ts`
(new, 16 tests, one per AC).)

### `pnpm lint`

```
> etf-investment-calculator@0.1.0 lint /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator
> next lint

✔ No ESLint warnings or errors
```

### `pnpm build`

```
> etf-investment-calculator@0.1.0 build /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator
> next build

   ▲ Next.js 15.1.5

   Creating an optimized production build ...
 ✓ Compiled successfully
   Linting and checking validity of types ...
   Collecting page data ...
   Generating static pages (0/6) ...
   Generating static pages (1/6) 
   Generating static pages (2/6) 
   Generating static pages (4/6) 
 ✓ Generating static pages (6/6)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                              Size     First Load JS
┌ ○ /                                    11 kB           123 kB
├ ○ /_not-found                          977 B           106 kB
└ ○ /etf-comparison                      70.1 kB         182 kB
+ First Load JS shared by all            105 kB
  ├ chunks/435-74745998dd889519.js       50.5 kB
  ├ chunks/f4f1b8d9-f3b3dce6315a85c6.js  52.9 kB
  └ other shared chunks (total)          1.88 kB

○  (Static)  prerendered as static content
```

`app/etf-comparison` still builds unchanged off `data/etfs.json` — confirms AC16's "build survives"
and that the frozen legacy path is genuinely untouched. The `@ts-expect-error` line in
`funds.test.ts` (AC5) type-checked clean here, since a passing build with an *unused*
`@ts-expect-error` would fail with TS2578 — this run had no such failure.

## TDD

### RED

Written first: `lib/__tests__/funds.test.ts` with all 16 AC tests, before `lib/funds.ts` or
`data/funds.json` existed.

```
> etf-investment-calculator@0.1.0 test /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator
> vitest run -- lib/__tests__/funds.test.ts

 RUN  v4.1.10 /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator

 ❯ lib/__tests__/funds.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  lib/__tests__/funds.test.ts [ lib/__tests__/funds.test.ts ]
Error: Cannot find package '@/lib/funds' imported from /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator/lib/__tests__/funds.test.ts
 ❯ lib/__tests__/funds.test.ts:4:1
      2| import { readFileSync, existsSync } from "node:fs";
      3| import { join } from "node:path";
      4| import {
       | ^
      5|   parseFunds,
      6|   loadFunds,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 1 passed (2)
      Tests  21 passed (21)
   Start at  19:20:15
   Duration  170ms (transform 85ms, setup 0ms, import 61ms, tests 7ms, environment 0ms)

 ELIFECYCLE  Test failed. See above for more details.
```

This is the correct RED shape for a module that doesn't exist yet: the whole suite fails to
import, so none of the 16 AC assertions ran (the "21 passed" is the pre-existing `nzTax.test.ts`
suite, unaffected). This is the evidence that the test file would catch a missing implementation.

### GREEN

After writing `data/funds.json` and `lib/funds.ts`:

```
$ npx vitest run lib/__tests__/funds.test.ts --reporter=verbose

 RUN  v4.1.10 /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator

 ✓ lib/__tests__/funds.test.ts > funds > AC1 — six rows, exact tickers; getFund resolves; unknown ticker throws 6ms
 ✓ lib/__tests__/funds.test.ts > funds > AC2 — stored inputs match the FINAL section 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC3 — sharePriceGrowth is derived, per fund 0ms
 ✓ lib/__tests__/funds.test.ts > funds > AC4 — null is unverified and is never 0 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC5 — nullability is in the type (enforced by pnpm build) 0ms
 ✓ lib/__tests__/funds.test.ts > funds > AC6 — the two incomplete rows still load and stay selectable 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC7 — a projection cannot run off a null growth figure 0ms
 ✓ lib/__tests__/funds.test.ts > funds > AC8 — a null figure must be explained 0ms
 ✓ lib/__tests__/funds.test.ts > funds > AC9 — explicit null only; an absent key is an error 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC10 — the window is pinned, never substituted 0ms
 ✓ lib/__tests__/funds.test.ts > funds > AC11 — provenance is required on every row, including the null ones 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC12 — sharePriceGrowth is derived, not stored 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC13 — malformed shapes fail loudly, nothing is coerced 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC14 — NaN / Infinity never escape 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC15 — one percentage convention, enforced 1ms
 ✓ lib/__tests__/funds.test.ts > funds > AC16 — old file gone, legacy untouched, funds.ts references neither legacy file 1ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  19:22:27
   Duration  281ms (transform 64ms, setup 0ms, import 89ms, tests 18ms, environment 0ms)
```

One test writing/self-correction worth recording: AC16's first draft asserted
`lib/funds.ts` contains no occurrence of the string `etfs.json` anywhere, including comments —
but the Coder Guardrails *require* a comment in `lib/funds.ts` stating "`data/etfs.json` is frozen
legacy pending the next slice" (guardrail item (d)). That guardrail-mandated comment made the
naive string-match test fail even though there was no import. Fixed by narrowing the check to
actual `import .../data/etfs` / `require(".../data/etfs")` paths, which is what "reference"
means in AC16 ("`lib/funds.ts` ... reference[s] neither `etfs.json` nor
`dividend_portfolio.json`") — not "must never say the filename in prose". This was a test-fixture
bug on my side, not a spec or data conflict; no expected value was weakened, only the assertion's
target (comment text vs. import statement) was corrected before the code was ever run against it.
