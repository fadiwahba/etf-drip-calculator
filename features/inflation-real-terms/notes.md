# inflation-real-terms — implementation notes

## What was built

- **`lib/projection.ts`** (pure append, 0 deletions — `git diff --stat` confirms `119 insertions(+)`,
  `0` deletions): `RealProjectionRow`, `RealProjectionResult`, and `toRealTerms(result, inflationRate)`.
  One `project()` call in, a view out — no second projection, no `/(1+i)` in a tax base.
  `project()`, `projectFund()`, `validateInput`, `resolvePhase`, `buildYearZeroRow` and the three
  existing interfaces have **zero edited lines**. Rate validation reuses the existing
  (unedited) `assertHalfOpenRate` — same `[0,1)` domain as every other fee/rate field.
- **`components/projectionInputs.ts`**: `ProjectionFormState` gains `showRealTerms: boolean` and
  `inflationRatePercent: string`. New export `parseInflationRate(form)`. `buildProjectionInput`
  validates the rate field into `errors.inflationRatePercent` but never writes it into the returned
  `ProjectionInput` (R1 — inflation is not an engine input). `runProjection` now returns
  `{ ok: true, value, real }` — `real` is `toRealTerms(value, rate)` when the toggle is on,
  `undefined` when off; `value` (the nominal path) is identical either way.
- **`components/InvestmentProjectionCalculator.tsx`**: plain `<input type="checkbox">` "Show in
  today's dollars (real terms)" (checked by default), "Inflation rate (% p.a.)" input (default
  `"3"`, disabled with value kept when the toggle is off, with a `FieldError` and the line "3% is a
  chosen planning assumption, not a published forecast."), a **Purchasing power lost** column after
  End Balance shown only when the toggle is on, tile headings suffixed `" (today's dollars)"` when
  on, and a static line that the memo is not a cash outflow and contributions are nominal. All
  `/(1+i)` arithmetic stays in `toRealTerms` — this file only picks `real` vs `value`.
- **Test-only fixes (F1/F2, spec Scope)**: AC14 pins the fee drag as phase-identical with non-zero
  fees (Fixture R). AC15 fixes `3PP-AC9` (first fixture was a duplicate Draw run that never
  finiteness-checked Coast) — replaced with a genuine Coast fixture, pinned by `rows[2].phase`.
  Both already passed on the pre-existing (unedited) engine — see the TDD section, they are
  regression pins, not RED→GREEN pairs.
- Disclosed per guardrails: `makeForm()` (`components/__tests__/projectionInputs.test.ts`) gained
  `showRealTerms: true, inflationRatePercent: "3"` defaults, matching the UI's own defaults (R6).

## How to verify

```
pnpm test        # 119 passed (4 files)
pnpm lint        # ✔ No ESLint warnings or errors
pnpm exec tsc --noEmit   # exit 0, no output
pnpm build       # ✓ Compiled successfully
```

Manually: load the calculator, leave defaults (toggle on, rate "3") — Final Portfolio Value reads
noticeably lower than with the toggle off, tiles say "(today's dollars)", a Purchasing power lost
column appears after End Balance. Toggle off: rate input disables (value stays "3"), column
disappears, tiles read the same as before this feature shipped.

## Additive guarantee

`git diff --stat lib/projection.ts`:
```
lib/projection.ts | 119 ++++++++++++++++++++++++++++++++++++++++++++++++++++++
1 file changed, 119 insertions(+)
```
Zero deletions — every pre-existing line of `project()`/`projectFund()`/`validateInput`/
`resolvePhase`/`buildYearZeroRow`/the three interfaces is untouched.

Scratch (uncommitted, deleted before finishing — `scratch-diff.test.ts` +
`scratch-pre-projection.ts`, a copy of `git show HEAD:lib/projection.ts`): ran the pre-change and
post-change `project()` over 500 pseudorandom valid inputs (seeded mulberry32 PRNG covering every
field: term, cadence, timing, growth/dividend rates, both `growthBasis` values, fees, FX, both
wrappers, PIR, FIF threshold, three-phase fields) plus the UI-default scenario (100k/15y/SCHD
seed/direct/33%/15% WHT), `Object.is` on every row field and every summary field:
```
compared 501 valid fixtures, 0 field mismatches
```
This scenario set is also what proves AC17's "nominal column is unchanged" claim below — the UI
default fixture is fixture #1 in this same run.

