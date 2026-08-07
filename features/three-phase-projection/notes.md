# three-phase-projection — notes

## Cycle 2 — both blockers upheld, spec corrected, fixtures updated, all green

Both blockers I raised in Cycle 1 were confirmed correct by the spec owner and the spec was fixed
(not the code):

- **Blocker 1** (Coast default): confirmed. `drawdownStartYear` defaults to `contributionsStopYear`
  per the phase formula, so `contributionsStopYear` alone always resolves to `"draw"`, never
  `"coast"`. AC3 was missing an explicit `drawdownStartYear`. The spec now sets
  `drawdownStartYear: 4` on AC3 (and AC5, which reuses AC3's coast run) and adds an explicit callout
  in the phase-formula section: "Coast is EMPTY by default."
- **Blocker 2** (AC4's `closingShares`): confirmed. `1,147.185` was the pre-tax year-2 share count
  copy-pasted from year 1; it ignores that the tax settlement (`shares -= nzTaxPayableNzd /
  closingPrice`) runs identically in every phase, including Draw. The correct value,
  `1,129.977225`, reproduces the spec's own `closingValueAfterTaxNzd 13,672.7244225` exactly
  (`1,129.977225 × 12.1`). The spec now states `1,129.977225` and explains the derivation inline.

`lib/projection.ts` needed **no change** — only `3PP-AC3`, `3PP-AC4`, `3PP-AC5` in
`lib/__tests__/projection.test.ts` were edited, per the guardrail: `drawdownStartYear: 4` added to
AC3's (and AC5's) coast run, and AC4 gained an explicit year-1 `phase` assertion plus the corrected
`closingShares: 1_129.977225` and a `closingValueNzd` assertion. `pnpm test` is now fully green
(98/98). See "Mutation testing — Cycle 2" below for the required kill confirmations on the three
changed lines.

## What was built

- `lib/projection.ts`: two new optional `ProjectionInput` fields (`contributionsStopYear`,
  `drawdownStartYear`), a single private `resolvePhase(input, year)` helper (Constitution §2 — the
  only place the phase decision is made, applied to year 0 and every loop year), new
  `ProjectionRow.phase` / `ProjectionRow.dividendsDrawnNzd` / `ProjectionResult.totalDividendsDrawnNzd`
  fields, `assertNonNegativeInteger` + cross-field validation in `validateInput`. The contribution
  loop is gated on `phase === "accumulate"`; a Draw year skips the DRIP (`dividendsReinvested = 0`,
  `dividendsDrawn = grossDividends - usWithholding`) instead. Price growth, fees, the
  `computeAnnualTax` call/arguments and the tax settlement (`shares -= nzTaxPayableNzd/closingPrice`)
  are untouched code paths, run identically in all three phases.
- `components/projectionInputs.ts`: `ProjectionFormState.contributionsStopYear` /
  `.drawdownStartYear` (strings, default `""`), `parseOptionalPhaseYearField` (blank → `undefined`,
  bounded 0-50 integer like `termYears`), wired into `buildProjectionInput`; `formatPhase` (the only
  place a phase becomes a label — no formatting logic in the `.tsx`).
- `components/InvestmentProjectionCalculator.tsx`: two new inputs ("Stop contributing from year
  (blank = never)", "Start drawing dividends from year (blank = same as stop year)") with
  `FieldError`, both defaulting to `""`; a **Phase** column after Year and an **Income Drawn**
  column after US WHT in the table; a **Total Income Drawn** summary tile beside Net Gain plus a
  one-line note that Net Gain excludes drawn cash. No new arithmetic in this file — every value
  comes from `runProjection`/`formatNzd`/`formatPhase`.

## Blockers — resolved in Cycle 2

Both Cycle-1 blockers (AC3's missing `drawdownStartYear` making Coast unreachable; AC4's
pre-tax `closingShares: 1,147.185` contradicting its own post-tax `closingValueAfterTaxNzd`) were
upheld by the spec owner. The spec was corrected in place (AC3/AC5 gained `drawdownStartYear: 4`,
AC4's `closingShares` became `1,129.977225`); `lib/projection.ts` was never wrong and needed no
change. See "Cycle 2" above for the full resolution and the corrected numbers.

## How to verify

```bash
pnpm test          # 98 passed / 0 failed
pnpm lint           # zero warnings
pnpm exec tsc --noEmit   # exit 0
pnpm build          # succeeds
```

Manual: `pnpm dev` → Portfolio Projection Calculator → set "Stop contributing from year" and
"Start drawing dividends from year" → Phase and Income Drawn columns update, Total Income Drawn
tile appears beside Net Gain.

## TDD

RED-first for `lib/` (ACs 1-9) and the mapper (ACs 10-13); each test was appended, run alone via
`pnpm exec vitest run -t "<name>"`, and observed failing on a genuine assertion mismatch (never a
suite-level import/type error — confirmed empirically that Vitest's esbuild transform does not
type-check, so referencing a field/export that doesn't exist yet fails only that test, not the
file). UI wiring (AC14) is exempt per the dispatch (jsdom/testing-library are banned new deps).

### RED (lib/, one excerpt per AC — full per-AC runs captured individually)

```
3PP-AC1 — omitting both fields reproduces today's output exactly
AssertionError: expected undefined to be 'accumulate'
  at row.phase check — field did not exist yet.

3PP-AC2 — a value beyond the term is accepted and inert
AssertionError: expected undefined to be 'accumulate'
  (added an explicit phase assertion ahead of the toEqual — the bare toEqual alone passed
  vacuously pre-implementation since both sides lacked the field identically; see notes below.)

3PP-AC3 — Coast stops contributions but keeps the DRIP
AssertionError: expected undefined to be 'accumulate'

3PP-AC4 — Draw pays the dividend out; principal is untouched
AssertionError: expected undefined to be 'draw'

3PP-AC5 — drawing does not change the tax below the de minimis
AssertionError: expected 685.9517500000001 to be close to 630.95175
  (pre-implementation, contributions were never gated, so grossDividends included an extra
  reinvested-share dividend contribution — genuinely wrong for the right reason.)

3PP-AC6 — drawing does not change the tax under FIF/FDR
AssertionError: expected undefined to be close to 4675, received difference is NaN

3PP-AC7 — contributionsStopYear 0 is the decumulator, not unset
AssertionError: expected undefined to be 'draw'

3PP-AC8 — invalid phase input throws, nothing is clamped or coerced
AssertionError: {"contributionsStopYear":2.5}  — expected a throw, none happened (no validation yet)

3PP-AC9 — no NaN/Infinity escapes the new paths
PASSED even pre-implementation — documented limitation of the file's own `assertAllFinite`
helper (its own comment: "does NOT catch a missing field... TypeScript strict is what guards that
case"). Pre-implementation the new fields are simply absent (not NaN), so this check is vacuous
until the fields exist; it becomes a real regression guard once they do (confirmed below via
mutation — no mutation available here since there's nothing to break in a field that's always 0/
enumerable once correct).
```

### Cycle 2 — RED/GREEN on the corrected AC3/AC4/AC5 fixtures

Both blockers were upheld and the spec's own fixtures were corrected (not the code), so AC3/AC4/AC5
did not need a fresh RED cycle against the implementation — `lib/projection.ts` already computed
the corrected values (that was the point of the blocker: the spec was wrong, the code wasn't).
What changed was the *test* fixtures, so the relevant RED/GREEN pair is against the test file edit
itself: before the edit, the old fixtures failed for the reasons in "Blockers" above (Cycle 1's
transcript is preserved below unmodified); after the edit, the corrected fixtures pass without any
change to `lib/projection.ts`, confirming the code was right all along.

```
$ pnpm exec vitest run lib/__tests__/projection.test.ts
 Test Files  1 passed (1)
      Tests  30 passed (30)
```

All 21 pre-existing ACs, all 9 3PP-AC lib tests including the corrected AC3/AC4/AC5, pass.

### GREEN (lib/, Cycle 1 — historical, kept for the record)

```
$ pnpm exec vitest run lib/__tests__/projection.test.ts
 ❯ lib/__tests__/projection.test.ts (30 tests | 3 failed) 24ms
     × 3PP-AC3 — Coast stops contributions but keeps the DRIP     (Blocker 1)
     × 3PP-AC4 — Draw pays the dividend out; principal is untouched  (Blocker 2, closingShares only)
     × 3PP-AC5 — drawing does not change the tax below the de minimis (Blocker 1, via AC3's fixture)
 Test Files  1 failed | 27 passed
      Tests  3 failed | 27 passed (30)
```
All 21 pre-existing ACs (unchanged, unedited) plus 3PP-AC1/2/6/7/8/9 (6 of 9 new ACs) pass.

### RED (mapper, ACs 10-13)

```
3PP-AC10 — blank means absent, '0' means zero
AssertionError: expected undefined to be +0
  (the "0" case: unimplemented mapper silently dropped the field entirely)

3PP-AC11 — phase fields validate without coercion
AssertionError: contributionsStopYear="abc" should be rejected: expected true to be false
  (unimplemented mapper never examined the field, so an invalid string built ok:true)

3PP-AC12 — the cross-field error surfaces verbatim
AssertionError: expected true to be false
  (unimplemented mapper never passed the fields to project(), so no cross-field error ever fired)

3PP-AC13 — formatPhase labels the three phases
TypeError: formatPhase is not a function
  (export did not exist yet — this specific test failed individually; the other 3 files/85 other
  tests in the run were unaffected, confirmed empirically before relying on this pattern)
```

### GREEN (mapper, full run)

```
$ pnpm exec vitest run components/__tests__/projectionInputs.test.ts
 Test Files  1 passed (1)
      Tests  31 passed (31)
```

## Mutation testing (required before finishing)

Applied to a scratch copy, confirmed the target test died, then restored the file exactly
(`diff` against the pre-mutation copy was empty after each restore):

| # | Mutation | Killed by | Result |
|---|---|---|---|
| 1 | `??` → `\|\|` for both `stop`/`draw` in `resolvePhase` | 3PP-AC7 | `expected 'accumulate' to be 'draw'` — died |
| 2 | `y < stop` → `y <= stop` in `resolvePhase` | 3PP-AC6 | `expected +0 to be close to 4675` — died |
| 3 | Always reinvest (drop the `isDraw ? 0 :` branch) | 3PP-AC6, 3PP-AC7 | both died (`closingValueNzd 114675 ≠ 110000` etc.) |
| 4 | Run the contribution loop unconditionally (`if (true)`) | 3PP-AC7 | `expected 2000 to be +0` — died |
| 5 | Drop the `drawdownStartYear < contributionsStopYear` throw | 3PP-AC8 | `expected undefined to be instanceof ProjectionInputError` — died |
| 6 | Drop the `Number.isInteger` check in `assertNonNegativeInteger` | 3PP-AC8 | `2.5` case no longer threw — died |
| 7 | Mapper: blank → `0` instead of `undefined` in `parseOptionalPhaseYearField` | 3PP-AC10 | `expected +0 to be undefined` — died |
| 8 | Mapper: `formatPhase` returns the raw string unchanged | 3PP-AC13 | `expected 'accumulate' to be 'Accumulate'` — died |

All 8 targeted mutations were caught. `lib/projection.ts` and `components/projectionInputs.ts`
were byte-identical to the pre-mutation copies after each restore (verified via `diff`).

### Mutation testing — Cycle 2 (the three corrected fixtures)

Required by the fix-cycle dispatch: mutate the phase-selection logic and confirm AC3, AC4 and AC5
each actually fail on the corrected fixtures — proving they discriminate rather than passing
vacuously. Applied to a scratch copy of `lib/projection.ts`, ran the single named test, then
restored (`diff` against the pre-mutation backup was empty after each restore):

| # | Mutation | Target | Killed by | Result |
|---|---|---|---|---|
| 1 | `y < draw` → `y <= draw` in `resolvePhase` | AC4 | 3PP-AC4 | `expected 'coast' to be 'draw'` — died |
| 2 | `isDraw = phase === "draw"` → `isDraw = phase !== "accumulate"` (drops the DRIP in Coast too) | AC3 | 3PP-AC3 | `expected +0 to be close to 630.95175` — died |
| 3 | Drop `shares -= tax.nzTaxPayableNzd / closingPrice` (the tax settlement) | AC4's `closingShares` | 3PP-AC4 | `expected 641.025... to be close to 630.95175` (grossDividendsNzd assertion fails first, since the settlement is shared across every year/phase — the mutation removes the line the AC's `closingShares` figure depends on) — died |

All three mutations were caught by their target test. `lib/projection.ts` was byte-identical to the
pre-mutation backup after each restore (verified via `diff`).

## Before/after table (spec.md AC15)

Scenario = UI defaults: 100k initial, 15y term, $0/month, SCHD seed (9.12% growth / 3.25% yield),
direct wrapper, 33% marginal, 15% WHT. **Before** = both new fields blank, captured on the
pre-change commit `00c7a52` via `git worktree add` + a scratch vitest test (not committed, deleted
after use) — not estimated. **After (blank)** = the new build with both fields still blank —
confirmed numerically identical to Before, i.e. the purely-additive contract holds on this
real-world scenario, not just the golden fixture. **After (set)** =
`contributionsStopYear: 0, drawdownStartYear: 10`.

| Scenario | Metric | Before (commit `00c7a52`) | After (blank — identical) | After (stop=0, draw=10) | Why |
|---|---|---|---|---|---|
| Default | year-1 `nzTaxPayableNzd` | 1,162.5 | 1,162.5 | 1,162.5 | FDR taxes *opening* value (100k either way) — contribution/phase status never enters year 1's tax |
| Default | year-10 `phase` | *(field doesn't exist)* | `accumulate` | `draw` | stop=0 ⇒ no year ever contributes; year 10 ≥ draw(10) ⇒ Draw |
| Default | year-10 `dividendsDrawnNzd` | *(field doesn't exist)* | 0 | 2,926.0622161231213 | Accumulate/Coast never draw cash; year 10 is the first Draw year |
| Default | year-15 `finalValueNzd` | 382,720.88733874005 | 382,720.88733874005 | 361,593.6905442671 | Never contributing + paying dividends out from year 10 instead of reinvesting compounds to a smaller portfolio, as expected |
| Default | `totalDividendsDrawnNzd` | *(field doesn't exist)* | 0 | 16,983.048694691126 | Sum of years 10-15's drawn cash — real cash paid out, not part of `finalValueNzd`/`netGainNzd` |

Blank-vs-Before identity is explicit above (year-1 tax and final value match to every printed
digit) — the purely-additive contract holds for this scenario, not just the AC1 golden fixture.

## Files touched

- `lib/projection.ts`
- `lib/__tests__/projection.test.ts` (append-only — no existing assertion edited)
- `components/projectionInputs.ts`
- `components/__tests__/projectionInputs.test.ts` (append-only, plus the shared `makeForm()`
  helper's default object gained the two new blank-default fields — not an assertion)
- `components/InvestmentProjectionCalculator.tsx`
- `features/three-phase-projection/notes.md` (this file)

No other files touched. `lib/nzTax.ts`, `lib/funds.ts`, `data/*`, `vitest.config.mts`,
`package.json` untouched; no new dependency.
