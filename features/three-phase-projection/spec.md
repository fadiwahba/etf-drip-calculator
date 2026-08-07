# three-phase-projection

## Scope

Extend the **closed** engine `lib/projection.ts` with two **optional** inputs,
`contributionsStopYear?: number` and `drawdownStartYear?: number`, so every year runs in one of
three phases, and wire both inputs plus a per-year **Phase** and **Income Drawn** column into
`components/InvestmentProjectionCalculator.tsx`. One model with a parameter — not a second
calculator (PRD "Two scenarios, one model").

**Phase function** — one private helper, applied to every row including year 0:

```
stop = contributionsStopYear ?? Infinity     // ?? never ||  — 0 is a meaningful value
draw = drawdownStartYear     ?? stop
phaseOf(y) = y < stop ? "accumulate" : y < draw ? "coast" : "draw"
```

**Boundaries are exclusive of the old behaviour: each field names the FIRST year of the new
behaviour.** `contributionsStopYear: 5` → years 1–4 contribute, year 5 does **not**.
`drawdownStartYear: 5` → year 5 is the first year dividends are paid out. With the default
`draw = stop`, one field splits the term cleanly with no overlapping and no gap year.
`contributionsStopYear: 0` → no year contributes (the decumulator persona), and with the default
`draw` every year is Draw.

**What a Draw year changes, and nothing else:**

```
dividendsDrawnNzd     = grossDividends − usWithholding   // cash actually received
dividendsReinvestedNzd = 0                               // shares NOT increased by the dividend
purchasesNzd          = contributionsInvested (0) + dividendsReinvested (0) = 0
```

Price growth, the fee drag (`shares -= totalFees / closingPrice`), the `computeAnnualTax` call and
its argument construction, and the settlement `shares -= tax.nzTaxPayableNzd / closingPrice` are
**byte-identical in all three phases**. Principal is never sold to fund income (PRD non-goal: no
capital drawdown).

**Tax does not change when dividends stop being reinvested.** Above the de minimis, FIF taxes a
*deemed* return on **opening market value** — drawing changes neither the opening value nor the
rate. Below it, actual **gross** dividends are taxed — also unchanged. Reinvesting was never
deferral and drawing is not a new taxable event (`nz-tax.md`). Any change to tax logic in this
slice is a defect.

**Decisions (each was a real fork):**

| Question | Decision | Why |
|---|---|---|
| `drawdownStartYear < contributionsStopYear` | **Throw** `ProjectionInputError` naming both | Contributing *and* drawing in one year is not a modelled phase; clamping would silently run a plan the user did not ask for (Constitution §1) |
| `drawdownStartYear` given, `contributionsStopYear` omitted | **Throw** — same rule (`stop` is `Infinity`) | Same reason |
| Either field > `termYears` | **Accepted**, phase simply never starts | "I won't stop within 15 years" is a real answer; the Phase column discloses it per year |
| Drawn income reported gross or net of NZ tax | **`dividendsDrawnNzd` = gross dividends − US WHT**, i.e. the cash received; gross of NZ tax | The NZ tax is settled from the portfolio in every phase (one code path). A second net-of-tax field would read as a double charge; `nzTaxPayableNzd` sits in the same row |
| Fee in a Draw year | **Still out of the share count**, unchanged | Invariant 8 — the drag must compound; the platform charges the holding, not the investor's spending money |

**New fields (additive only):** `ProjectionRow.phase: "accumulate" \| "coast" \| "draw"`,
`ProjectionRow.dividendsDrawnNzd: number`, `ProjectionResult.totalDividendsDrawnNzd: number`.
`netGainNzd` keeps its current formula (portfolio only, so it excludes drawn cash) — which is why
`totalDividendsDrawnNzd` must be displayed beside it.

**Named fixtures** (unlisted inputs zero / net basis / timing `"start"` / `contributionsPerYear: 1`,
per the engine spec convention):

