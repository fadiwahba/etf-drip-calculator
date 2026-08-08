## What was built

`lib/nzTax.ts` `computeAnnualTax`: the FIF de minimis gate is now wrapper-aware, per
`.claude/rules/nz-tax.md` "the de minimis is a DIRECT-HOLDING rule only — it never applies to a
PIE". The regime decision changed from:

```ts
if (!aboveThreshold) { regime = "dividend"; ... }
```

to:

```ts
if (input.wrapper === "direct" && !aboveThreshold) { regime = "dividend"; ... }
```

A PIE is now always `regime: "fif"`, regardless of cost. `aboveThreshold` (`foreignCostNzd >
fifThresholdNzd`) is unchanged as a literal fact for both wrappers (nz-tax.md decision 3) — it no
longer alone decides `regime`; it is informational only for a PIE.
`regime === "fif" && aboveThreshold === false` is the discriminator a caller now uses to tell
"PIE below the de minimis" apart from "direct holding above it".

Also built (AC11, UI):
- `components/projectionInputs.ts` `formatSingleModeExplainer`: for `wrapper: "pie"`, the line no
  longer claims "above"/"below the $50,000 de minimis" (a threshold outcome a PIE never got); it now
  states "FIF applies from the first dollar — the de minimis is a direct-holding rule only." The
  `"direct"` branch's wording is byte-identical to before.
- `formatRegimeCell` moved from `components/InvestmentProjectionCalculator.tsx` (a local, untested
  function) into an exported helper in `components/projectionInputs.ts`, and now renders "above $50k"
  conditionally on the row's own `aboveThreshold` — not unconditionally on every FIF row. A PIE row
  can be `fif` + `aboveThreshold: false`; the old code printed "above $50k" for it regardless (flatly
  false for a $30k PIE). `InvestmentProjectionCalculator.tsx` now imports and calls the moved helper
  instead of defining it locally; the unused `ProjectionRow` type import was removed from that file
  since only the moved helper needed it.

## How to verify

```
pnpm test    # 204/205 pass — see "Blocker" below for the one known, unauthorized-to-fix failure
pnpm lint    # zero warnings
pnpm build   # succeeds
pnpm exec tsc --noEmit   # clean
```

Manually: run the UI with tax mode "NZ PIE", initial capital $30,000 — the year-1 regime cell now
reads "FIF · FDR" (no false "above $50k"), and the explainer line states FIF applies from the first
dollar rather than claiming a de minimis outcome.

## Before / after — mandatory comparison table

**Fixture PIE-30k** (the spec's own fixture, and the audit's live case): `wrapper: "pie"`,
`foreignCostNzd` 30,000, `openingValueNzd` 30,000, `closingValueNzd` 32,700, `grossDividendsNzd` 975
(3.25%), `pir` 0.28, `marginalRate` 0.33, no WHT. Computed by `computeAnnualTax` directly (see
`lib/__tests__/nzTax.test.ts` "AC1 — a sub-$50k PIE runs FIF" for the exact test).

| Field | Before (shipped) | After (correct) |
|---|---|---|
| `regime` / `method` | `dividend` / `actual-dividends` | `fif` / `fdr` |
| `taxableIncomeNzd` | 975 | 1,500 (5% × 30,000) |
| `rate` | 0.28 | 0.28 |
| `grossTaxNzd` | **273.00** | **420.00** |
| drag on 30,000 (`grossTaxNzd / openingValueNzd`) | **0.91%** | **1.40%** |

1.40% is the figure `.claude/rules/nz-tax.md` states for a PIR-28% holding
(`FDR_RATE × PIR_CAP = 5% × 28% = 1.4%`).

**Control — the same numbers with `wrapper: "direct"`, `marginalRate` 0.33** (no `pir`): taxable
975, `grossTaxNzd` **321.75**, regime `dividend` — **before === after, unchanged.** This is asserted
in the same test body as the PIE case (`nzTax.test.ts` "AC2") so a regression that made both wrappers
agree again (i.e. reverted the gate) cannot pass silently.

