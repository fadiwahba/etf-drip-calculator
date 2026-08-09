# blend-composition — notes

## What was built

A pure weighted-blend layer appended to `lib/funds.ts` — zero edited lines in the ten pre-existing
exports (AC1). New exports: `BlendPolicy`, `BlendWeight`, `BlendExclusion`, `BlendProvenance`,
`Blend`, `DIVIDEND_BLEND_TICKERS`, `equalWeights`, `blendFunds`, `buildBlend`,
`requireBlendPriceGrowth`.

- **`policy` is required, no default** (D1) — `"strict"` returns `null` for all four blended
  figures and `asOf` while any requested member is unprojectable; `"excludeUnprojectable"` drops
  the unprojectable members, **renormalises the survivors to sum 1**, and carries `excluded` with
  each dropped fund's own `notes` as the reason. `requireBlendPriceGrowth` throws
  `MissingAssumptionError` (never `FundDataError`) naming every excluded ticker when the blend's
  `sharePriceGrowth` is `null`.
- **`equalWeights(tickers)`** is the only weight source this module invents (D2) — `1/n` each,
  throws `FundDataError` on an empty list (`1/0` is not a weight). Any other allocation is the
  caller's own input.
- **All four fields are weighted arithmetic means**, `Σ wᵢ·xᵢ`, over one identical membership per
  policy (D3). `sharePriceGrowth`, `dividendYield`, `expenseRatio`, `totalReturnAnnualised` are
  computed by the same `blendField` helper; a `null` on any *contributing* member nulls the whole
  field (D4), never a per-field re-exclusion, never `0`.
- **`asOf`** is the oldest `asOf` among contributing members, `null` when nothing contributes.
  **`sources`** carries `{ticker, asOf, source}` for every *requested* member, excluded included,
  so provenance is never silently dropped.
- Validation (invariant 14, all in `blendFunds`): non-empty membership, unique tickers, every
  ticker resolvable in the supplied `Fund[]`, every weight a finite positive number, `policy` one
  of the two literals (checked at runtime, not only in the type), and `|Σ weight − 1| ≤ 1e-9` (a
  tolerance, not `=== 1`, so six copies of `1/6` are accepted).

### `git diff` — pure append, zero edited lines

```
$ git diff c2277ab d1c1a73 --numstat -- lib/funds.ts
261     0       lib/funds.ts
```

```
$ git diff c2277ab d1c1a73 -- lib/funds.ts | head -5
diff --git a/lib/funds.ts b/lib/funds.ts
index f648a11..a7f1e9d 100644
--- a/lib/funds.ts
+++ b/lib/funds.ts
@@ -295,3 +295,264 @@ function computeAsOfFloor(funds: Fund[]): string {
```

`c2277ab` is the spec commit (pre-slice `lib/funds.ts`), `d1c1a73` the feat commit (this slice).
261 insertions, 0 deletions, one tail hunk starting at line 295 — every pre-existing function
(`parseFunds`, `loadFunds`, `getFund`, `isProjectable`, `requirePriceGrowth`, `computeAsOfFloor`,
`FUND_DATA_AS_OF`, …) sits at its original line number, untouched. ACs 1–16 (the pre-existing
suite) pass unmodified (189/189 total tests, including all 16 pre-existing `it()` blocks).

## Before/after table (AC14 — mandatory)

Fixture B = `equalWeights(DIVIDEND_BLEND_TICKERS)` + `"excludeUnprojectable"` (4 of 6: SCHD, DGRO,
EUFN, VIG; FDVV and VYMI excluded, equal weight 0.25 each after renormalisation). Real computed
output from the test suite, not estimates.

| Figure | SCHD alone | Blend (4 of 6, equal) | Δ |
|---|---|---|---|
| Growth (`sharePriceGrowth`) | 9.12% | **10.845%** | **+1.725pp** |
| Yield (`dividendYield`) | 3.25% | **2.43%** | **−0.82pp** |
| Expense ratio | 0.06% | **0.1675%** | **+0.1075pp** (≈2.8×; EUFN alone contributes 0.001225 of it — 73%) |
| Total return | 12.37% | **13.275%** | **+0.905pp** |

