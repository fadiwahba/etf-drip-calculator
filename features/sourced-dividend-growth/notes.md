## What was built

Replaced the shipped `dividendGrowthPercent: "0"` default with **constant yield**:
`dividendGrowthPercent` defaults to whatever `sharePriceGrowthPercent` is, labelled in the UI as a
stated modelling convention, not a measurement (docs/PRD.md → Constraints, decided 2026-08-09).

Three changes, exactly as scoped, all in `components/projectionInputs.ts` plus the one component:

1. `seedAssumptionsFromFund` now also returns `dividendGrowthPercent` — `SeededAssumption` gets it
   as a number equal to `sharePriceGrowthPercent` (assigned from the same variable, not
   recomputed, so `===` holds exactly); `UnavailableAssumption` gets it as `""`. Derived from
   `fund.sharePriceGrowth`, never from `fund.dividendGrowth` (Out of Scope — that field stays
   `null` on all six rows in `data/funds.json`, untouched).
2. `dividendGrowthLinked: boolean` added to `ProjectionFormState`, plus one new pure reducer,
   `applyFieldChange(form, field, value)` — the only place the link is ever applied or broken
   (Constitution §2). While linked, editing `sharePriceGrowthPercent` copies the string verbatim
   onto `dividendGrowthPercent` (even an invalid one — while linked the two fields are one claim).
   The first edit of `dividendGrowthPercent` itself sets `dividendGrowthLinked: false`
   unconditionally and permanently (no re-link control, per Out of Scope). Every other field
   passes through untouched. `handleFieldChange` in the `.tsx` is now a one-line delegate to this.
3. `dividendGrowthHelperText(form)` — the two exact strings the spec requires, per link state —
   replaces the deleted "No fund publishes a multi-year per-share dividend CAGR" sentence.
   `formatFinalEffectiveYield(result)` — new, reads
   `dividendPerShareNzd / closingSharePriceNzd` off the last row and does no other arithmetic;
   guards empty rows, a zero/non-finite closing price, and a non-finite ratio, all to `"—"`.
   Typed `Pick<ProjectionResult, "rows">` so it accepts a nominal or a real result (same pattern
   `formatRegimeCell` already uses). Wired into the Summary Card as "Final-year effective yield".

`lib/projection.ts`, `lib/nzTax.ts`, `lib/funds.ts` and `data/*` are untouched —
`git diff --stat -- lib/projection.ts lib/nzTax.ts lib/funds.ts data/` produces no output (verified
below, "How to verify").

**Guardrail disclosure**: `makeForm` in the test file gained `dividendGrowthLinked: true`; its
existing `dividendGrowthPercent: "0"` stays `"0"`, so no pre-existing AC's behaviour changed — all
95 pre-existing tests in the file still pass unmodified.

**`applyFieldChange`'s type**: `field: Exclude<keyof ProjectionFormState, "taxMode" |
"showRealTerms">` per the Coder Guardrails' literal instruction. This widens to include
`dividendGrowthLinked` (a boolean field) even though no text input ever calls it with that field
(no reset control exists). Handled with an explicit `if (field === "dividendGrowthLinked") return
form;` no-op branch, after which the remaining field type is exactly the string-valued keys, so
`{ ...form, [field]: value }` type-checks against `ProjectionFormState` with no `as`/`!` anywhere
in the module. `handleFieldChange` in the `.tsx` is typed identically so the one-line delegate
compiles without a cast either.

## How to verify

```
pnpm test
pnpm lint
pnpm build
pnpm exec tsc --noEmit
```

Confirm the untouched-files constraint:

```
git diff --stat -- lib/projection.ts lib/nzTax.ts lib/funds.ts data/
# (no output)
```

Manually: open the calculator, note "Dividend growth (% p.a., per share)" now seeds to `9.12`
(same as share price growth) with the new linked helper text below it; edit share price growth and
watch dividend growth follow; edit dividend growth once and watch it stop following (helper text
switches); note the new "Final-year effective yield" tile beside the dividend figures.

## TDD

RED-first, one AC at a time (AC8 demonstrated via a deliberate temporary bug, reverted
immediately — see below). Every RED run below is the actual `pnpm exec vitest run` output at the
point the corresponding test was added but before the real implementation existed; every GREEN run
is the same test after implementing.

### RED — SDG-AC1 / SDG-AC3 (seedAssumptionsFromFund, stub returned `dividendGrowthPercent: 0`)

```
FAIL  ... SDG-AC1 ... dividendGrowthPercent is strictly === sharePriceGrowthPercent and toFixed(2) is '9.12'
AssertionError: expected +0 to be 9.120000000000001 // Object.is equality
- Expected: 9.120000000000001
+ Received: 0

