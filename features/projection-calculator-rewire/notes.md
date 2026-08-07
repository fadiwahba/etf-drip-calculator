## What was built

- `components/projectionInputs.ts` (new) — React-free mapper: `parseNumericField` (discriminated
  parse result, never coerces to 0), `buildProjectionInput` (form strings → `ProjectionInput`,
  the only arithmetic is `/100` and the unit-share assignment, each commented), `parsePir`
  (internal), `seedAssumptionsFromFund` (fund decimal → percent, provenance, `ok:false` on a null
  assumption), `runProjection` (`buildProjectionInput` then `project()` in try/catch), and
  `formatEngineError`/`formatNzd` (never let `NaN`/`Infinity`/an uncaught throw reach the UI).
- `components/__tests__/projectionInputs.test.ts` (new) — 27 tests, one file, covering AC1–AC9
  plus AC14 (see "AC numbering" below for why AC14 is included).
- `components/InvestmentProjectionCalculator.tsx` — full rewrite. The `useMemo` loop and the
  `returnRate`/`dividendYield`/`expenseRatio`/`taxRate` state keys are gone. The component now
  holds a `ProjectionFormState` (all raw strings — no `parseFloat`/coercion in `onChange`),
  derives `fieldCheck = buildProjectionInput(form)` for inline per-field errors and
  `projection = runProjection(form)` for the engine result, and renders only what the ACs specify:
  no table/summary when either check fails, the new 9-column table (Year · Start Balance ·
  Contributions · Gross Dividends · US WHT · Fees · Regime · Taxable Income · NZ Tax · End
  Balance), 4 summary tiles from `ProjectionResult` fields only, and a persistent notice naming
  the three removed fields (AC15). Every displayed number goes through `formatNzd`.
- `wrapper`, `marginalRate`, `usWithholding`, `platformFee`, `brokerage`, `fxSpread` are new
  editable inputs (spec's table); `pir` only renders when `wrapper === "pie"`.
- `sharePriceGrowth`/`dividendYield` are seeded once from `getFund("SCHD")` via
  `seedAssumptionsFromFund` (9.12% / 3.25%, `asOf` 2026-06-30, source shown + linked under the
  growth field) and are then plain editable percent inputs — never re-derived, never a fund
  picker (out of scope this slice).

### AC numbering discrepancy — resolved, not a blocker

The spec's own AC-list header says "Each of 1–8 is a RED-first test... 9–15 are verified by
inspection", but AC9's body text ("`runProjection` wraps `project()` in try/catch... test: force
each") is unambiguously a test description, and the Coder Guardrails section explicitly says
"ACs 1–9 are still RED-first". I treated the guardrails' "1–9" as authoritative (it's also
internally consistent with AC9's own body) and tested AC9. I additionally tested AC14
(`formatNzd`) even though it falls in the header's "9–15 inspection" bucket, because it is a pure
function with explicit fixture values in its own AC text (`NaN`, `Infinity`, `-0`, `1234.5`) and
needed no DOM — testing it costs nothing and is strictly more coverage, not scope creep. AC10–13
and AC15 are rendering/inspection only, per the guardrail's TDD-relaxation for rendering (jsdom +
testing-library are banned new deps) — verified by reading the rendered JSX against each AC and by
`pnpm dev` (manual check: table absent on invalid input, regime cell shows "FIF · FDR · above
$50k" for year 1 on the default form, notice text present).

### Design decisions where the spec was open (not blockers, documented)

- **Percent-field range validation is deferred to the engine**, not duplicated in the mapper. The
  mapper only range-checks `termYears` (1–50, the spec's own explicit UI constraint) and
  non-negativity on money fields (capital, contribution, brokerage — structural, not tax/rate
  domain values). Every rate/percent field (growth, yield, PIR, marginal, WHT, platform fee, FX
  spread) is only checked for "is it a finite number" in the mapper; an out-of-domain value (e.g.
  sharePriceGrowth 150%) reaches `project()`/`computeAnnualTax`, which already validates every
  rate range, and `runProjection` surfaces that `ProjectionInputError`/`TaxInputError` verbatim
  (AC9). This is what makes AC9's "pir missing under PIE" and "sharePriceGrowth 150%" test cases
  possible without the mapper pre-empting the engine's own cross-field rule (Constitution §2 — one
  engine, no duplicated validation).
- **`formatEngineError`'s `MissingAssumptionError` case is tested directly**, not through a full
  `runProjection` round-trip. `project()` never calls `requirePriceGrowth` (only `projectFund`
  does, and the spec says use `project()`, not `projectFund()`), so there is no real code path by
  which `runProjection` can throw a `MissingAssumptionError` in this slice. Rather than
  contorting the test to fake that path, `formatEngineError` is exported and tested directly with
  a real `new MissingAssumptionError(...)` instance — the same formatting logic `runProjection`'s
  catch block calls, genuinely exercised, just not through the full `project()` call that can
  never produce this particular error today.
- **Inputs are `type="text" inputMode="decimal"|"numeric"`**, not `type="number"`. A native number
  input reports `""` for both an empty field and an unparseable one, which would hide
  `parseNumericField`'s distinct messages (invariant 14 — the validator, not the browser widget,
  must be authoritative). This is a behavioural choice, not a restyling one.