## TDD

All of `lib/` and the mapper is RED-first. AC13 (UI) is `--no-tdd`-exempt per the spec: jsdom +
testing-library are banned new deps; the UI is pure wiring over `runProjection`/`toRealTerms`,
already covered by AC9–AC12's mapper tests and AC1–AC8/AC16's engine tests.

### RED — `lib/__tests__/projection.test.ts` (ACs 1–8, 16; run before `toRealTerms` existed)

```
 × ... inflation-real-terms > AC1 — i = 0 is the identity
   → toRealTerms is not a function
 × ... inflation-real-terms > AC2 — deflator and exponents, P at i = 0.10
   → toRealTerms is not a function
 × ... inflation-real-terms > AC3 — the deflator uses the inflation rate, not the growth rate (i = 0.03)
   → toRealTerms is not a function
 × ... inflation-real-terms > AC4 — non-money fields pass through untouched
   → toRealTerms is not a function
 × ... inflation-real-terms > AC5 — purchasing power lost is a memo, not an outflow
   → toRealTerms is not a function
 × ... inflation-real-terms > AC6 — real totals are PV sums, not one deflated total
   → toRealTerms is not a function
 × ... inflation-real-terms > AC7 — contributions are nominal; the real view shows them shrinking
   → toRealTerms is not a function
 × ... inflation-real-terms > AC8 — the rate is validated, nothing is clamped
   → inflationRate=NaN: expected TypeError: ... to be an instance of ProjectionInputError
 ✓ ... inflation-real-terms > AC14 — F1: fee drag charged in every phase   (pre-existing engine, no change needed)
 × ... inflation-real-terms > AC16 — no NaN/Infinity in the real view
   → toRealTerms is not a function

 Tests  9 failed | 1 passed | 30 skipped (40)
```
`3PP-AC9` (AC15) run alone: `✓ 1 passed` — confirms the fix is a genuine test-only correctness pin
(F2), not tied to a production change (project() already resolved Coast correctly).

Each failure is a distinct assertion (a missing export or a wrong error type), never a suite-level
import/compile crash — Vite/esbuild transpiles the file without type-checking, so an unresolved
named import becomes `undefined` at the call site rather than failing the whole file (verified with
a throwaway import-of-nonexistent-export before writing any real test).

### GREEN — after implementing `toRealTerms`

```
lib/__tests__/projection.test.ts:      Tests  40 passed (40)
components/__tests__/projectionInputs.test.ts:  (below)
pnpm test (all 4 files):               Tests  119 passed (119)
```

### RED — `components/__tests__/projectionInputs.test.ts` (ACs 9–12; before mapper changes)

```
 × AC9 — parseInflationRate(form) > showRealTerms: false ...       → parseInflationRate is not a function
 × AC9 — ... "3" -> 0.03                                           → parseInflationRate is not a function
 × AC9 — ... "0" -> 0                                               → parseInflationRate is not a function
 × AC9 — ... "" -> required                                         → parseInflationRate is not a function
 × AC9 — ... "abc" -> field error                                   → parseInflationRate is not a function
 × AC9 — ... " " -> field error                                     → parseInflationRate is not a function
 × AC10 — toggle on with an invalid rate returns ok:false            → expected true to be false
 ✓ AC10 — toggle off with the same invalid rate returns ok:true      (already true — field unused pre-change)
 ✓ AC10 — 'inflationRate' never a key of the built ProjectionInput   (already true — no such field existed)
 × AC11 — runProjection returns one projection, two views            → expected undefined to be defined
 × AC12 — the engine error surfaces verbatim, naming inflationRate   → expected true to be false

 Tests  9 failed | 2 passed | 31 skipped (42)
```
The two AC10 sub-cases that passed before any change are vacuously true pre-feature (no such field
existed to be wrong yet) — the `ok:false` sub-case is the one that actually reds.

