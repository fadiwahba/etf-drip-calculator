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

**Correction (Cycle 1, F4):** the sentence originally here claimed the full 18-failure transcript
was "reproducible from git history of `lib/projection.ts` before the implementation commit." That
is false — the stub was never committed; `git log --all -- lib/projection.ts` has exactly one
commit (`878c393`), the implementation itself, with no stash or other branch holding a stub. What
actually happened: the stub was written locally, all 19 AC tests were run against it in one
`pnpm test -- lib/__tests__/projection.test.ts` pass, the excerpts below were copied from that
run's output, and the stub was then overwritten by the real implementation without being
committed — so the transcript is excerpt-only and cannot be re-run from history. The excerpts
themselves are genuine per-assertion mismatches or thrown `TypeError`s from missing row data, not
import/type errors — that part of the claim stands.

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

## Cycle 1

Fix cycle for `review.md` verdict `NEEDS_FIXES`. Three blocking findings fixed (F1, F2, F3); one
correction made to this file's own claim (F4). Nothing in "Accepted as-is" was touched.

### F1 — AC13 was vacuous (fixed)

Added `purchasesNzd` to `ProjectionRow` (`lib/projection.ts`) — the amount fed to
`computeAnnualTax`'s `purchasesNzd` field — and populated it in `buildYearZeroRow` (`0`) and the
main loop (`purchases`). AC13 now asserts `row.purchasesNzd` directly instead of inferring it from
the `costBasisNzd` delta.

AC13's own fixture still can't discriminate "DRIP included" from "DRIP omitted" — FDR 5,000 is
lower than CV either way (15,500 with the DRIP, 20,175 without), so a direct assertion on the
*value* it takes doesn't by itself prove the DRIP was in the CV base that produced the *method*
choice. Per the reviewer's supplied fixture, added **AC13b**: same setup as AC11 but
`sharePriceGrowth: -0.01`. Closing price 9.90, DRIP 4,675 → +472.2222 shares, `closingValueNzd`
103,675, `costBasisNzd` 104,675. CV *with* the DRIP in the base = 103,675 + 5,500 − (100,000 +
4,675) = 4,500 < FDR 5,000 → `taxMethod "cv"`, `taxableIncomeNzd` 4,500, gross tax 1,485, WHT
credit 825 → `nzTaxPayableNzd` 660, `totalTaxNzd` 1,485. I re-derived these by hand before writing
the test; they match the code's output.

**RED, by applying the reviewer's exact mutation:** changed `purchasesNzd: purchases` to
`purchasesNzd: contributionsInvested` at the `computeAnnualTax` call (dropping the DRIP from the
CV base only, leaving `costBasis += purchases` untouched, exactly as the reviewer's mutation
describes). Result: **AC13b failed**, `taxMethod` came back `"fdr"` (CV rises to 9,175, above FDR
5,000) instead of `"cv"` — every other test, including AC13, still passed. This is the direct
demonstration that AC13b (not AC13) is what catches the defect the review flagged.

```
 × AC13b — omitting the DRIP from the CV base would flip FDR/CV here
   AssertionError: expected 'fdr' to be 'cv' // Object.is equality
   Expected: "cv"
   Received: "fdr"
    ❯ lib/__tests__/projection.test.ts:424:27
      422|     expect(row.purchasesNzd).toBeCloseTo(4_675, 6);
      423|     expect(row.costBasisNzd).toBeCloseTo(104_675, 6);
      424|     expect(row.taxMethod).toBe("cv");
 Tests  1 failed | 20 passed (21)
```

Reverted the mutation; `git diff lib/projection.ts` confirmed the file was back to only the
`purchasesNzd` field addition before re-running GREEN.

### F2 — the fee base was unpinned (fixed)

Added **AC8b**: `initialShares 1000` @ `10`, `sharePriceGrowth 0.1`, `termYears 1`,
`initialDividendPerShareNzd 0.5`, `growthBasis "gross-of-expense-ratio"`, `expenseRatioAnnual
0.01`, `platformFeeAnnualRate 0.002`. Non-zero growth *and* a dividend make the post-DRIP closing
value (11,500) diverge from the opening value (10,000), so the fee base is no longer ambiguous:
`expenseFeeNzd` 1% × 11,500 = 115, `platformFeeNzd` 0.2% × 11,500 = 23. Hand-derivation: closing
price 11, dividend 500, DRIP shares 500/11, `valueBeforeFees` = (1000 + 500/11) × 11 = 11,000 +
500 = 11,500 exactly.

**RED, by applying the reviewer's exact mutation:** changed `const valueBeforeFees = shares *
closingPrice;` to `const valueBeforeFees = openingValue;`. Result: **AC8b failed**
(`expenseFeeNzd` 100 vs expected 115), every other test including AC8 (whose g=0/no-dividend
fixture makes the two bases coincide) still passed.

```
 × AC8b — fee base is the post-DRIP closing value, not opening value
   AssertionError: expected 100 to be close to 115, received difference is 15, but expected 5e-7
    ❯ lib/__tests__/projection.test.ts:280:31
      280|     expect(row.expenseFeeNzd).toBeCloseTo(115, 6);
 Tests  1 failed | 20 passed (21)
