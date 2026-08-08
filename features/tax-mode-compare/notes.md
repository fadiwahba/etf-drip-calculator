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