- **P** — 1,000 sh @ 10, g 0.10, term 2, d0 **0.55**, dividendGrowth 0, `contributionPerEventNzd`
  1,100, direct 0.33, WHT 0, no fees. (Year 1 is projection-engine AC16's year 1 — cross-check
  against it.)
- **Q** — 10,000 sh @ 10, g 0.10, term **1**, d0 0.55, `usWithholdingRate` 0.15, direct 0.33, no
  contributions. (= projection-engine AC11 fixture.)
- **R** — 10,000 sh @ 10, g 0.10, term 2, d0 0.55, dividendGrowth 0, `contributionPerEventNzd`
  1,000, `usWithholdingRate` 0.15, direct 0.33.

## Acceptance Criteria

Each is one RED test, observed failing **on its own** with an assertion message. 1–9 are appended to
`lib/__tests__/projection.test.ts`; 10–13 to `components/__tests__/projectionInputs.test.ts`.

1. **Omitting both fields reproduces today's output exactly.** The projection-engine AC16 golden
   fixture with neither field set still gives y1 `closingValueNzd` **12,820.50**, `nzTaxPayableNzd`
   **201.465**, `closingValueAfterTaxNzd` **12,619.035**, `closingShares` **1,147.185**; y2
   `grossDividendsNzd` **754.546925**, `closingValueNzd` **15,845.485425**, `nzTaxPayableNzd`
   **249.000485**, `closingValueAfterTaxNzd` **15,596.48494**; summary contributions **2,200**,
   `totalTaxNzd` **450.465485**, `netGainNzd` **3,396.48494**. Every row has `phase
   "accumulate"` and `dividendsDrawnNzd 0`; `totalDividendsDrawnNzd === 0`.
2. **A value beyond the term is accepted and inert.** The same fixture with
   `contributionsStopYear: 99, drawdownStartYear: 99` `toEqual`s the AC1 result object in full
   (deep equality, including `phase`).
3. **Coast stops contributions but keeps the DRIP.** **P** with `contributionsStopYear: 2`.
   Year 1 `phase "accumulate"`, `contributionsGrossNzd` 1,100, `closingValueAfterTaxNzd`
   **12,619.035**. Year 2 `phase "coast"`, `contributionsGrossNzd` **0**,
   `contributionsInvestedNzd` 0, `dividendsReinvestedNzd` **630.95175**, `dividendsDrawnNzd` 0,
   `purchasesNzd` 630.95175, `closingValueNzd` **14,511.89025**, `nzTaxPayableNzd`
   **208.2140775**, `closingValueAfterTaxNzd` **14,303.6761725**,
   `cumulativeContributionsNzd` **1,100**. Inclusive boundaries would contribute in year 2
   (closing 16,000+); a Coast that stopped the DRIP gives closing 13,880.9385.
4. **Draw pays the dividend out; principal is untouched.** **P** with `contributionsStopYear: 2,
   drawdownStartYear: 2`. Year 1 row `toEqual`s AC3's year 1 row exactly. Year 2 `phase "draw"`,
   `grossDividendsNzd` **630.95175**, `dividendsDrawnNzd` **630.95175**, `dividendsReinvestedNzd`
   **0**, `purchasesNzd` 0, `closingShares` **1,147.185** (unchanged by the dividend),
   `closingValueNzd` **13,880.9385**, `closingValueAfterTaxNzd` **13,672.7244225**;
   `totalDividendsDrawnNzd` **630.95175**.
5. **Drawing does not change the tax — below the de minimis.** AC3 and AC4 year 2 have identical
   `taxRegime "dividend"`, `taxableIncomeNzd` **630.95175** and `nzTaxPayableNzd` **208.2140775**,
   and `coast.closingValueAfterTaxNzd − draw.closingValueAfterTaxNzd === 630.95175` — exactly the
   drawn cash, to 6 dp.