- **`"$50k"` in the Regime cell is display text**, not a re-derived tax figure — it names the
  engine's default `fifThresholdNzd`, which this UI never overrides (out of scope: "Overriding
  `fifThresholdNzd`").

No blocker was raised against `lib/`: every field `buildProjectionInput` needed
(`ProjectionInput`'s shape, `computeAnnualTax`'s optional `pir`, `Fund.sharePriceGrowth`/
`dividendYield`) was already there.

## How to verify

```
pnpm test         # 4 test files, 85 passed
pnpm lint          # No ESLint warnings or errors
pnpm build         # Compiled successfully, 7/7 static pages
pnpm exec tsc --noEmit   # exit 0, no output
```

Manual (`pnpm dev`, AC10–13/15, rendering-exempt from TDD): default form renders the table +
4 tiles with year-1 Regime `FIF · FDR · above $50k`; clearing "Initial Capital" shows "Initial
Capital (NZD) is required" under that field, the panel "Fix the highlighted inputs to see a
projection", and no table/tiles; setting Share price growth to `150` (a valid field per the
mapper) shows a red panel "Projection could not run:" with the verbatim `ProjectionInputError`
message, also no table/tiles.

## TDD

Per the precedent in `features/projection-engine/notes.md`, RED was captured against a stub that
**compiles and returns structurally valid but numerically wrong values** (never throws
"not implemented"), so every test's failure is a genuine per-assertion mismatch, not a
suite-level import error. All 27 tests were written before the real implementation and run once
in one pass (`--reporter=verbose`), which shows each test's own outcome and message individually —
the same mechanism `pnpm test -t "<name>"` gives, applied to the whole file at once rather than 27
separate invocations.

### RED

25 of 27 failed on genuine per-assertion mismatches. Representative excerpts (full transcript was
27 lines, one per test):

```
AC1a empty string returns ok:false naming the field
AssertionError: expected true to be false // Object.is equality
  (stub's parseNumericField always returns { ok: true, value: 0 })

AC3 — unit-share convention
AssertionError: expected +0 to be 100000 // Object.is equality
  (stub's buildProjectionInput hardcodes initialShares: 0)

AC6 — wrapper 'pie' yields pir as a decimal and keeps marginalRate present
AssertionError: expected 'direct' to be 'pie' // Object.is equality
  (stub ignores form.wrapper, always returns "direct")

AC7 — seedAssumptionsFromFund(getFund('SCHD')) returns growth 9.12...
AssertionError: expected +0 to be close to 9.12, received difference is 9.12, but expected 5e-7
  (stub's seedAssumptionsFromFund always returns 0/0)

AC8 — seedAssumptionsFromFund(getFund('VYMI')) is unavailable...
AssertionError: expected true to be false // Object.is equality
  (stub never checks fund.sharePriceGrowth === null, always ok:true)

AC9 — a ProjectionInputError from project() (sharePriceGrowth 150%) is caught and returned
AssertionError: expected true to be false // Object.is equality
  (stub's runProjection has no try/catch, and ignores form entirely — always calls project()
   with a hardcoded, valid, all-zero input)

AC9 — formatEngineError surfaces a MissingAssumptionError verbatim
AssertionError: expected '' to be 'MissingAssumptionError: SCHD: sharePr…'
  (stub's formatEngineError always returns "")

AC14 — formatNzd returns em dash for NaN
AssertionError: expected 'NaN' to be '—' // Object.is equality
  (stub's formatNzd is String(value))
```