```

Reverted the mutation; `git diff lib/projection.ts` again showed only the `purchasesNzd` addition
before re-running GREEN. No comment or logic change was made at line 260 (`valueBeforeFees = shares
* closingPrice`) — the existing "Fee drag reduces the share count… what makes the drag compound"
comment already states the chosen base; only the test coverage was missing.

### F3 — AC19 covered 3 of 16 fixtures (fixed)

Two changes to `lib/__tests__/projection.test.ts`:

1. `assertAllFinite` no longer walks a hardcoded `NUMERIC_ROW_FIELDS`/`NUMERIC_SUMMARY_FIELDS`
   list (removed both consts). It now derives the numeric fields at runtime via
   `Object.entries(...).filter(([, v]) => typeof v === "number")`, so a field added to
   `ProjectionRow`/`ProjectionResult` later (like `purchasesNzd` just was) is covered
   automatically instead of silently falling out of the check.
2. AC19 now runs `assertAllFinite` over the exact fixture from every AC that produces a
   `ProjectionResult` — AC1/2, AC3, AC4, AC6, AC7, AC8, AC8b, AC9, AC10, AC11/12/13, AC13b, AC14,
   AC15, AC16, the degenerate case, and AC5's `projectFund` path — instead of 3. This is every
   fixture in the spec's Acceptance Criteria section except AC17/AC18, which are error-path tests
   (`project`/`projectFund` throwing) with no `ProjectionResult` to check.

Did not re-verify RED for F3 by mutation — it is new coverage of an existing, already-passing
invariant (finiteness), not a fix to a specific wrong line, so there is no single mutation the
dispatch asked to reproduce. The field-list-derivation change was checked by re-running the full
suite after making it (below) — no regression.

### F4 — corrected the false reproducibility claim (fixed)

`notes.md`'s `## TDD` → `### RED` section previously claimed the 18-failure transcript was
"reproducible from git history of `lib/projection.ts` before the implementation commit." That
commit does not exist (`git log --all -- lib/projection.ts` returns exactly one commit, the
implementation itself). Replaced the sentence with what actually happened — the stub was written
locally, run once, its output excerpted into this file, then overwritten by the real
implementation without being committed — rather than restating or deleting the original claim. The
failure excerpts themselves are left untouched; they are genuine and not in question.

### Verify (all four gates, real output)

```
$ npx vitest run lib/__tests__/projection.test.ts --reporter=verbose
 ✓ AC1 — N years compounds N times, not N+1
 ✓ AC2 — period rates are geometric, so compounding frequency is not a growth lever
 ✓ AC3 — deposit cadence never changes the growth model
 ✓ AC4 — contribution timing is applied per event, not credited at year start
 ✓ AC5 — projectFund uses funds.ts-derived price-only growth, never total return
 ✓ AC6 — dividend grows per share, not as a yield
 ✓ AC7 — a net-of-fees return is not charged the expense ratio again
 ✓ AC8 — fee drag compounds through the share count
 ✓ AC8b — fee base is the post-DRIP closing value, not opening value
 ✓ AC9 — brokerage and FX spread are charged on every contribution
 ✓ AC10 — contributions are not returns
 ✓ AC11 — FIF taxes opening market value; DRIP is taxed in the year it arises
 ✓ AC12 — only nzTaxPayableNzd is settled from the portfolio, not totalTaxNzd
 ✓ AC13 — a reinvested dividend counts as a purchase in the CV base
 ✓ AC13b — omitting the DRIP from the CV base would flip FDR/CV here
 ✓ AC14 — the wrapper is passed through, never re-derived
 ✓ AC15 — the de minimis crosses mid-projection and tests cost, not market value
 ✓ AC16 — golden 2-year end-to-end
 ✓ AC17 — a missing assumption fails loudly, never substitutes 0
 ✓ AC18 — invalid input throws, nothing is coerced to 0
 ✓ AC19 — no NaN/Infinity escapes any row or the summary

 Test Files  1 passed (1)
      Tests  21 passed (21)

$ pnpm test
 Test Files  3 passed (3)
      Tests  58 passed (58)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
 ✓ Compiled successfully
 ✓ Generating static pages (7/7)
Route (app): / 4.01 kB · /etf-comparison 68.6 kB · /retirement 11 kB

$ pnpm exec tsc --noEmit
(no output, exit 0)
```

### `lib/projection.ts` diff — only the F1-required source change

```
$ git diff lib/projection.ts
```

Three hunks, all adding the `purchasesNzd: number` field to `ProjectionRow`, its `0` value in
`buildYearZeroRow`, and its `purchases` value in the main loop's row push. No other line in
`lib/projection.ts` changed. This is the one source change F1 requires — exposing the value
already computed as `purchases` so a test can pin it directly instead of proxying through
`costBasisNzd`. F2 and F3 needed no source change; both were fixed entirely in the test file.