6. **Drawing does not change the tax — FIF/FDR.** **Q** run twice: default vs
   `contributionsStopYear: 1, drawdownStartYear: 1`. Both give `taxMethod "fdr"`,
   `taxableIncomeNzd` **5,000**, `nzTaxPayableNzd` **825**, `totalTaxNzd` **1,650**,
   `grossDividendsNzd` 5,500, `usWithholdingNzd` 825. The Draw run gives `dividendsDrawnNzd`
   **4,675**, `closingValueNzd` **110,000**, `costBasisNzd` **100,000** (no purchase),
   `closingShares` **9,925**, `closingValueAfterTaxNzd` **109,175** — exactly 4,675 below the
   default run's 113,850.
7. **`contributionsStopYear: 0` is the decumulator, not "unset".** **R** with
   `contributionsStopYear: 0` (so `draw` defaults to 0). Every row `phase "draw"`;
   `totalContributionsNzd` **0** despite `contributionPerEventNzd` 1,000. Y1: `dividendsDrawnNzd`
   **4,675**, `closingValueNzd` **110,000**, `nzTaxPayableNzd` **825**, `closingValueAfterTaxNzd`
   **109,175**. Y2: `openingValueNzd` **109,175**, `grossDividendsNzd` **5,458.75**,
   `usWithholdingNzd` **818.8125**, `dividendsDrawnNzd` **4,639.9375**, `closingValueNzd`
   **120,092.50**, `taxMethod "fdr"`, `taxableIncomeNzd` **5,458.75**, `nzTaxPayableNzd`
   **982.575**, `closingValueAfterTaxNzd` **119,109.925**. Summary `totalDividendsDrawnNzd`
   **9,314.9375**, `netGainNzd` **19,109.925**. A `||`-style falsy check treats 0 as unset and
   fails every figure here.
8. **Invalid phase input throws, nothing is clamped or coerced.** `ProjectionInputError` naming the
   offending field(s) for: `contributionsStopYear` or `drawdownStartYear` non-integer (`2.5`),
   negative (`-1`), `NaN`, or `Infinity`; `{ contributionsStopYear: 3, drawdownStartYear: 2 }`
   (message names **both**); `{ drawdownStartYear: 5 }` with `contributionsStopYear` omitted.
   `{ contributionsStopYear: 0 }` does **not** throw.
9. **No `NaN`/`Infinity` escapes the new paths.** The existing `assertAllFinite` helper (which
   enumerates fields at runtime, so it covers `dividendsDrawnNzd` and `totalDividendsDrawnNzd`
   automatically) passes for the AC3, AC4, AC6-draw and AC7 fixtures, plus `{ termYears: 1,
   contributionsStopYear: 0 }` with all other inputs at their `makeInput` defaults.
10. **Blank means absent, `"0"` means zero.** `buildProjectionInput` maps
    `contributionsStopYear: ""` → `undefined` and `"0"` → `0`; `"5"` → `5`. With
    `contributionsStopYear "5"` and `drawdownStartYear ""`, the built input has
    `drawdownStartYear === undefined` — the mapper never fills in the default (the engine owns it,
    Constitution §2).
11. **Phase fields validate without coercion.** `"abc"`, `"-1"`, `"2.5"`, `"60"` each yield a field
    error naming the field; the projection does not run (invariant 14).
12. **The cross-field error surfaces verbatim.** `runProjection` on a valid form with
    `contributionsStopYear "5"`, `drawdownStartYear "3"` returns `{ ok: false, errors:
    ["ProjectionInputError: …"] }` naming both fields — not caught, not reworded.
13. **`formatPhase` labels the three phases.** A pure exported helper maps `"accumulate" | "coast" |
    "draw"` → `"Accumulate" | "Coast" | "Draw"`. No formatting logic lives in the `.tsx`.
14. **UI wiring** (inspection / `pnpm dev`): two text inputs — *"Stop contributing from year (blank
    = never)"* and *"Start drawing dividends from year (blank = same as stop year)"* — in the
    existing grid, each with its `FieldError`, both defaulting to `""`. A **Phase** column after
    Year and an **Income Drawn** column (`dividendsDrawnNzd`, via `formatNzd`) after US WHT; all
    existing columns unchanged in order and content. A **Total Income Drawn**
    (`totalDividendsDrawnNzd`) summary tile beside Net Gain, with one line of static text stating
    that Net Gain excludes income already drawn.