**AC5 is the one exception, flagged honestly rather than hidden** (mirroring `projection-engine`'s
AC19 note): the stub's hardcoded `growthBasis: "net-of-expense-ratio"` / `expenseRatioAnnual: 0`
happen to already match what AC5 expects on every form state, since those two fields are
spec-fixed constants with no input path to vary them. AC5's 2 tests passed trivially against the
stub — there was nothing wrong for them to catch, because the stub's hardcoded values and the
correct values are the same constant. They continue to pass against the real implementation, and
`buildProjectionInput`'s source shows `growthBasis`/`expenseRatioAnnual` are never read from
`form`, only hardcoded — the only way this invariant could break is deleting those two lines.

Full run: **25 failed, 2 passed (27)** — no suite-level import/type error; every failure line
above names its own test and its own wrong-value assertion.

### GREEN

```
$ npx vitest run components/__tests__/projectionInputs.test.ts --reporter=verbose

 ✓ AC1a empty string returns ok:false naming the field
 ✓ AC1b whitespace-only string returns ok:false naming the field
 ✓ AC1c non-numeric string returns ok:false naming the field
 ✓ AC1d a negative value on a non-negative field returns ok:false
 ✓ AC1e 1e999 (parses to Infinity) returns ok:false
 ✓ AC1f a non-integer term returns ok:false
 ✓ AC1g a value outside the field's stated range returns ok:false
 ✓ AC1h a valid value returns ok:true with the parsed number
 ✓ AC2 — converts every percent field by /100 exactly once, no double division
 ✓ AC3 — unit-share convention
 ✓ AC4 — cadence is not multiplied
 ✓ AC5 — growthBasis/expenseRatioAnnual fixed (default form)
 ✓ AC5 — growthBasis/expenseRatioAnnual fixed (wrapper/pir overrides)
 ✓ AC6 — wrapper 'pie' yields pir as a decimal, marginalRate present
 ✓ AC6 — wrapper 'direct' yields pir undefined, never 0
 ✓ AC7 — seedAssumptionsFromFund(SCHD): growth 9.12, yield 3.25, asOf, source
 ✓ AC8 — seedAssumptionsFromFund(VYMI) unavailable
 ✓ AC8 — seedAssumptionsFromFund(FDVV) unavailable
 ✓ AC8 — runProjection on blank growth field: ok:false, no project() call
 ✓ AC9 — ProjectionInputError (sharePriceGrowth 150%) caught verbatim
 ✓ AC9 — TaxInputError (pir missing under PIE) caught verbatim
 ✓ AC9 — formatEngineError surfaces MissingAssumptionError verbatim
 ✓ AC9 — valid form runs project() successfully (sanity)
 ✓ AC14 — formatNzd: NaN → —
 ✓ AC14 — formatNzd: Infinity → —
 ✓ AC14 — formatNzd: -0 → $0
 ✓ AC14 — formatNzd: 1234.5 → $1,235

 Test Files  1 passed (1)
      Tests  27 passed (27)

$ pnpm test
 Test Files  4 passed (4)
      Tests  85 passed (85)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
 ✓ Compiled successfully
 ✓ Generating static pages (7/7)

$ pnpm exec tsc --noEmit
(no output, exit 0)
```

## Before/after comparison

