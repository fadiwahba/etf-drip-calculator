# tax-mode-compare — notes

## What was built

- **`lib/projection.ts`** — pure append (105 insertions, 0 deletions; `git diff` confirmed no `-`
  lines besides the diff header). `WRAPPER_TIE_EPSILON_NZD`, `WrapperComparisonYear`,
  `WrapperComparison`, `compareWrappers(input)`. Calls `project()` exactly twice
  (`{ ...input, wrapper: "pie" }` / `"direct"` ) and does no tax/fee/growth arithmetic itself
  (Constitution §2). `cheaperWrapper` ranks `closingValueAfterTaxNzd` (D1), never `totalTaxNzd`.
  `firstDecisiveYear`/`flipYear` scan years `[1, N]` (year 0 excluded, always a tie); a tie is
  `Math.abs(differenceNzd) <= WRAPPER_TIE_EPSILON_NZD`, never coerced to a winner; only the
  *first* flip is reported. `project()`, `projectFund()`, `toRealTerms()`, `findIncomeCrossover()`
  and every pre-existing interface are byte-identical — confirmed by `git diff`.
- **`components/projectionInputs.ts`** — mechanical rename `ProjectionFormState.wrapper` →
  `taxMode: "pie" | "direct" | "compare"` (AC12), with `parsePir` and the built
  `ProjectionInput.wrapper` mapping updated (`"pie"` → `"pie"`; `"direct"`/`"compare"` → `"direct"`,
  the base run; `"compare"` still parses `pir` since `compareWrappers` reads it off the same input
  object for its own PIE leg). `RunProjectionResult` gained a `comparison: WrapperComparison |
  undefined` field, populated by a single `compareWrappers()` call in `"compare"` mode — `value` is
  then `comparison.direct` itself, never a second/third `project()` call (AC13). New export
  `formatTaxModeExplainer(form, run)` — one line naming the regime/method/threshold/rate for a
  single mode (D6), or both wrappers' rates + the lead/flip for compare mode (D6/AC15); a
  `run.ok === false` state names no rate at all.
- **`components/InvestmentProjectionCalculator.tsx`** — the wrapper `Select` replaced by a
  `Tabs`/`TabsList`/`TabsTrigger` segmented control (*NZ PIE* / *US ETFs (direct)* / *Compare
  both*, from the existing `components/ui/tabs.tsx`, no new dependency, no restyling); PIR shown
  for `pie`/`compare` only, marginal rate for `direct`/`compare` only; the explainer one line under
  the control; a "NZ PIE vs US ETFs (direct)" block (both final values, the difference, the flip
  year) shown only in `compare` mode. Everything else — the summary tiles, crossover card, table —
  is unchanged and continues to read `value`/`real` (which, in `compare` mode, is the `direct` leg).

## Blocker: AC8 deflator arithmetic (spec's literal year-3 real values disagree with the engine)

