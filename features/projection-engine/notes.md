## What was built

`lib/projection.ts` — a pure per-year DRIP projection loop (`project`, `projectFund`,
`ProjectionInputError`) plus `lib/__tests__/projection.test.ts` with 19 hand-computed Vitest
fixtures, one per Acceptance Criterion in `features/projection-engine/spec.md`.

- `project(input: ProjectionInput): ProjectionResult` runs `input.termYears` years (year 0 is a
  pre-growth opening snapshot with every flow 0), applying the exact year sequence from the spec:
  price growth once per year, per-event contribution timing, per-share dividend growth, US WHT →
  DRIP, fee drag by share reduction, then `computeAnnualTax` for the year's settlement (only
  `nzTaxPayableNzd` leaves the portfolio — never `totalTaxNzd`, which would double-charge the
  already-withheld US tax).
- `projectFund(fund, rest)` calls `requirePriceGrowth(fund)` (from `lib/funds.ts`) and forwards to
  `project` — throws `MissingAssumptionError` on a null `sharePriceGrowth` (VYMI, FDVV), never a
  substituted 0.
- All tax logic goes through `computeAnnualTax` (`lib/nzTax.ts`) — no rate, threshold, or
  lower-of-FDR/CV logic is re-derived in this file. All price growth comes from
  `requirePriceGrowth`/`sharePriceGrowth` — never re-derived from `totalReturnAnnualised` /
  `dividendYield` directly.
- `compoundingPeriodsPerYear` is validated (positive integer) but does not re-enter the growth
  formula — the spec's pseudocode applies annual growth exactly once per year
  (`closingPrice = openingPrice × (1 + sharePriceGrowth)`), which is why AC2 holds trivially and
  by construction: compounding frequency cannot become a phantom growth lever if it is never used
  as one.
- Input validation (`ProjectionInputError`) covers every `ProjectionInput` field except
  `wrapper`/`marginalRate`/`pir`/`fifThresholdNzd` — those are deliberately left to
  `computeAnnualTax`'s own validation so its `TaxInputError` propagates unwrapped (AC18), per
  Constitution §2 (one engine per concern) and the guardrail against duplicating tax validation
  here.

No arithmetic disagreed with the spec's hand-computed fixtures — every one of the 19 expected
values (including the full-precision AC16 golden run to 6 decimal places) was independently
re-derived by hand before writing the test, and matched exactly. **No blocker to raise.**

### Design decisions made where the spec was silent (not tested by any AC, so flagging explicitly)

- `ProjectionRow.closingShares` is the **post-tax** final share count for the year (i.e.
  `closingValueAfterTaxNzd = closingShares × closingSharePriceNzd`), consistent with it becoming
  next year's `openingShares`. The spec's row field list has one `closingShares` field (no
  separate pre/post-tax variant), and this reading is the only one under which the year-to-year
  state threading is internally consistent.
- The spec's per-year pseudocode computes `purchasesNzd` and feeds it to `computeAnnualTax`, but
  `purchasesNzd` is not itself a listed row field. It is recoverable from existing fields as
  `contributionsInvestedNzd + dividendsReinvestedNzd`, or equivalently as the year's
  `costBasisNzd` delta (since `costBasis += purchases` precedes the tax call) — the tests use the
  `costBasisNzd` delta for AC11/AC13 since that is what's actually threaded through to
  `foreignCostNzd` in the following year, giving the most direct proof the DRIP was included.
- Summary `totalFeesNzd` sums only the row-level `totalFeesNzd` (expense ratio + platform fee —
  the recurring share-count drag). Brokerage and FX spread are contribution-time costs already
  visible as the gap between `contributionsGrossNzd` and `contributionsInvestedNzd`; folding them
  into the same summary total would double-report money that's already excluded from
  `contributionsInvestedNzd`. No AC pins a specific summary `totalFeesNzd` number, so this is a
  documented choice, not an inferred one.
- Summary `totalTaxNzd` sums the row-level `totalTaxNzd` (`nzTaxPayableNzd + usWithholdingNzd`)
  across years — the total tax burden the investor bore (NZ liability plus US WHT), matching the
  row field's own definition. AC16's fixture has zero WHT so it can't distinguish this from
  summing `nzTaxPayableNzd` alone; this is the more defensible reading given the row field's name.

## How to verify

```
pnpm test    # 56 passed (3 files) — nzTax.test.ts, funds.test.ts, projection.test.ts unaffected
pnpm lint    # No ESLint warnings or errors
pnpm build   # Compiled successfully, all routes prerendered
```

All three ran clean — see `## TDD` below for the actual output.

## TDD

### RED