Own arithmetic check before implementing (per Coder Guardrails "verify the numbers yourself"): I
independently recomputed every numeric AC in spec.md (ACs 1-10, including the three-year mid-run
crossing scenario, AC10) by hand before writing a single test, and every value in the spec agreed
with my own computation — no blocker was needed on arithmetic grounds.

## TDD

### `lib/nzTax.ts` — RED (before the fix, 8 of 10 new ACs fail; AC5/AC6/AC7 are regression pins,
correctly green pre-fix)

```
 ❯ lib/__tests__/nzTax.test.ts (32 tests | 8 failed)
     × AC1 — a sub-$50k PIE runs FIF (fdr), not the dividend regime
       AssertionError: expected 'dividend' to be 'fif'
     × AC2 — the same fixture as a direct holding keeps the dividend regime (regression pin)
       AssertionError: expected 'dividend' not to be 'dividend'
     × AC3 — PIE drag is 1.40% of value, not the shipped 273 (= 975 × 0.28)
       AssertionError: expected 0.0091 to be close to 0.014, received difference is 0.0049
     × AC4 — boundary at the threshold: direct untouched, PIE runs FIF anyway
       AssertionError: expected 'dividend' to be 'fif'
     × AC8 — fifThresholdNzd cannot change a PIE's tax, but still sets aboveThreshold and is still validated
       AssertionError: expected 'dividend' to be 'fif'
     × AC9(a) — a losing year floors CV at zero, so tax is $0 even though FDR is positive
       AssertionError: expected 'actual-dividends' to be 'cv'
     × AC9(b) — an exact FDR/CV tie resolves to method fdr, per spec
       AssertionError: expected 'actual-dividends' to be 'fdr'
     × AC10 — a run crossing $50k mid-projection diverges by wrapper
       AssertionError: expected 'dividend' to be 'fif'

 Test Files  1 failed (1)
      Tests  8 failed | 24 passed (32)
```

Every failure is for the right reason: `computeAnnualTax` gated the regime on `!aboveThreshold`
alone, ignoring `wrapper`. AC5 (byte-identical PIE-above-threshold), AC6 (byte-identical direct at
every size) and AC7 (`fifThresholdNzd` boundary/validation for direct) were correctly green already
— they pin behaviour the fix does not change.

### `lib/nzTax.ts` — GREEN (after the fix)

```
 RUN  v4.1.10
 Test Files  1 passed (1)
      Tests  32 passed (32)
```

### `components/projectionInputs.ts` (AC11) — RED

```
 ❯ components/__tests__/projectionInputs.test.ts (76 tests | 4 failed | 69 skipped)
     × AC11(a) a sub-$50k PIE run states FIF-from-first-dollar, not 'above'/'below the $50,000 de minimis'
       AssertionError: expected 'NZ PIE: Year 1 is FIF (FDR), below th…' not to contain
       'below the $50,000 de minimis'
     × AC11(b) fif + aboveThreshold false (sub-$50k PIE) omits the threshold claim
       TypeError: formatRegimeCell is not a function
     × AC11(b) fif + aboveThreshold true renders exactly the pre-existing string (regression pin)
       TypeError: formatRegimeCell is not a function
     × AC11(b) dividend rows keep their exact current string, whatever aboveThreshold is (regression pin)
       TypeError: formatRegimeCell is not a function

 Test Files  1 failed (1)
      Tests  4 failed | 3 passed | 69 skipped (76)
```

(`formatRegimeCell` wasn't exported from `projectionInputs.ts` pre-fix — it lived locally in the
`.tsx` — so the RED for AC11(b) is a genuine "doesn't exist yet" failure, not an import error masking
the real assertion; the regression-pin sub-tests still exercise real assertions once the export
exists, in GREEN below.)

### `components/projectionInputs.ts` (AC11) — GREEN

```
 RUN  v4.1.10
 Test Files  1 passed (1)
      Tests  7 passed | 69 skipped (76)
```

## Corrected assertions in `lib/__tests__/projection.test.ts` (authorised scope expansion)