Default scenario: 100k initial, 15 years, no contributions, SCHD-seeded 9.12% price growth /
3.25% yield, 0% dividend growth, 0% fees/brokerage/FX. "Old" figures are the exact output of the
**pre-rewrite** `InvestmentProjectionCalculator.tsx` loop (`returnRate 18`, `dividendYield 0.95`,
`expenseRatio 0.26`, `taxRate 1.4`), captured by re-running that loop in a scratch Node script
before it was deleted (not committed). "New" figures are `runProjection`'s real output for the
same scenario, direct-wrapper/33%-marginal and PIE/28%-PIR variants.

| Scenario | Metric | Old | New | Why |
|---|---|---|---|---|
| Default (direct, 33%) | Year-1 dividends | $950.00 | $3,250.00 | Old used an arbitrary 0.95% yield input added on top of an 18% "total return" (double-counting, invariant 5). New: 100,000 shares × 3.25% SCHD dividend-per-share (`initialDividendPerShareNzd`), sourced separately from the 9.12% price-only growth (Constitution §6). |
| Default (direct, 33%) | Year-1 tax | $13.30 | $1,162.50 (`nzTaxPayableNzd`; $1,650.00 `totalTaxNzd` incl. US WHT) | Old applied the 1.4% FDR-*drag* (a % of *portfolio value*, correct only as `5% FDR × 28% PIR`) directly to *dividends* — wrong base by ~100× (invariant 11, audit finding 1). New: FIF applies (cost $100k > $50k de minimis), FDR deemed income = 5% × opening value $100,000 = $5,000, taxed at 33% marginal = $1,650 gross tax, minus the US WHT credit (min($3,250×15%=$487.50, $1,650)) = $1,162.50 net NZ liability. |
| Default (direct, 33%) | Year-15 final value | $1,332,681.39 | $382,720.89 | Old compounded an 18% return *plus* a 0.95% yield on top every year (double-counting), while only deducting ~100×-understated tax and a non-compounding 0.26% expense charge — three errors that all inflated growth. New compounds a realistic 9.12% price-only CAGR with correctly-modelled, correctly-based FIF tax and (zero, per this scenario) fees. |
| + `wrapper: "pie"`, `pir: 28` | Year-1 dividends | $950.00 (old model has no wrapper concept — unaffected) | $3,250.00 | Same dividend-per-share convention; unaffected by wrapper (the PIR only changes the *rate* applied to the deemed income, not the dividend itself). |
| + `wrapper: "pie"`, `pir: 28` | Year-1 tax | $13.30 (old model ignores wrapper/PIR entirely) | $912.50 (`nzTaxPayableNzd`; $1,400.00 `totalTaxNzd`) | Old never modelled a wrapper — one more of the "four contradictory tax models" the audit found. New: same $5,000 FDR income, taxed at the PIR-capped 28% = $1,400 gross, minus the same $487.50 WHT credit = $912.50 — the PIE wrapper is cheaper than direct at the same income, exactly as `.claude/rules/nz-tax.md` describes. |
| + `wrapper: "pie"`, `pir: 28` | Year-15 final value | $1,332,681.39 (unaffected, old model ignores wrapper) | $396,056.92 | Same growth model as the direct scenario; higher than the direct-wrapper new figure only because of the lower PIE-capped tax rate each year. |

All new-model figures were read directly from `runProjection`'s `ProjectionRow`/`ProjectionResult`
fields in a scratch Vitest file (not committed) — not hand-estimated. Hand-check on year 1 (direct):
FDR income `0.05 × 100,000 = 5,000`; CV `= closingValue + dividends − (openingValue + purchases)`,
which with 0 contributions and price growth landing the DRIP purchase in the same year is far
above 5,000, so `method: "fdr"` is used (matches `lib/projection.ts` AC11-style behaviour); gross
tax `5,000 × 0.33 = 1,650`; WHT paid `3,250 × 0.15 = 487.50`; credit `min(487.50, 1650) = 487.50`;
net `1650 − 487.50 = 1,162.50`. All match the printed output exactly.