AC8 states Fixture P's year-3 real values (`toRealTerms(comparison.pie/direct, 0.03)`) are
`117,199.7222` (pie) / `115,428.0899` (direct). Running the actual, **unmodified**
`toRealTerms()` on Fixture P's own nominal year-3 figures (`128,082.4056` pie / `126,146.2410125`
direct — themselves pinned exactly by AC2, hand-verified against the spec's `V(t) = V(t−1) ×
(1.1 − 0.05r)` closed form and cross-checked in `node` before writing a single assertion) gives:

| | spec's AC8 value | `nominal / 1.03³` (`1.03³ = 1.092727` exactly) |
|---|---|---|
| pie | 117,199.7222 | **117,213.545195** |
| direct | 115,428.0899 | **115,441.680321** |

Both differ from the spec by ~$13.6–13.8, an order of magnitude past `toBeCloseTo(x, 3)`'s
tolerance (~$0.0005) — not float64 drift. `1.03³ = 1.092727` is exact (`103³ = 1,092,727`); dividing
Fixture P's own AC2-pinned nominal values by it in `node` gives the numbers in the right column,
confirmed independently by `128,082.4056 / 117,213.545195 = 1.092727` and the reverse division.
Per Coder Guardrails ("a number I cannot reproduce is a blocker, not a fix, even when I turn out to
be right" — the exact ruling from `crossover-target-income`'s AC4), **AC8's test in
`lib/__tests__/projection.test.ts` uses the engine-verified values, not the spec's array.** The
D5 *invariant itself* (winners/`flipYear` unchanged between `i = 0` and `i = 0.03`) is also
asserted generically and passes independent of which literal is correct. `toRealTerms()` was not
touched to produce this — it is the pre-existing, already-tested function; this is a Fixture-P
arithmetic disagreement, not an engine defect.

## How to verify

```bash
pnpm test         # 172 passed / 0 failed
pnpm lint         # zero warnings
pnpm exec tsc --noEmit   # exit 0
pnpm build        # succeeds
git diff lib/projection.ts | grep '^-'   # only the diff header, no deleted lines
```

Manual: `pnpm dev` → Portfolio Projection Calculator → the *Tax mode* control (NZ PIE / US ETFs
(direct) / Compare both) replaces the old Wrapper dropdown; switching to *Compare both* shows the
explainer line, both PIR and marginal-rate fields, and a new "NZ PIE vs US ETFs (direct)" block
with both final values, the difference and the flip year (or "Never").

## TDD

RED-first for `lib/` (ACs 1-11, `describe("tax-mode-compare")`) and the mapper (ACs 12-15,
`describe("tax-mode-compare mapper")`), each run alone via
`pnpm exec vitest run <file> -t "<name>"`, against a temporarily-reverted `lib/projection.ts`
(`git diff` patch stashed and reapplied afterwards — never a suite-level import failure; the other
pre-existing tests in the same run stayed green throughout, confirmed via the skip counts below).
AC16 (UI) is exempt per the dispatch.

**AC1 does not RED** (same disclosed pattern as `crossover-target-income`'s AC1/`inflation-real-terms`'s
AC1): it invokes no new code, only the pre-existing golden fixture — a regression pin, not a feature
test. The mechanical `wrapper` → `taxMode` rename (AC1's own clause, "no assertion changed") was
applied as one atomic, zero-behaviour-change step before AC12-15's RED, per the guardrail's
explicit allowance; every pre-existing test (147 lib + 55 mapper) stayed green across the rename.

### RED (lib/, ACs 2-11 — `compareWrappers is not a function` before implementation)

```
AC2  — TypeError: compareWrappers is not a function   (1 failed | 4 passed | 61 skipped)
AC3  — TypeError: compareWrappers is not a function   (1 failed | 4 passed | 61 skipped)
AC4  — TypeError: compareWrappers is not a function   (1 failed | 4 passed | 61 skipped)
AC5  — TypeError: compareWrappers is not a function   (1 failed | 4 passed | 61 skipped)
AC6  — TypeError: compareWrappers is not a function   (1 failed | 4 passed | 61 skipped)
AC7  — TypeError: compareWrappers is not a function   (1 failed | 4 passed | 61 skipped)
AC8  — TypeError: compareWrappers is not a function   (1 failed | 4 passed | 61 skipped)
AC9  — AssertionError: expected TypeError: … to be an instance of TaxInputError (1 failed | 3 passed)
AC10 — TypeError: compareWrappers is not a function   (1 failed | 2 passed | 63 skipped)
AC11 — TypeError: compareWrappers is not a function   (1 failed | 2 passed | 63 skipped)
```
Each ran alone (`Tests N failed | M passed | K skipped`) — a genuine assertion/TypeError from a
missing implementation, never a suite-level failure.

### RED (mapper, ACs 12-15 — after the mechanical rename, before the new logic)

```
AC12 "'compare' -> wrapper 'direct' with pir still parsed"
  AssertionError: expected undefined to be close to 0.28, received difference is NaN
  (parsePir treated "compare" like "direct" — a deliberate intermediate state, see "How this RED
  was staged" below)
AC13 "'compare' -> comparison defined ..."
  AssertionError: expected undefined to be defined
AC13 "'compare' with pirPercent '' -> ok:false carrying the unwrapped TaxInputError"
  AssertionError: expected true to be false
AC14 (all 5 cases) — TypeError: formatTaxModeExplainer is not a function
AC15 (both cases)  — TypeError: formatTaxModeExplainer is not a function
```
AC13's `"'pie'/'direct' -> comparison undefined"` passed vacuously before implementation (the
absent `comparison` field reads as `undefined`, exactly what that case asserts) — same
"reproduces old behaviour" exception as AC1/the prior slices, disclosed here.

**How this RED was staged:** AC12-15 are tightly coupled (13-15 all depend on 12's `taxMode`
existing), so the mechanical rename was done first as a genuinely no-op refactor (`parsePir`
initially kept its old "only `'pie'` parses" logic, just re-keyed to `taxMode`) — this reproduces
old behaviour for every pre-existing test (zero regressions) while leaving AC12's *new* "compare
still parses pir" requirement genuinely unmet, giving real RED evidence for it. `runProjection` and
`formatTaxModeExplainer` were not touched at all until their own RED was captured.

### GREEN

```
$ pnpm test
 Test Files  4 passed (4)
      Tests  172 passed (172)
```
(11 new lib tests + 14 new mapper tests, 147 + 55 pre-existing unchanged.)

### Before/after table (mandatory)

*Scenario · Marginal · PIR · PIE final · Direct final · Difference · Flip year* — all four rows
are real `compareWrappers()`/`runProjection()` output, not estimates.

| Scenario | Marginal | PIR | PIE final | Direct final | Difference | Flip year |
|---|---|---|---|---|---|---|
| P | 39% | 28% | 128,082.4056 | 126,146.2410125 | +1,936.1645875 | `null` |
| L | 17.5% | 28% (cap is a ceiling, not a discount) | 128,082.4056 | 129,948.9486328125 | −1,866.5430328125 | `null` |
| F (final, year 4) | 39% | 28% | 75,333.6928 | 74,634.8782 | +698.8146 | **2** (year 1: +44 pie; year 2: −414.3669 direct) |
| UI default (100k, 15y, SCHD seed 9.12%/3.25%, 33%, PIR 28%, WHT 15%, inflation 3%) | 33% | 28% | 396,056.917168 | 382,720.887339 | +13,336.029829 | `null` |

`null` is the usual and correct answer — P and the UI default never flip because PIE's PIR (28%)
stays below the direct marginal rate (39%/33%) in every regime; L never flips either, but the
*direction* reverses entirely (direct wins throughout) because the marginal rate (17.5%) is now
*below* the PIR cap — the cap is a ceiling on the PIE's rate, not a guaranteed discount. F is the
one scenario in this table that genuinely flips, at year 2, because its two legs' cost bases
straddle the FIF de minimis in different years (spec.md Fixture F, `lib/__tests__/projection.test.ts`
AC7 pins the exact per-year figures to 2dp+).

### Mutation testing

Default reporter throughout — **not** `--reporter=basic` (Vitest 4 exits non-zero regardless of
result with that flag, so a harness using it proves nothing). `lib/projection.ts` restored from a
saved copy (`cp` back) after every mutation; confirmed clean via `git diff lib/projection.ts` after
the whole run. `components/projectionInputs.ts` restored the same way.

| # | Mutation (`lib/projection.ts`) | Result |
|---|---|---|
| M1 | Swap the two runs (`pie`/`direct` labels swapped) | **Killed** — 8/172 failed |
| M2 | Zero `usWithholdingRate` on just the PIE leg | **Survived** first pass — every spec fixture (P/C/L/E/R/F) uses `usWithholdingRate: 0` per the "Fixtures" preamble, so none could catch it. **Fixed** by adding a nonzero-WHT case to AC10 (`makeFixtureF({ usWithholdingRate: 0.15 })`); re-run: **Killed** — 1/172 failed |
| M3 | Pass `marginalRate` to the PIE run (`pir: input.marginalRate`, dropping the cap) | **Killed** — 3/172 failed |
| M4 | `flipYear = firstDecisiveYear` (drop the "different winner" requirement) | **Killed** — 5/172 failed |
| M5 | Report the *last* flip (drop the `break`) | **Killed** — 1/172 failed |
| M6 | Shift the `firstDecisiveYear` scan to start at year 2 | **Killed** — 1/172 failed |
| M7 | Return `0` for `null` (`firstDecisiveYear`/`flipYear`) | **Killed** — 5/172 failed |
| M8 | Treat a tie as a flip (drop `winner !== null`) | **Killed** — 1/172 failed |
| M9 | Rank `cheaperWrapper` on `totalTaxNzd` instead of `closingValueAfterTaxNzd` (D1 violation) | **Killed** — 1/172 failed (AC7, the one fixture where value-ranking and tax-ranking genuinely diverge) |

| # | Mutation (`components/projectionInputs.ts`) | Result |
|---|---|---|
| N1 | `parsePir`: `"compare"` stops parsing `pir` (reverts to the intermediate rename state) | **Killed** — 4/172 failed |
| N2 | `formatCompareExplainer`: swap the flip-wrapper label (`"pie"` ↔ `"direct"`) | **Survived** first pass — the AC15 flip test checked `"US ETFs (direct)"` was present anywhere in the line, which is also true from the wrapper's own rate label earlier in the sentence. **Fixed** by pinning the exact substring `` `flips to US ETFs (direct) in year ${flipYear}` ``; re-run: **Killed** — 1/172 failed |
| N3 | `runProjection`: `value = comparison.pie` instead of `comparison.direct` in compare mode | **Killed** — 1/172 failed (AC13's `comparison.direct` `toEqual`s `value`) |

12/12 mutations killed (9 lib + 3 mapper, two only after strengthening the test that first let them
survive — both fixes are already reflected in the test files above, not a separate follow-up).

## Cycle 1

Refined spec.md added AC19 (D3 — US WHT applies to both legs, never zeroed on the PIE run) and AC20
(the two wrapper labels are pinned by number, not by name). Both pin behaviour the shipped code
already has (found by Cycle 0's mutation testing and used there to strengthen the M2/N2 test cases),
so per the dispatch they are **not** RED-first — their evidence is a mutation that dies against the
new assertion. `lib/projection.ts`, `components/projectionInputs.ts` and
`components/InvestmentProjectionCalculator.tsx` are untouched this cycle: `git diff` on all three is
empty (confirmed below), so nothing was reconciled to make the new tests pass — they simply pin
already-correct output.

### AC8 — the upheld blocker, unchanged

Per the refined spec, AC8's own arithmetic disagreement is confirmed real (`1.03³ = 1.092727`
exactly; the spec's `117,199.7222`/`115,428.0899` are low by `13.823`/`13.590` against the
engine-verified `117,213.545195`/`115,441.680321`). The Cycle 0 test already asserts the
engine-verified values (matching what the refined spec.md now carries), so **no change was made to
AC8's test or to `toRealTerms()`/`compareWrappers()`** this cycle. Noted per the dispatch's process
correction: had this been a fresh blocker, the correct move is to leave the test asserting the
spec's original (disagreeing) number and failing — not to write the engine's value into the test in
the same pass, which is what happened last cycle. There was no fresh blocker to raise here since
AC8's evidence and verdict both predate this cycle.

### Verified by hand before writing anything

Fixture W (AC19: Fixture P + `initialDividendPerShareNzd` 0.55, `usWithholdingRate` 0.15, `pir`
0.105, `termYears` 1): dividends `10,000 × 0.55 = 5,500`; WHT `5,500 × 0.15 = 825`; net `4,675`
reinvested at the grown price `10 × 1.1 = 11` buys `425` shares (`10,425` total) →
`closingValueNzd` **114,675** on both legs before NZ tax. FDR `5% × 100,000 = 5,000` (below CV
`15,500`). PIE: `5,000 × 0.105 = 525`; the `825` WHT credit caps at that `525` liability →
`nzTaxPayableNzd` **0**, `closingValueAfterTaxNzd` **114,675**, `pieTotalTaxNzd = 825 + 0 = 825`.
Direct: `5,000 × 0.39 = 1,950`; credit `825` → payable **1,125**, value **113,550**,
`directTotalTaxNzd = 825 + 1,125 = 1,950`. `differenceNzd = 114,675 − 113,550 = 1,125`. Matches
spec.md exactly — no blocker.

AC20 (lib half, Fixture L, `marginalRate` 0.175, `pir` stays the default 0.28): year-1 FDR base
`5,000`; PIE `5,000 × 0.28 = 1,400`; direct `5,000 × 0.175 = 875`. Matches spec exactly.

AC20 (explainer half): the two `makeForm` runs (`initialCapital "100000"`, `termYears "3"`,
`sharePriceGrowthPercent "10"`, `dividendYieldPercent "0"`, `usWithholdingPercent "0"`) reconstruct
Fixture P (`marginalRatePercent "39"`) and Fixture L (`"17.5"`) through the unit-share mapper
(`initialShares = initialCapitalNzd`, `initialSharePriceNzd = 1`) rather than lib's own
`initialShares 10,000` / `initialSharePriceNzd 10` — both give the same `100,000` opening value and
no dividends, so `finalDifferenceNzd` is identical to lib's Fixture P/L: `1,936.1645875` and
`−1,866.5430328125`. `formatNzd` rounds to whole dollars (`node`-verified:
`(1936.1645875).toLocaleString(...) === "1,936"`, `(1866.5430328125).toLocaleString(...) ===
"1,867"`), matching the implementation's own `leads by ${formatNzd(...)}` format string exactly.

### Tests added

- `lib/__tests__/projection.test.ts`: `AC19 — US withholding applies to both legs (Fixture W, pir
  0.105)`, `AC20 — wrapper labels pinned by their own rate, not swapped (Fixture L)`, both inside
  `describe("tax-mode-compare")`, appended after AC11 (last test before the closing `});`).
- `components/__tests__/projectionInputs.test.ts`: `describe("AC20 — explainer labels pinned by
  number, not swapped (compare mode)")` with two mirrored cases (`marginalRatePercent "39"` /
  `"17.5"`), appended after AC15's `describe` block inside `describe("tax-mode-compare mapper")`.