FAIL  ... SDG-AC3 ... a Fund literal with sharePriceGrowth 0.07 and dividendGrowth 0.05 seeds 7.00, not 5.00
AssertionError: expected '0.00' to be '7.00' // Object.is equality

Tests  2 failed | 1 passed | 76 skipped (79)   [SDG-AC2 passed immediately — the "" branch was
                                                 already correct before this change]
```

### RED — SDG-AC4 / SDG-AC5 / SDG-AC6 (applyFieldChange, stub returned `{ ...form }` unchanged)

```
× (SDG-AC4) sharePriceGrowthPercent -> "5" but dividendGrowthPercent stayed "9.12"
× (SDG-AC5a) dividendGrowthPercent stayed "9.12" instead of "0", dividendGrowthLinked stayed true
× (SDG-AC5b) dividendGrowthPercent stayed "9.12" instead of surviving as "0"
× (SDG-AC5c) result.value.dividendGrowth was 0.0912 instead of 0
× (SDG-AC6) initialCapital stayed "100000" instead of "250000"

Tests  5 failed | 3 passed | 76 skipped (84)
```

### RED — SDG-AC7 (dividendGrowthHelperText, stub returned `""`)

```
FAIL  ... SDG-AC7 ... linked
AssertionError: expected '' to be 'Tracks share price growth — constant yield. ...'
FAIL  ... SDG-AC7 ... unlinked
AssertionError: expected '' to be 'Your own figure — no longer tracking share price growth, ...'

Tests  2 failed | 1 passed | 84 skipped (87)
```

### RED — SDG-AC8 (deliberate, then reverted)

Both SDG-AC8 tests passed on first write — the blank-still-errors half is pre-existing,
unmodified behaviour, and `buildProjectionInput` never referenced `dividendGrowthLinked` to begin
with, so "the flag never reaches the engine" held without any new code. To prove the second
assertion actually discriminates (not vacuous), a one-line leak was injected temporarily —
`(value as unknown as Record<string, unknown>).dividendGrowthLinked = form.dividendGrowthLinked;`
— immediately before `buildProjectionInput`'s `return { ok: true, value }`, run, then reverted:

```
FAIL  ... SDG-AC8 ... 'dividendGrowthLinked' is never a key of the built ProjectionInput
AssertionError: expected true to be false // Object.is equality

Tests  1 failed | 1 passed | 87 skipped (89)
```

`git diff` on `components/projectionInputs.ts` after the revert is byte-identical to before the
injection (verified with `diff -q` against a pre-mutation copy — see "Mutation testing" below).

### RED — SDG-AC9 (formatFinalEffectiveYield, stub always returned `"0.00%"`)

```
FAIL  ... (a) dividendGrowthPercent '9.12' -> '3.25%' ...
AssertionError: expected '0.00%' to be '3.25%'
FAIL  ... (b) dividendGrowthPercent '0' -> '0.24%' ...
AssertionError: expected '0.00%' to be '0.24%'
FAIL  ... (d) empty rows, or a final row with closing price 0 or non-finite, returns '—' ...
AssertionError: expected '0.00%' to be '—'

Tests  3 failed | 1 passed | 89 skipped (93)   [(c) passed immediately -- with a constant stub
                                                 both sides trivially matched; the real
                                                 implementation was checked again after
                                                 implementing and still matches, non-vacuously,
                                                 since (a)/(b) already pin the real numbers]
```

### SDG-AC10

Runs `runProjection` end-to-end (not `lib/projection.ts` directly) on the audit's trigger scenario
and asserts the engine's own output. Since `lib/projection.ts` is untouched and the mapper simply
forwards fields 1:1, there is no new coder logic here to RED against — this is a characterization
test pinning the fixed default's real-world effect, verified independently against the raw engine
before being written (see "Verify the numbers yourself" below). It passed on first write.

### GREEN — full suite after every implementation

```
RUN  v4.1.10
Test Files  1 passed (1)
     Tests  95 passed (95)
```

Full project suite (`pnpm test`), unchanged file count, all passing:

```
Test Files  4 passed (4)
     Tests  224 passed (224)
```

## Verify the numbers yourself

Before writing any assertion, the trigger scenario was run directly against the **unmodified**
`lib/projection.ts` (`project()` / `toRealTerms()` / `findIncomeCrossover()`), bypassing the
mapper entirely, in a throwaway test deleted immediately after (never committed):

```
=== g = 0 ===
real.rows[30].grossDividendsNzd 2204.1628846767594
real.totalDividendsDrawnNzd 38989.257518867635
crossover.finalYearNetIncomeNzd -11858.599234176243
crossover.crossoverYear null
effective yield ratio 0.0023700234417310295