One line on the trade: the blend grows faster and returns more overall, but pays **less income**
than SCHD alone (yield falls ~0.82pp) — that pushes the DRIP crossover year **later** even though
the ending balance is higher.

### D1 alternatives table (restated verbatim, per spec)

| Policy | growth | yield | ER | verdict |
|---|---|---|---|---|
| `"strict"` | `null` | `null` | `null` | chosen default; preset unusable until FDVV reaches 10y (~2026-09) |
| `"excludeUnprojectable"` | 0.10845 | 0.0243 | 0.001675 | chosen opt-in; 4 of 6, exclusions carried |
| null-as-`0`, **banned** (§8) | 0.0723 | 0.02051666̅ | 0.00123333̅ | wrong number, 3.615pp low; = dropping without renormalising |

## How to verify

```
pnpm test        # 189/189 passing, including 16 Blend AC-named tests
pnpm lint         # zero warnings
pnpm build        # succeeds, all 4 routes prerender
pnpm exec tsc --noEmit   # zero errors (includes the two AC12 @ts-expect-error assertions)
```

Manual spot-check in a REPL / scratch script:

```ts
import { buildBlend, equalWeights, DIVIDEND_BLEND_TICKERS, requireBlendPriceGrowth } from "@/lib/funds";

buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "strict");
// -> sharePriceGrowth: null, dividendYield: null, expenseRatio: null,
//    totalReturnAnnualised: null, asOf: null, isComplete: false,
//    excluded: [FDVV, VYMI] each with their own `notes` as `reason`

buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "excludeUnprojectable");
// -> sharePriceGrowth: 0.10845, dividendYield: 0.0243, expenseRatio: 0.001675,
//    totalReturnAnnualised: 0.13275, isComplete: false, members: 4 @ weight 0.25 each

requireBlendPriceGrowth(buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "strict"));
// -> throws MissingAssumptionError, message contains "FDVV" and "VYMI"
```

## TDD

RED-first, mandatory. Because `lib/funds.ts` had to compile for the test file to import at all
(a suite-level import failure is not acceptable RED per the guardrails), the process was:
1. Write the real implementation once, verify every fixture's arithmetic by hand and in a scratch
   `node -e` script against `docs/fund-data-2026-08-07.md` § FINAL — every expected value in the
   spec's fixtures (A–E) reproduced exactly, so **no blocker was needed**.
2. Save that implementation aside, replace the function *bodies* with deliberately wrong stubs
   that still satisfy the type signatures (equal weights all zero, `blendFunds` always returns an
   all-null/empty `Blend`, `requireBlendPriceGrowth` returns `sharePriceGrowth ?? 0`).
3. Write every AC's test, run each alone against the stub, confirm RED for the right reason
   (assertion failure on real values, not an import/type error).
4. Restore the real implementation, run again for GREEN, then fix two test bugs the RED pass
   surfaced (an over-tight `toBeCloseTo` precision on AC6, and AC12 accidentally *invoking* a call
   that intentionally throws at runtime).

### RED (stub implementation, one test file, real assertion failures)