Per the guardrail (previous slice's RED was an import-level failure hiding every AC behind one
failure mode — rejected), the process here was: commit a `lib/projection.ts` **stub** that
compiles, validates nothing, and returns a structurally valid but numerically wrong
`ProjectionResult` (a single all-zero row plus an all-zero summary) — never throws
`"not implemented"`. Then write all 19 AC tests against that stub and run the suite once, so every
AC's *specific* assertion mismatch is visible on its own, not masked by a thrown error.

18 of 19 tests failed with a genuine per-assertion mismatch (wrong value, wrong array length, or
"expected to throw but didn't"). Representative excerpts:

```
AC1 — N years compounds N times, not N+1
AssertionError: expected 1 to be 4 // Object.is equality
  at result.rows.length toBe(4)          (stub returns a 1-row array, not 4)

AC4 — contribution timing is applied per event, not credited at year start
TypeError: Cannot read properties of undefined (reading 'closingShares')
  at end.rows[1].closingShares            (stub has no rows[1] at all)

AC7 — a net-of-fees return is not charged the expense ratio again
AssertionError: expected undefined to be an instance of ProjectionInputError
  (stub never validates growthBasis/expenseRatioAnnual, so it doesn't throw)

AC10 — contributions are not returns
AssertionError: expected +0 to be close to 12000, received difference is 12000, but expected 5e-7
  at result.finalValueNzd toBeCloseTo(12_000, 6)   (stub's summary is all zero)

AC17 — a missing assumption fails loudly, never substitutes 0
AssertionError: expected function to throw an error, but it didn't
  at projectFund(getFund("VYMI"), rest)   (stub doesn't call requirePriceGrowth)

AC18 — invalid input throws, nothing is coerced to 0
AssertionError: expected function to throw an error, but it didn't
  at project(makeInput({ initialShares: -1 }))   (stub has no validateInput at all)
```

Full 18-failure transcript (`pnpm test -- lib/__tests__/projection.test.ts` against the stub) is
reproducible from git history of `lib/projection.ts` before the implementation commit; all 18
failures were genuine `expect(...)` mismatches or thrown `TypeError`s from missing row data — zero
import/type errors.

**AC19 is the one exception, flagged honestly rather than hidden**: its assertion is
`Number.isFinite(field)` on every numeric field of every row/summary. The stub's all-zero result
satisfies that trivially (`0` is finite), so AC19 could not be observed RED against this
particular stub — there was nothing wrong for it to catch. This is inherent to what AC19 checks
(an absence of NaN/Infinity), not a gap in the stub design: a stub deliberately seeded with NaN
just to make this one test fail would be testing the test, not the implementation. AC19 passed
individually once the real implementation existed alongside the other 18, and continues to pass
across every fixture and the degenerate cases (`termYears 1`, `initialShares 0`,
`contributionPerEventNzd 0`, `g 0`, `d0 0`) in `## GREEN` below.

### GREEN

```
$ npx vitest run lib/__tests__/projection.test.ts --reporter=verbose

 ✓ lib/__tests__/projection.test.ts > project > AC1 — N years compounds N times, not N+1 2ms
 ✓ lib/__tests__/projection.test.ts > project > AC2 — period rates are geometric, so compounding frequency is not a growth lever 2ms
 ✓ lib/__tests__/projection.test.ts > project > AC3 — deposit cadence never changes the growth model 1ms
 ✓ lib/__tests__/projection.test.ts > project > AC4 — contribution timing is applied per event, not credited at year start 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC5 — projectFund uses funds.ts-derived price-only growth, never total return 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC6 — dividend grows per share, not as a yield 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC7 — a net-of-fees return is not charged the expense ratio again 1ms
 ✓ lib/__tests__/projection.test.ts > project > AC8 — fee drag compounds through the share count 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC9 — brokerage and FX spread are charged on every contribution 1ms
 ✓ lib/__tests__/projection.test.ts > project > AC10 — contributions are not returns 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC11 — FIF taxes opening market value; DRIP is taxed in the year it arises 1ms
 ✓ lib/__tests__/projection.test.ts > project > AC12 — only nzTaxPayableNzd is settled from the portfolio, not totalTaxNzd 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC13 — a reinvested dividend counts as a purchase in the CV base 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC14 — the wrapper is passed through, never re-derived 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC15 — the de minimis crosses mid-projection and tests cost, not market value 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC16 — golden 2-year end-to-end 1ms
 ✓ lib/__tests__/projection.test.ts > project > AC17 — a missing assumption fails loudly, never substitutes 0 0ms
 ✓ lib/__tests__/projection.test.ts > project > AC18 — invalid input throws, nothing is coerced to 0 1ms
 ✓ lib/__tests__/projection.test.ts > project > AC19 — no NaN/Infinity escapes any row or the summary 4ms

 Test Files  1 passed (1)
      Tests  19 passed (19)

$ pnpm test
 Test Files  3 passed (3)
      Tests  56 passed (56)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
 ✓ Compiled successfully
 ✓ Generating static pages (7/7)
```