Per the dispatch's explicit override of spec.md's "expected blocker" guardrail: AC6 (Fixture R) and
AC7 (Fixture F) pinned the pre-fix defect and were rewritten to the true, engine-verified output.
**Every value below was read off a real `compareWrappers()` run on the corrected engine, not hand
-derived** — Fixture R/F compound tax-funded share sales year over year (this is a DRIP model with
no external cash; tax is paid by selling shares), so a PIE paying tax from year 1 instead of year 3
has fewer shares in every later year, which changes essentially every downstream number, not just the
first one. I did not "fix" any of these in place against my own disagreeing arithmetic — I read the
real output of the already-fixed `lib/nzTax.ts` and pinned that.

**Direct-leg values are unchanged in both tests** (48,000 / 56,800 / 65,372.4 / 74,634.8782 for
Fixture R; 44,244 / 48,913.7530909091 and both `costBasisNzd`/`aboveThreshold` for Fixture F) — the
non-negotiable boundary ("direct holdings at any size... must produce byte-identical results") holds.

### AC6 (Fixture R) — old vs new

| Field | Old (pinned the defect) | New (correct) | Why old was wrong |
|---|---|---|---|
| `pie.rows[1].taxRegime` | `"dividend"` | `"fif"` | nz-tax.md: a PIE runs FIF from the first dollar; $40,000 cost is irrelevant to a PIE's regime. |
| `y1.pieClosingValueAfterTaxNzd` | 48,000 | 47,440 | Follows from the regime fix — PIE now pays FDR tax (5% × 40,000 × 0.28 = 560) in year 1. |
| `y1.differenceNzd` | 0 | -560 | Direct pays $0 (no dividends, below threshold); PIE now pays 560 from year 1. |
| `y2.pieClosingValueAfterTaxNzd` | 56,800 | 55,519.84 | Compounds the year-1 tax-funded share reduction. |
| `y2.differenceNzd` | 0 | -1,280.16 | Same. |
| `y3.pieClosingValueAfterTaxNzd` | 65,684.8 | 64,294.54624 | Compounds two years of PIE tax the old test never modelled. |
| `y3.differenceNzd` | +312.4 (pie ahead) | -1,077.85376 (direct ahead) | Sign itself flips — old test had the PIE winning at year 3; it never does. |
| `y4.pieClosingValueAfterTaxNzd` | 75,333.6928 | 73,823.87721664 | Same compounding. |
| `y4.differenceNzd` | +698.8146 | -811.00098336 | Same. |
| `firstDecisiveYear` | 3 | 1 | Direct is decisively cheaper from year 1, not year 3. |
| `firstDecisiveWrapper` | `"pie"` | `"direct"` | Was backwards under the old model. |

Unchanged (verified, not touched): `pie.rows[3].costBasisNzd` (52,000 — cost basis is
wrapper-independent here, this fixture pays no dividends), `pie.rows[3].taxRegime` (`"fif"` — was
already correct pre-fix since cost 52,000 > 50,000 already crossed the old wrapper-blind gate),
`flipYear` (`null` — direct leads throughout in both old and new, it just leads by a different
margin and from a different year).

### AC7 (Fixture F) — old vs new