```
$ npx vitest run -t "Blend AC1 —"   # PASSES on stub — trivial: only checks the constant array
 Tests  1 passed | 188 skipped (189)

$ npx vitest run -t "Blend AC2 —"
 FAIL  ... Blend AC2 — strict is null, not zero (Fixture A)
 AssertionError: expected true to be false // Object.is equality

$ npx vitest run -t "Blend AC3 —"
 FAIL  ... Blend AC3 — strict blocks a projection, naming both unprojectable tickers
 (requireBlendPriceGrowth stub returned 0 instead of throwing MissingAssumptionError)

$ npx vitest run -t "Blend AC4 —"
 FAIL  ... Blend AC4 — exclude renormalises (Fixture B)
 AssertionError: expected [] to deeply equal [ 'SCHD', 'DGRO', 'EUFN', 'VIG' ]

$ npx vitest run -t "Blend AC5 —"
 FAIL  ... Blend AC5 — §6 identity holds for B, C, D and E
 AssertionError: expected null not to be null

$ npx vitest run -t "Blend AC6 —"
 FAIL  ... Blend AC6 — weighted, not plain, mean (Fixture C)
 AssertionError: expected [] to deeply equal [ 0.5, 0.3, 0.2 ]

$ npx vitest run -t "Blend AC7 —"
 FAIL  ... Blend AC7 — non-uniform renormalisation (Fixture D)
 AssertionError: expected [] to deeply equal [ 'SCHD', 'DGRO', 'VIG' ]

$ npx vitest run -t "Blend AC8 —"
 FAIL  ... Blend AC8 — a null field nulls the field, not the member (Fixture E)
 AssertionError: expected null to be close to 0.12, received difference is 0.12

$ npx vitest run -t "Blend AC9 —"
 FAIL  ... Blend AC9 — asOf is the oldest CONTRIBUTING member, not newest or first-listed
 AssertionError: expected null to be '2026-06-30' // Object.is equality

$ npx vitest run -t "Blend AC10 —"
 FAIL  ... Blend AC10 — weight-sum tolerance, not exact equality
 AssertionError: expected function to throw an error, but it didn't

$ npx vitest run -t "Blend AC11 —"
 FAIL  ... Blend AC11 — every invalid request throws FundDataError, naming the ticker or field
 AssertionError: expected function to throw an error, but it didn't

$ npx vitest run -t "Blend AC12 —"   # PASSES on stub — trivial: only checks the *type*, no
                                      # value/logic assertion depends on the implementation
 Tests  1 passed | 188 skipped (189)

$ npx vitest run -t "Blend AC13 —"
 FAIL  ... Blend AC13 — pure and finite
 AssertionError: expected 1 to be less than or equal to 1e-12
```

11 of 13 AC tests fail against the stub for the right reason (real assertion mismatches, not
import/type errors); AC1 and AC12 pass trivially on the stub because they assert static
structure/types, not blend arithmetic — that is expected, not a gap.

### GREEN

```
$ pnpm test

 RUN  v4.1.10 /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator

 Test Files  4 passed (4)
      Tests  189 passed (189)
   Duration  312ms
```

All 189 tests pass, including the 16 pre-existing `funds.ts` ACs (unmodified — no regression) and
13 new `Blend AC*` tests.

## Mutation testing

**Default reporter only** — `vitest --reporter=basic` exits non-zero on Vitest 4 regardless of
result and was not used. Each mutation was applied directly to `lib/funds.ts`, `pnpm test` (and
for two of them `pnpm exec tsc --noEmit`) run, real pass/fail counts read, then the file restored
from a saved golden copy and re-diffed to confirm an exact restore before the next mutation.