### GREEN — after mapper changes

```
components/__tests__/projectionInputs.test.ts:  Tests  42 passed (42)
```

## Before/after table (AC17)

Scenario: UI defaults — 100k initial, 15y term, $0 monthly, SCHD seed (9.12% price growth, 3.25%
yield), direct wrapper, 33% marginal, 15% US WHT, phase fields blank. Real column: toggle on, 3%.

| Metric | Nominal (toggle off) | Real (toggle on, 3%) | Why |
|---|---|---|---|
| Year-15 `finalValueNzd` | $382,720.887339 | $245,653.974057 | Every money field ÷ `(1.03)^15` (closing fields) |
| Year-15 `grossDividendsNzd` | $3,380.370795 | $2,169.731382 | Same deflator, flow field |
| `totalTaxNzd` | $51,208.228184 | $38,836.923309 | Sum of deflated per-year tax, not one end deflator on the nominal sum |
| `netGainNzd` | $282,720.887339 | $145,653.974057 | Same formula (finalValue − initial − contributions) on real parts |
| Year-15 purchasing power lost | n/a (nominal has no memo) | $137,066.913282 | `nominal.closingValueAfterTaxNzd(15) − real…(15)`, not a cash outflow |

Sanity check: `1.03^15 ≈ 1.557967`, so `1/1.557967 ≈ 0.641862` — real finalValue is **64.19%** of
nominal (`245,653.974057 / 382,720.887339 = 0.641862`), matching `1/1.03^15` exactly.

PRD headline: at 3% over 30 years, `1.03^30 ≈ 2.427262`, so a nominal figure **overstates**
purchasing power by **~2.43×** (real ≈ `1/2.427262 ≈ 41.20%` of the nominal number) — this is a
general property of the 3% deflator (computed here, not looked up), not specific to this scenario's
term (15y).

Confirmed the nominal column is unchanged from the pre-change commit: the UI-default scenario above
is exactly fixture #1 in the "Additive guarantee" 501-fixture `Object.is` diff against
`git show HEAD:lib/projection.ts` — 0 mismatches on every field, including every value in the
"Nominal" column of this table.

## Mutation testing

Per-mutation: edit `lib/projection.ts`, run
`pnpm vitest run lib/__tests__/projection.test.ts components/__tests__/projectionInputs.test.ts`
(default reporter — **not** `--reporter=basic`, which exits non-zero on Vitest 4 regardless of
result and would make every mutation look "killed"), read the actual pass/fail counts, revert by
hand (not `git checkout`, since the file has legitimate uncommitted feature work). Baseline: 82
passed, 0 failed.

| Mutation | Result |
|---|---|
| Closing-field exponent `t` → `t−1` | **Killed** — 5 failed, 77 passed (AC2, AC3, AC6, AC7, and one more) |
| `opening*` exponent `t−1` → `t` | **Killed** — 1 failed, 81 passed (AC2, chain check) |
| `cumulativeContributionsNzd` deflated wholesale (nominal total ÷ one deflator) instead of a running PV sum | **Killed** — 2 failed, 80 passed (AC2, AC6) |
| Memo added into `totalFeesNzd` | **Killed** — 2 failed, 80 passed (AC5, AC6) |
| `costBasisNzd` deflated | **Killed** — 1 failed, 81 passed (AC4) |
| Negative/percent-shaped rate check (`assertHalfOpenRate` call) dropped | **Killed** — 2 failed, 80 passed (AC8 in `lib`, AC12 in the mapper) |
| Fee skipped in a Draw year (`project()`'s own fee-deduction line, gated on `phase !== "draw"`) | **Killed** — 1 failed, 81 passed (AC14 — "totalFeesNzd 0 and closingShares 9,925" was the guardrail's own predicted signal; got `closingValueNzd` 110,000 vs expected 108,900, same root cause) |

7/7 mutations killed. File restored to the pure-append state after each — final
`git diff --stat lib/projection.ts` still shows `119 insertions(+), 0 deletions(-)`.