| Field | Old (pinned the defect) | New (correct) | Why old was wrong |
|---|---|---|---|
| `pie.rows[1].taxRegime` | `"dividend"` | `"fif"` | Same root cause as AC6. |
| `pie.rows[1].taxableIncomeNzd` | (not asserted) | 2,000 | FDR = 5% × 40,000; added as a new assertion, not a correction of an old one. |
| `y1.pieClosingValueAfterTaxNzd` | 44,288 | 43,840 | PIE now pays 560 tax in year 1 instead of the old $0. |
| `y1.differenceNzd` | +44 (pie ahead) | -404 (direct ahead) | Sign flips. |
| `y1.cheaperWrapper` | `"pie"` | `"direct"` | Follows from the sign flip. |
| `pie.rows[2].costBasisNzd` | 40,802.6181818181818 | 40,798.545454545456 | The PIE's cost basis itself changed: year-1 tax was paid by selling shares (DRIP model), leaving fewer shares to earn year-2 dividends (which are reinvested and drive cost basis) than the old, wrongly-untaxed PIE leg had. |
| `pie.rows[2].aboveThreshold` | `true` | `false` | Direct consequence of the lower cost basis above — it no longer happens to cross this fixture's tight `fifThresholdNzd: 40,802.4`. Now informational only for a PIE anyway (nz-tax.md decision 3): it never decided the regime, which was already `"fif"` at year 1. |
| `pie.rows[2].taxableIncomeNzd` | 2,214.4 | 2,192 | FDR = 5% × pie's own (now-lower) opening value 43,840, not the old 44,288. |
| `y2.pieClosingValueAfterTaxNzd` | 48,499.38618181818 | 48,008.785454545456 | Compounds the above. |
| `y2.differenceNzd` | -414.36690909091 | -904.967636363639 | Same verdict (direct cheaper), bigger margin. |
| `y3.differenceNzd` | ≈-184.4 | -721.2482824658218 | Same verdict, bigger margin. |
| `y4.differenceNzd` | ≈+91.26 (reversal back to pie) | -495.7889212610753 | **The reversal this AC was built to demonstrate does not happen under the fix** — direct stays cheaper throughout. |
| `firstDecisiveYear` / `firstDecisiveWrapper` | 1 / `"pie"` | 1 / `"direct"` | Backwards under the old model. |
| `flipYear` / `flipWrapper` | 2 / `"direct"` | `null` / `null` | **There is no flip anymore** — see "Fixture F no longer flips" below. |

Unchanged (verified, not touched): `direct.rows[2].costBasisNzd` (40,802.2181818181818),
`direct.rows[2].aboveThreshold` (`false`), `y1.directClosingValueAfterTaxNzd` (44,244),
`y2.directClosingValueAfterTaxNzd` (48,913.7530909091).

**Fixture F no longer flips — flagged, not silently patched over.** Fixture F was built specifically
to straddle its own tight `fifThresholdNzd: 40,802.4` so the PIE's cost basis crossed a fraction of a
dollar before direct's, producing a flip. Under the fix, the PIE's cost-basis trajectory itself
changed (see the `costBasisNzd` row above), so it no longer straddles that threshold the same way —
and it wouldn't matter if it did, since a PIE's regime no longer depends on the threshold at all. I
renamed the test to describe what actually happens now (`"the fixture's old 'flip' no longer
occurs"`) rather than leave a test named "a real flip" asserting `flipYear: null`. This is a genuine
loss of test coverage for `compareWrappers`' flip-detection logic itself (unrelated code, untouched
by this fix) — see "Blocker" below, since the same root cause reappears in a test I am not authorised
to edit.

## Blocker — one unauthorised, pre-existing test now fails for the same root cause

`components/__tests__/projectionInputs.test.ts` — `"AC15 — formatTaxModeExplainer, compare mode" >
"names the flip year and the wrapper it flips to when the comparison flips"` now fails:

```
AssertionError: expected null not to be null
 ❯ components/__tests__/projectionInputs.test.ts:749:43
      expect(run.comparison.flipYear).not.toBeNull();
```

This fixture (`initialCapital: "46230"`, `dividendYieldPercent: "1"`, `pirPercent: "28"`,
`marginalRatePercent: "39"`, `usWithholdingPercent: "0"`, `termYears: "10"`) was built on the same
false premise as `lib/__tests__/projection.test.ts`'s AC6/AC7: its own comment says "a low dividend
yield keeps pie ahead while both legs are below the $50k de minimis" — exactly the assumption
nz-tax.md corrects. With the fix, the PIE leg is `fif` from year 1, not `dividend`, so this scenario's
flip no longer happens (`run.comparison.flipYear` is `null`, not a specific year).

**I did not fix this.** I have explicit authorisation to edit exactly two named tests in
`lib/__tests__/projection.test.ts`, and explicit instruction to "STOP and raise a blocker" rather
than extend that authorisation myself if a third assertion fails unexpectedly. This is a third
failure, in a different file, for a numeric regression pin (not the AC11 explainer-text carve-out I
do have authorisation for in this file). I left it exactly as it was, still failing.

