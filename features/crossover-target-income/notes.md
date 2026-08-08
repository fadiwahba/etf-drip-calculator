# crossover-target-income — notes

## What was built

- **`lib/projection.ts`** — pure append (79 insertions, 0 deletions; `git diff --stat` below).
  `IncomeCrossover` interface + `findIncomeCrossover(real, targetAnnualIncomeNzd)`. Reads an
  already-deflated `RealProjectionResult`, computes `net(t) = grossDividendsNzd - totalTaxNzd` per
  row (C2), scans years 1..N regardless of phase (C4), and reports the **sustained** crossover year
  (C5) plus `firstYearAboveTarget` for comparison. `project()`, `projectFund()`, `toRealTerms()`,
  `validateInput`, `resolvePhase`, `buildYearZeroRow` and the five pre-existing interfaces are
  byte-identical — confirmed by `git diff`.
- **`components/projectionInputs.ts`** — `targetAnnualIncome: string` added to `ProjectionFormState`;
  new export `parseTargetIncome(form)` (blank ⇒ `undefined`, `"0"` ⇒ `0`, invalid ⇒ a field error);
  `buildProjectionInput` validates the field but never puts `targetAnnualIncomeNzd` in the returned
  `ProjectionInput` (same reasoning as `inflationRate`); `runProjection` gained a `crossover` field,
  computed by calling `findIncomeCrossover(real, target)` **once**, off the `real` result already
  computed for the toggle — no second `project()`/`toRealTerms()` call, and `crossover` is only ever
  populated when `real` is (C3).
- **`components/InvestmentProjectionCalculator.tsx`** — a "Target annual income (NZD, today's
  dollars)" field defaulting to `"80000"` (stated as a placeholder); a "Dividend Income Crossover"
  tile ("Year N" / "Not reached within N years", a sub-line with `incomeAtCrossoverNzd` or
  `finalYearNetIncomeNzd`, the "first reached but not sustained" note only when the two years
  differ, and the toggle-off / blank-target messages); a "Net dividend income" column, last, shown
  only when `crossover` is defined. No restyling — every new element reuses existing className
  patterns already in the file (e.g. `formatRegimeCell`'s pattern for the new
  `formatCrossoverHeadline` helper).

## Blocker: AC4 fixture arithmetic (upheld pattern from prior slices — spec was wrong, not the code)

AC4 states Fixture T's `netIncomeByYearNzd` at `i = 0` is
`[0, 3850, 4383.225, 4990.1284125, 5681.26119763125, 6468.115873503178]`.

Running the actual, **unmodified** `project(T)` → `toRealTerms(..., 0)` (identity per
inflation-real-terms AC1) gives years 1-2 matching exactly, but years 3-5 differ:

| year | spec's AC4 value | actual engine output |
|---|---|---|
| 1 | 3850 | 3850 ✓ |
| 2 | 4383.225 | 4383.225 ✓ |
| 3 | 4990.1284125 | **4990.3016625** |
| 4 | 5681.26119763125 | **5681.45844275625** |
| 5 | 6468.115873503178 | **6468.34043707799** |

The spec's own closed form for the same fixture — `net(t) = 0.0385 × openingValue(t)`,
`openingValue(t) = 100_000 × 1.1385^(t-1)` — computes to the **engine's** numbers, not to the
spec's own array: `0.0385 × 100_000 × 1.1385^2 = 4990.3016625`, not `4990.1284125`. Derivation
check (shares grow at a constant 3.5%/yr under FDR/33%/15% WHT since yield is constant at 5%):
`net(t) = 3500 × 1.035^(t-1) × 1.1^t`, which reduces to `3500 × 1.035^(t-1)` after the `i = 0.10`
deflator — and that **does** match the spec's `i = 0.10` array exactly
(`[0, 3500, 3622.5, 3749.2875, 3880.5125625, 4016.3305021875]`), confirming the formula and the
engine agree with each other and with the spec everywhere except the three `i = 0` entries above.