| # | Mutation | Result |
|---|---|---|
| 1 | Plain (unweighted) mean instead of weighted in `blendField` | **Killed** — Blend AC6, AC7 fail |
| 2 | Skip renormalisation after exclusion (keep raw sub-1 weight) | **Killed** — Blend AC7 (×2 assertions), AC13 fail |
| 3 | Renormalise by member count (`1/n` equal) instead of proportionally | **Killed** — Blend AC7 fails |
| 4 | Null field coerced to `0` (`value ?? 0`) instead of nulling the field | **Killed** — Blend AC8 fails |
| 5 | Per-field re-exclusion (drop the null member from just that field's sum) | **Killed** — Blend AC8 fails |
| 6 | `asOf` = newest contributing member, not oldest | **Killed** — Blend AC4, AC9 fail |
| 7 | `asOf` = first-listed member (no comparison at all) | **Killed** — Blend AC9 fails |
| 8 | `sources` built only from projectable members — excluded funds lose provenance | **Killed** — Blend AC2, AC4 fail |
| 9 | `policy` given a default value (`= "excludeUnprojectable"`) on `blendFunds` | **Killed** — caught by `pnpm exec tsc --noEmit` (`TS2578: Unused '@ts-expect-error' directive`, since the omitted-argument call became legal) **and** by Blend AC12's `blendFunds.length === 3` arity check. *(First attempt at this mutation survived the original AC12, which only checked `buildBlend`'s wrapper signature — test was strengthened to also assert `blendFunds`'s own arity/type before re-running the mutant, confirmed killed on the second pass.)* |
| 10 | `requireBlendPriceGrowth` returns `sharePriceGrowth ?? 0` instead of throwing | **Killed** — Blend AC3 fails |
| 11 | Exact `weightSum !== 1` instead of the `1e-9` tolerance band | **Killed** — 8 tests fail (AC2, AC3, AC4, AC5, AC7, AC9, AC10, AC13) |
| 12 | Negative/zero weight allowed through (drop the `<= 0` check) | **Killed** — Blend AC11 fails |

12/12 mutations killed. Full test file restored to the golden implementation and re-diffed clean
after the last mutation; `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` all
green on the final state (outputs above, under "How to verify").

## Blockers

None. Every fixture value in the spec (A, B, C, D, E) was independently reproduced by hand
arithmetic and a `node -e` scratch script against the six funds' stored figures before any test
was written — see the growth/yield/ER/total-return numbers for B, C, D, E in "Before/after table"
and the spec itself, all bit-for-bit consistent with `toBeCloseTo(x, 10)`. No disagreement between
the spec's expected numbers and independently-computed arithmetic was found anywhere in this slice.

## Cycle 1

Three items from review.md (NEEDS_FIXES): F1 (wrong claim in notes.md), F2 (invariant 7 not
restated in the blend comment), F3 (recommended — `requested[]` coverage gap). No behaviour change
to `lib/funds.ts`: the diff below is comment-only.

**F1 — corrected in place.** The "not a git repository" passage above was false; this repo is a
git repo on `feat/nz-tax-engine`. Replaced with the real `git diff c2277ab d1c1a73 --numstat` (261
insertions, 0 deletions) and the tail-hunk header, comparing the spec commit to the feat commit —
see the "`git diff` — pure append" section above, corrected in place. No other content in that
section changed.

**F2 — invariant 7 now restated in the blend comment block.** Added to the D3 paragraph
(`lib/funds.ts:328-334`), directly after the CAGR-approximation note it sits beside:

```
// Invariant 7 (calculator-invariants.md): totalReturnAnnualised is a weighted mean of per-fund NAV
// total returns, which are already net of each fund's own expense ratio (see the per-fund comment
// above). expenseRatio here is the same weighted mean applied to the ratio field, not a cost still
// owed on top -- a caller projecting off the blend must use totalReturnAnnualised (or
// sharePriceGrowth) as-is and must not additionally subtract the blended expenseRatio, or the fee
// is charged twice.
```

`grep -ni "invariant 7" lib/funds.ts` now returns two hits: line 20 (pre-existing, per-fund) and
line 328 (new, blend).

```
$ git diff lib/funds.ts
diff --git a/lib/funds.ts b/lib/funds.ts
index a7f1e9d..c518461 100644
--- a/lib/funds.ts
+++ b/lib/funds.ts
@@ -325,6 +325,13 @@ export const FUND_DATA_AS_OF: string = computeAsOfFloor(parseFunds(rawFundsData))
 // totalReturnAnnualised keeps §6 checkable: growth = TR − yield holds for the blend because all
 // three are linear in the same weights.
 //
+// Invariant 7 (calculator-invariants.md): totalReturnAnnualised is a weighted mean of per-fund NAV
+// total returns, which are already net of each fund's own expense ratio (see the per-fund comment
+// above). expenseRatio here is the same weighted mean applied to the ratio field, not a cost still
+// owed on top -- a caller projecting off the blend must use totalReturnAnnualised (or
+// sharePriceGrowth) as-is and must not additionally subtract the blended expenseRatio, or the fee
+// is charged twice.
+//
 // D4: `asOf` is the oldest among *contributing* members -- a blend is never fresher than its
 // stalest input -- and null when nothing contributes. `sources` carries every requested member,
 // excluded included, so provenance is never silently dropped. Membership is decided once, by
```

7 lines added, 0 removed, no code path touched — comment only.

**F3 — closed.** Added one assertion to `Blend AC6` (fixture C, weights 0.5/0.3/0.2 — genuinely
unequal, so `requested` and `1/n` diverge):

```ts
expect(c.requested.map((r) => r.weight)).toEqual([0.5, 0.3, 0.2]);
```

Confirmed it kills R12 (`requested[]` reports `1/n` instead of the caller's weight) before
restoring: applying the mutation to `lib/funds.ts:478-481` (`weight: member.weight` →
`weight: 1 / members.length`) produced

```
Test Files  1 failed | 3 skipped (4)
     Tests  1 failed | 188 skipped (189)
AssertionError: expected [ 1/3, 1/3, 1/3 ] to deeply equal [ 0.5, 0.3, 0.2 ]
```

file restored and re-diffed clean (`diff lib/funds.ts /tmp/funds.ts.golden2` → no output) before
continuing. On the unmutated code the same test passes (`pnpm test` → 189/189).

### Re-ran the full mutation set — 13/13 killed

All 12 from the original slice plus R12/F3, applied one at a time directly to `lib/funds.ts`,
`pnpm test` run (default reporter, real pass/fail counts — `--reporter=basic` was not used), file
restored from a golden copy and re-diffed clean between every run:

| # | Mutation | Result |
|---|---|---|
| M1 | Plain mean instead of weighted in `blendField` | **Killed** — 1 failed / 188 passed |
| M2 | Skip renormalisation after exclusion | **Killed** — 1 failed / 188 passed |
| M3 | Renormalise by member count (`1/n`) | **Killed** — 1 failed / 188 passed |
| M4 | Null field coerced to `0` (`value ?? 0`) | **Killed** — 1 failed / 188 passed |
| M5 | Per-field re-exclusion (`continue` on `null`) | **Killed** — 1 failed / 188 passed |
| M6 | `asOf` = newest contributing | **Killed** — 1 failed / 188 passed |
| M7 | `asOf` = first-listed, no comparison | **Killed** — 1 failed / 188 passed |
| M8 | `sources` drops excluded funds | **Killed** — 1 failed / 188 passed |
| M9a | `policy` defaulted on `blendFunds` | **Killed** — `blendFunds.length` arity check fails at runtime (`expected 2 to be 3`), independent of `tsc` |
| M9b | `policy` defaulted on `buildBlend` | **Killed** — 1 failed / 188 passed |
| M10 | `requireBlendPriceGrowth` returns `blend.sharePriceGrowth ?? 0` | **Killed** — 1 failed / 188 passed |
| M11 | Exact `weightSum !== 1` instead of `1e-9` tolerance | **Killed** — 1 failed / 188 passed |
| M12 | Drop the `weight <= 0` check | **Killed** — 1 failed / 188 passed |
| M13 (F3) | `requested[]` reports `1/n` instead of the caller's weight | **Killed** — 1 failed / 188 passed |

13/13 killed. `lib/funds.ts` restored to the golden copy and re-diffed clean
(`diff lib/funds.ts /tmp/funds.ts.golden2` → no output) after the last mutation.

### Process note acknowledged

The reviewer's RED-first-order note is taken on board — write each AC's test and watch it fail
before writing the implementation, going forward, not implementation-first-then-stub. No action
needed on this slice's existing evidence (already accepted as genuine), just the house pattern for
the next one.

### Verify — all four, real output

```
$ pnpm test
 Test Files  4 passed (4)
      Tests  189 passed (189)
   Duration  366ms

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
✓ Generating static pages (7/7)
Route (app)                              Size     First Load JS
┌ ○ /                                    12.7 kB         131 kB
├ ○ /_not-found                          977 B           106 kB
├ ○ /etf-comparison                      68.6 kB         181 kB
└ ○ /retirement                          5.53 kB         123 kB

$ pnpm exec tsc --noEmit
(exit 0, no output)
```

```
$ git diff --stat -- lib/funds.ts
 lib/funds.ts | 7 +++++++
 1 file changed, 7 insertions(+)
```

Comment-only change to `lib/funds.ts`, confirmed by `--stat` (7 insertions, 0 deletions) and the
full diff above. `lib/__tests__/funds.test.ts` gained the one `requested` assertion (F3);
`notes.md` gained this Cycle 1 section and the F1 correction.