**What needs a decision:** either (a) authorise correcting this test's fixture/expected values the
same way AC6/AC7 were corrected (I can supply the real engine output on request — same category of
fix, same root cause), or (b) this fixture needs replacing with one that genuinely demonstrates a
flip under the corrected engine, since — per the AC6/AC7 investigation above — a PIE running FIF from
dollar one changes which scenarios actually flip. Either way this is an architect call, not mine to
make unilaterally.

`pnpm test` therefore reports **204/205 passing**, with this one, single, identified and explained
failure.

## Mutation testing

Ran with the default reporter (per guardrail: `vitest --reporter=basic` exits non-zero on Vitest 4
regardless of result and proves nothing — pass/fail counts read from real output below, each mutant
applied to `lib/nzTax.ts`, tested, then reverted).

**Mutant 1 — revert the gate** (`if (input.wrapper === "direct" && !aboveThreshold)` →
`if (!aboveThreshold)`, i.e. the original shipped defect):

```
 Test Files  2 failed (2)
      Tests  10 failed | 90 passed (100)
```
Killed — 10 tests fail, including AC1/AC2/AC4/AC8/AC9/AC10 in `nzTax.test.ts` and both corrected
`projection.test.ts` tests.

**Mutant 2 — apply the gate to the wrong wrapper** (`wrapper === "direct"` → `wrapper === "pie"`,
i.e. a PIE gets the dividend-regime relief and a direct holding is forced into FIF from dollar one):

```
 Test Files  2 failed (2)
      Tests  34 failed | 66 passed (100)
```
Killed — 34 tests fail. This breaks direct holdings too (every direct-below-threshold fixture now
wrongly reports `fif`), so it is caught far more broadly than mutant 1.

**Mutant 3 — boundary, `>` → `>=`** (`aboveThreshold = foreignCostNzd >= fifThresholdNzd`, applied
to both wrappers since `aboveThreshold` is computed once, before the wrapper branch):

```
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 98 passed (100)
```
Killed — 2 tests fail: the pre-existing direct-only boundary test (`"boundary — cost exactly at the
de minimis threshold..."`) and this feature's own AC4 (`"boundary at the threshold: direct untouched,
PIE runs FIF anyway"`), which asserts `aboveThreshold: false` for both wrappers at
`foreignCostNzd === fifThresholdNzd`.

All three required mutants killed. `lib/nzTax.ts` was restored to the correct state after each
mutant and reverified with a full `pnpm test` run (204/205 passing, the one documented blocker) before
finishing.

## Cycle 2 — the one authorised test fixed, `lib/nzTax.ts` untouched

The architect's adjudication authorised fixing exactly one test:
`components/__tests__/projectionInputs.test.ts` — `"AC15 — formatTaxModeExplainer, compare mode" >
"names the flip year and the wrapper it flips to when the comparison flips"`. `lib/nzTax.ts` was
**not edited this cycle** — `git diff -- lib/nzTax.ts` shows only Cycle 1's original change (the
`aboveThreshold`-doc-comment and the `if (input.wrapper === "direct" && !aboveThreshold)` gate,
already pasted in full in Cycle 1's TDD section above); there is nothing new to show because nothing
changed.

### Old fixture, and why it was wrong

`initialCapital: "46230"`, `dividendYieldPercent: "1"`, `marginalRatePercent: "39"`,
`termYears: "10"`; asserted `flipWrapper === "direct"`. Its own comment said it was built so "a low
dividend yield keeps pie ahead while both legs are below the $50k de minimis" — a PIE escaping FIF
below $50k, exactly the bug this feature fixes. Under the corrected engine it never flips: direct
wins every year 1-10 by a growing margin, so `flipYear` stays `null` and
`expect(...).not.toBeNull()` fails.

### Direction, verified before touching the test