Per the Coder Guardrails ("never bend a fixture to fit your implementation"), AC4's test uses the
**engine-verified** values, not the spec's typo'd array — `lib/projection.ts` was not touched to
produce these, they come straight out of the pre-existing, already-tested `project()`/`toRealTerms()`.
No other AC depends on the affected T-fixture-year-3+/i=0 values (AC5/AC9 use `i = 0.10`; the `i = 0`
`target 5000` check in AC5 only needs years 1/4/5, which are correct at the precision used).

## How to verify

```bash
pnpm test          # 145 passed / 0 failed
pnpm lint           # zero warnings
pnpm exec tsc --noEmit   # exit 0
pnpm build          # succeeds
```

Manual: `pnpm dev` → Portfolio Projection Calculator → toggle "Show in today's dollars" on, set
"Target annual income" to e.g. 3800 with the fixture-T-shaped inputs → "Dividend Income Crossover"
tile shows a year and net-income sub-line; toggle off → tile says to turn today's-dollars on;
blank the target → tile asks for a target; the "Net dividend income" table column appears only
when a target and the real toggle are both set.

## TDD

RED-first for `lib/` (ACs 1-12, `describe("crossover-target-income")`) and the mapper (ACs 13-16,
`describe("crossover-target-income mapper")`), each run alone via
`npx vitest run <file> -t "<name>"`. AC17 (UI) is exempt per the dispatch — jsdom/testing-library
are banned new deps; every number the UI shows is read straight from `findIncomeCrossover`/
`runProjection`, which are fully covered above.

**AC1 does not RED** — it invokes no new code (it only pins `project(T)`/`toRealTerms(T, 0.1)`,
already-existing, unmodified functions, on a fixture new to this test file). It is a regression
guarantee for the additive claim, not a feature test, and is disclosed here per "each is one RED
test" rather than silently treated as satisfied.

### RED (lib/, ACs 2-12 — `findIncomeCrossover is not a function` before implementation)

```
AC2 — TypeError: findIncomeCrossover is not a function
AC3 — TypeError: findIncomeCrossover is not a function
AC4 — TypeError: findIncomeCrossover is not a function
AC5 — TypeError: findIncomeCrossover is not a function
AC6 — TypeError: findIncomeCrossover is not a function
AC7 — TypeError: findIncomeCrossover is not a function
AC8 — TypeError: findIncomeCrossover is not a function
AC9 — TypeError: findIncomeCrossover is not a function
AC10 — TypeError: findIncomeCrossover is not a function
AC12 — TypeError: findIncomeCrossover is not a function
AC11 — AssertionError: target=NaN: expected TypeError: (0 , __vite_ssr_import_1__.fin… to be an
        instance of ProjectionInputError
```
Each ran alone (`Tests 1 failed | N passed | M skipped`) — a genuine assertion/TypeError from
missing implementation, never a suite-level import failure (the other pre-existing tests in the
same run stayed green).

### RED (mapper, ACs 13-16 — `parseTargetIncome is not a function` / absent `crossover` field)

```
AC13 "" / "   " / "0" / "80000" / "abc" / "-1" — TypeError: parseTargetIncome is not a function
AC14 targetAnnualIncome "abc" -> ok:false naming targetAnnualIncome
  AssertionError: expected true to be false (buildProjectionInput had no target validation yet)
AC15 toggle on, target '3800' -> crossover defined
  AssertionError: expected undefined to be defined (RunProjectionResult had no `crossover` field)
```
AC15's "toggle off" / "target blank" cases and AC16 passed vacuously before implementation (the
absent `crossover` field reads as `undefined`, which is exactly what those two cases assert) —
same "reproduces old behaviour" exception as AC1 above, disclosed rather than treated as silent
RED-first compliance.

### GREEN

```
$ pnpm test
 Test Files  4 passed (4)
      Tests  145 passed (145)
```
(52 crossover-target-income lib tests incl. AC6b hardening below, 12 mapper tests, plus all 81
pre-existing lib/mapper tests unchanged.)

### Before/after table (mandatory)

`1.03^30 ≈ 2.4273` — a nominal income figure overstates purchasing power ~2.43× over 30 years. The
number Fady acts on is the **difference in years/answer**, not the raw dollar figure.