15. **Before/after in `notes.md`**, columns *Scenario · Metric · Before · After · Why*. Scenario =
    the UI defaults (100k, 15y, 0 monthly, SCHD seed, direct 33%, WHT 15%), Before = both fields
    blank, After = `contributionsStopYear 0`, `drawdownStartYear 10`. Metrics: year-1
    `nzTaxPayableNzd`, year-10 `phase`, year-10 `dividendsDrawnNzd`, year-15 `finalValueNzd`,
    `totalDividendsDrawnNzd`. The **Before** column must be captured by running the *pre-change*
    commit (scratch script, not committed), not estimated, and must be identical to the new build
    with the fields blank — state that identity explicitly.
16. `pnpm lint` zero warnings · `pnpm build` succeeds · `pnpm test` green · `pnpm exec tsc
    --noEmit` exit 0, all four on a clean checkout of the commit.

## Out of Scope

- **Inflation / real-terms reporting**, the **crossover / target-income report**, the **tax-mode
  segmented control**, the **presets dropdown**, charts, `/retirement`.
- **Capital drawdown** — principal is never sold to fund income (PRD non-goal). No withdrawal-rate
  input, no depletion year.
- Any **restyling**, colour, font or layout change — deferred to a later `/impeccable` pass.
- Editing `lib/nzTax.ts`, `lib/funds.ts`, `data/*`, `app/*`, root `types.ts`, `vitest.config.mts`,
  `package.json`. **No new dependency.**
- A net-of-NZ-tax income field, a mid-year phase change, partial drawdown (a % of dividends), and
  reducing `costBasisNzd` when dividends are drawn (no disposal occurred).

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first.
- **Touch only:** `lib/projection.ts`, `lib/__tests__/projection.test.ts`,
  `components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
  `components/InvestmentProjectionCalculator.tsx`, and this slice's `notes.md`.
- **Purely additive.** Both new engine fields are optional. **Do not modify a single existing
  assertion** in either test file — append new `it(...)` blocks only. If an existing test fails,
  that is a regression in your change, not a stale fixture: **stop and raise a blocker.** Same if
  any expected value above disagrees with your arithmetic — never edit the fixture to match the
  code.
- **TDD split.** `lib/` (ACs 1–9) and the pure mapper (ACs 10–13) are **RED-first, mandatory**: write
  the test, run it alone (`pnpm test -t "<name>"`), record the assertion message (expected vs
  received) in `notes.md`, then implement. A suite-level import/type error is **not** RED — two
  earlier slices were pulled up on exactly this. Rendering (AC14) is exempt; advance with
  `bin/lean-spec advance --no-tdd` logging *"rendering needs jsdom + testing-library, both banned
  new deps; all engine and mapper logic is RED-first tested"*.
- **Mutation-resistant fixtures.** A fixture whose expected value is unchanged by the behaviour it
  claims to pin is a defect. Before finishing, for each new AC, break the line it targets (flip a
  boundary to `<=`, drop the `dividendsReinvested = 0`, swap `??` for `||`) and confirm that test
  goes red. Record it in `notes.md`.
- **`??`, never `||` or truthiness**, on both new fields — `0` is a meaningful value and the
  decumulator persona depends on it (AC7).
- **Constitution §2:** the phase decision lives in **one** helper in `lib/projection.ts`, called per
  year. No phase logic, no `"draw"` comparison and no arithmetic in the `.tsx`; `projectionInputs.ts`
  only parses and passes through (`/100` and the unit-share assignment remain the only arithmetic
  there). Do not touch the tax call's arguments.
- TypeScript strict: no `any`, no non-null assertions, no `as` cast to silence a missing field.
- Comments explain *why* only: why the boundaries are first-year-of-new-behaviour, why drawing does
  not change the tax, why the fee and the tax settlement still come out of the share count, and why
  `0` must not be treated as unset.