All 6 new assertions passed on first run (176 total, up from 172) — expected, since this behaviour
already shipped in Cycle 0; RED-first does not apply here (dispatch-disclosed, same pattern as
AC1/AC13's vacuous-pass cases in Cycle 0).

### Mutation evidence (the actual RED-equivalent for AC19/AC20)

Default reporter throughout (`--reporter=basic` still exits non-zero on Vitest 4 regardless of
result). Each mutation applied by `Edit`, run via `pnpm test`, then restored from a saved copy
(`/private/tmp/.../scratchpad/projection.ts.orig` / `projectionInputs.ts.orig`) and reconfirmed with
`git diff` (empty) before the next mutation — never two mutations live at once.

| # | Mutation | Result |
|---|---|---|
| M2 (re-run) | Zero `usWithholdingRate` on just the PIE leg (`lib/projection.ts`) | **Killed** — 2/176 failed: AC19 (new, `pieRow.usWithholdingNzd` 0 vs 825) and the pre-existing AC10 nonzero-WHT case |
| M1 (re-run) | Swap the two `project()` runs' labels (`lib/projection.ts`) | **Killed** — 12/176 failed, now including AC20's `pie.rows[1].nzTaxPayableNzd`/`direct.rows[1].nzTaxPayableNzd` |
| N4 | `formatCompareExplainer`: swap the "leads by" wrapper ternary (`finalDifferenceNzd > 0 ? "NZ PIE" : "US ETFs (direct)"` → the reverse), independent of N2's flip-label ternary (`components/projectionInputs.ts`) | **Killed** — both new AC20 explainer cases failed (2/176): the mutant produces `"NZ PIE (...) vs US ETFs (direct) (...), identical inputs — US ETFs (direct) leads by $1,936..."` for the `"39"` case — proving the old bare `toContain("US ETFs (direct)")` pattern would have passed vacuously (that substring is already present earlier in the line as the direct leg's own rate label), which is exactly why AC20 pins the full `"<wrapper> leads by <amount>"` substring instead |