| Scenario | Target | Crossover (real, today's $) | Crossover (nominal) | Δ | Why |
|---|---|---|---|---|---|
| Fixture T, `i=0.10` | 3,800 | **Year 4** ($3,880.51) | **Year 1** ($3,850, nominal misread) | 3 years too optimistic | The nominal year-1 figure clears 3,800 by coincidence of scale; deflating to today's dollars shows the real purchasing power only clears it in year 4 — comparing a real target to a nominal series is the AC5 wrong-number failure mode. |
| Fixture T, `i=0.10` | 5,000 | **Never** (final year $4,016.33) | **Year 4** ($5,681.46 nominal) | Never vs. year 4 | The nominal series eventually outgrows 5,000 through pure inflation-driven dollar growth; the real series never does — the target is unreachable in today's-dollars terms within the 5-year horizon. |
| UI-default (100k/15y/0 monthly/SCHD seed 9.12%/3.25%, direct 33%, WHT 15%, phase fields blank, inflation 3%) | 80,000 | **Never** (final year **-$1,568.51**) | **Never** (final year **-$2,443.69**) | Both never — but the *sign* is the finding | The UI's own default `dividendGrowthPercent = "0"` (stated as an unsourced assumption) against SCHD's seeded 9.12% price growth means dividend yield collapses relative to portfolio value; FDR tax (5% of an ever-growing value, at 33%) overtakes the flat dividend stream — nominal net income turns negative at year 9, real earlier. The $80k target isn't "reached late," it's structurally unreachable under these assumptions, which only the real-vs-nominal crossover check surfaces. |

### Mutation testing

`vitest --reporter=basic` was **not** used (Vitest 4 exits non-zero regardless of result with that
flag) — every run below used the default reporter, with `git diff --stat lib/projection.ts`
confirming a clean restore to the append-only baseline between mutations.

| # | Mutation | Result |
|---|---|---|
| 1 | Drop the WHT term (`net = gross - nzTaxPayableNzd` only) | **Killed** — 8/52 failed |
| 2 | Drop the `nzTaxPayableNzd` term (`net = gross - usWithholdingNzd` only) | **Killed** — 8/52 failed |
| 3 | Subtract `totalFeesNzd` too | **Killed** — 1/52 failed |
| 4 | Use `dividendsDrawnNzd` instead of `grossDividendsNzd` | **Killed** — 9/52 failed |
| 5 | `crossoverYear = firstYearAboveTarget` (drop the "sustained" scan) | **Killed** — 1/52 failed |
| 6 | `≥` → `>` (sustained check `<` → `<=`) | **Survived** against AC6 alone (spec's literal `3,749.2875` isn't bit-identical to the engine's float64 `4990...`-class output — see AC6b below), **killed** once AC6b (added) reads the target straight from the row's own computed value: 1/53 failed |
| 7 | Scan starts at year 0 instead of year 1 | **Killed** — 1/52 failed |
| 8 | "Scan `rows` instead of the real rows" | **Not applicable** — `findIncomeCrossover`'s signature requires `RealProjectionResult` (structurally distinct from plain `ProjectionResult`: extra `inflationRate`/`purchasingPowerLostNzd` fields); TypeScript rejects passing a nominal result at compile time, so this defect class can't reach runtime to mutate into. |
| 9 | Return `0` instead of `null` (`crossoverYear` default) | **Killed** — 2/52 failed |
| 10 | Drop target validation (`assertFiniteNonNegative` call) | **Killed** — 1/52 failed |

9/9 applicable mutations killed; #8 is prevented by the type system rather than a runtime check,
which is a stronger guarantee than a test could give.

Added **AC6b** (`lib/__tests__/projection.test.ts`) beyond the spec's numbered ACs: reads the
target straight from `real10.rows[3].grossDividendsNzd - real10.rows[3].totalTaxNzd` rather than
the literal `3,749.2875`, to genuinely pin `>=` at the bit-exact float64 boundary after mutation
#6 revealed the literal-value boundary in AC6 doesn't reliably distinguish the operator.