=== g = 0.0912 ===
real.rows[30].grossDividendsNzd 39241.19928483054
real.totalDividendsDrawnNzd 366579.4894047413
crossover.finalYearNetIncomeNzd 20983.817483575625
crossover.crossoverYear null
effective yield ratio 0.03249999999999998
```

Every one of these agrees with the spec's stated numbers within $1 / 1e-12 as applicable. **No
blocker was raised** — the numbers reconcile exactly.

## Before/after — the audit's trigger scenario

100000 initial · 30y · 1000/mo · 9.12% growth · 3.25% yield · direct · 33% marginal · 15% WHT ·
stop 15 · draw 16 · 3% inflation · real terms on · target 60000, through `runProjection`:

| figure (real) | `dividendGrowthPercent "0"` (old default) | `"9.12"` (new default) |
|---|---|---|
| `real.rows[30].grossDividendsNzd` | $2,204 | $39,241 |
| `real.totalDividendsDrawnNzd` | $38,989 | $366,579 |
| `crossover.finalYearNetIncomeNzd` | −$11,859 | +$20,984 |
| `crossover.crossoverYear` | `null` | `null` |

AC9's two effective yields, same scenario: `"9.12"` → **3.25%** (raw ratio 0.0325, constant by
construction); `"0"` → **0.24%** (0.0325 ÷ 1.0912³⁰ = 0.2370%).

**The crossover is NOT reached** in either case — fixing the default makes the sign and the
magnitude of the numbers coherent (a $100k/30y SCHD-style portfolio genuinely does produce a
five-figure net income in year 30, not a loss), it does not make the $60,000 target achievable
under this scenario's parameters. This is the correct, expected outcome per spec.md AC10.

## Mutation testing

Reporter: default (never `--reporter=basic`, which exits non-zero on Vitest 4 regardless of
result — real pass/fail counts read from the default output below). Each mutation was applied by
hand, `pnpm exec vitest run components/__tests__/projectionInputs.test.ts -t "SDG-AC"` run, then
the file restored from a pre-mutation copy and diffed byte-identical before continuing.

1. **Default reverting to 0** — `dividendGrowthPercent: sharePriceGrowthPercent` →
   `dividendGrowthPercent: 0` in `seedAssumptionsFromFund`. **Killed**: SDG-AC1 and SDG-AC3 both
   fail (`2 failed | 17 passed`).
2. **Default not tracking sharePriceGrowth** — the `next.dividendGrowthPercent =
   next.sharePriceGrowthPercent` line in `applyFieldChange` short-circuited to unreachable.
   **Killed**: SDG-AC4 fails (`expected "9.12" to be "5"`).
3. **A user-entered value overwritten by a later price-growth edit** — the `&&
   next.dividendGrowthLinked` guard removed, so a sharePriceGrowthPercent edit always overwrites
   dividendGrowthPercent, even when unlinked. **Killed**: SDG-AC5(b)/(c) fail
   (`2 failed | 17 passed`) — `dividendGrowth` reaches the engine as `0.05` instead of the
   user-typed `0`.
4. **A user-entered "0" treated as empty** — the unlink condition changed to `field ===
   "dividendGrowthPercent" && value !== "0" && value !== ""` (a falsy/blank-style check that
   treats `"0"` as if it should NOT break the link). **Killed**: SDG-AC5(a)/(b)/(c) all fail
   (`3 failed | 16 passed`) — the link never breaks on a typed `"0"`, so a later share-price edit
   overwrites it.
5. **The linked flag never flipping** — the `next.dividendGrowthLinked = false` line
   short-circuited to unreachable. **Killed**: SDG-AC5(a)/(b)/(c) all fail
   (`3 failed | 16 passed`).
6. **`formatFinalEffectiveYield`'s explicit `closingSharePriceNzd === 0` check removed** (leaving
   only the `!Number.isFinite(...)` guards). **Survived** — `4 passed`. Not vacuous: with a zero
   price and a positive `dividendPerShareNzd`, the ratio itself becomes `+Infinity`, which the
   downstream `!Number.isFinite(ratio)` guard still catches, so `"—"` is still returned by a
   different code path. The explicit `=== 0` check is deliberate defense-in-depth per invariant 13
   ("guard the degenerate cases" explicitly, not by incidental IEEE754 behaviour) and is left in
   place; it is not dead code the test failed to exercise (both guarded values are reached), it is
   a redundant-but-correct extra guard the current fixtures cannot distinguish from the ratio
   guard alone.

All five required mutations (default→0, no tracking, overwrite-on-edit, "0"-as-empty, flag never
flips) are killed by the test suite. The one survivor is a genuine redundancy in the
implementation, not a test gap in coverage of the spec's required behaviour.