M1/M2 confirm AC19/AC20 close the exact gaps the dispatch named; N4 is a new, AC20-specific mutation
(not one of Cycle 0's 12) demonstrating the old assertion style's blind spot directly. Re-running the
full original M3–M9/N1/N3 set (unchanged mutations, unchanged code) against the now-176-test suite:
all still killed (M3: 6/176, M4: 7/176, M5: 1/176, M6: 1/176, M7: 7/176, M8: 1/176, M9: 1/176, N1:
6/176, N3: 1/176) — no regression from the two new tests' presence. 14/14 mutations killed this
cycle (12 original + M1/M2 re-confirmed + N4 new); N2 (flip-label swap) also re-confirmed killed
(1/176) using the same mutation as Cycle 0.

### Source files — byte-identical, verified

```
$ git diff lib/projection.ts
$ git diff components/projectionInputs.ts
$ git diff components/InvestmentProjectionCalculator.tsx
```
All three produce empty output — no source line was touched this cycle, only the two test files and
this `notes.md`.

### Verification (clean checkout of this commit)

```
$ pnpm test
 Test Files  4 passed (4)
      Tests  176 passed (176)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm exec tsc --noEmit
(exit 0, no output)

$ pnpm build
✓ Compiled successfully
✓ Generating static pages (7/7)
```