A PIE's FDR drag is a flat `FDR_RATE × PIR_CAP = 5% × 28% = 1.4%` of value from year 1,
unconditionally. A direct holding below the de minimis pays actual dividends at marginal rate — cheap
at a low yield (`1.5% × 39% ≈ 0.585%`, under 1.4%). Once direct's own cost basis crosses $50k, it
switches to FDR at marginal rate (`5% × 39% = 1.95%`) — now above the PIE's flat 1.4%. So the correct
direction is a below-threshold **direct** lead that **flips to pie**, matching the architect's own
adjudication (direct → pie, the opposite of the old test), decided before any fixture was chosen.

### New fixture, found by searching the real engine

A throwaway Vitest file (deleted before finishing, not part of the delivered diff) ran the real,
unmodified `runProjection()` over nine candidates, varying capital/yield/term. Eight never flipped;
`initialCapital: 48000, dividendYieldPercent: 1.5, marginalRatePercent: 39, termYears: 12` did —
`firstDecisiveWrapper: direct` (years 1-5), `flipWrapper: pie` from year 6:

| Year | pie regime | pie above | direct regime | direct above | diff (pie−direct) | winner |
|---|---|---|---|---|---|---|
| 1 | fif/fdr | false | dividend | false | -391.20 | direct |
| 2 | fif/fdr | false | dividend | false | -883.06 | direct |
| 3 | fif/fdr | true | fif/fdr | true | -642.93 | direct |
| 5 | fif/fdr | true | fif/fdr | true | -9.51 | direct |
| 6 | fif/fdr | true | fif/fdr | true | +395.72 | **pie** |

Direct crosses $50k cost between years 2-3 and switches to the pricier 1.95% FDR, but its years-1-2
head start (cheap dividend tax on a thin yield) takes until year 6 to be overtaken by pie's steadily
smaller tax bill. Year 5's -9.51 margin is well outside `WRAPPER_TIE_EPSILON_NZD` (`1e-6`) — not a
near-miss — before flipping decisively to +395.72 at year 6.

**Own arithmetic, year 1** (Coder Guardrails "verify the numbers yourself"): `grossDividends =
48000 × 0.015 = 720` (0% WHT, all reinvested) → `costBasis = 48720`, matching the engine for both
legs. Direct: `48720 < 50000` → dividend regime, `720 × 0.39 = 280.80` — matches exactly. PIE: FIF
from year 1, `FDR = 0.05 × 48000 = 2400`, `2400 × 0.28 = 672.00` — matches exactly. Both agree with
the engine to the cent, so I trust its own compounding for years 2-12 (same code path already covered
by 32 `nzTax.test.ts` tests and the regression-pinned `projection.test.ts` fixtures).

### The fix and its significance

Replaced, in the named test only: `initialCapital` 46230→48000, `dividendYieldPercent` 1→1.5,
`termYears` 10→12, `flipWrapper` assertion `"direct"`→`"pie"`, explainer substring
`"flips to US ETFs (direct) in year N"` → `"flips to NZ PIE in year N"`. Added
`expect(firstDecisiveWrapper).toBe("direct")` and pinned `flipYear` to the literal `6`, not just
"not null". Updated the test's own comment to describe the real mechanism.

**Significance:** the bug was not just a mispriced PIE — in the sub-$50k range at a low yield and
high marginal rate it **inverted which wrapper the tool recommended**. Under the corrected engine,
direct is unambiguously cheaper for the first several years of exactly this scenario shape, not pie.

### Mutation check

Flipped `expect(flipWrapper).toBe("pie")` to `.toBe("direct")`, reran with the default reporter (not
`--reporter=basic`, which exits non-zero on Vitest 4 regardless of outcome):

```
AssertionError: expected 'pie' to be 'direct' // Object.is equality
```

Killed. Reverted to `.toBe("pie")` immediately after.

### Final verification (real output)

```
$ pnpm test
 Test Files  4 passed (4)
      Tests  205 passed (205)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
 ✓ Compiled successfully
 ✓ Generating static pages (7/7)

$ pnpm exec tsc --noEmit
(no output — clean)
```

`pnpm test` is fully green: **205/205**. The prior Cycle 1 blocker is resolved; no other test was
touched. `lib/nzTax.ts` was not edited this cycle — `git diff -- lib/nzTax.ts` shows only Cycle 1's
change, nothing new.
