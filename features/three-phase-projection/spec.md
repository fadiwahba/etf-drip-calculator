# three-phase-projection

## Scope

Extend the **closed** engine `lib/projection.ts` with two **optional** inputs,
`contributionsStopYear?: number` and `drawdownStartYear?: number`, so every year runs in one of
three phases, and wire both inputs plus a per-year **Phase** and **Income Drawn** column into
`components/InvestmentProjectionCalculator.tsx`.

**Phase function** — one private helper, applied to every row including year 0:

```
stop = contributionsStopYear ?? Infinity     // ?? never ||  — 0 is a meaningful value
draw = drawdownStartYear     ?? stop
phaseOf(y) = y < stop ? "accumulate" : y < draw ? "coast" : "draw"
```

**Each field names the FIRST year of the new behaviour.** `contributionsStopYear: 5` → years 1–4
contribute, year 5 does **not**. `drawdownStartYear: 5` → year 5 is the first year dividends are
paid out. `contributionsStopYear: 0` → no year contributes (the decumulator persona); every year
is Draw.

> **Coast is EMPTY by default — read this before writing any fixture.** `drawdownStartYear`
> defaults to `contributionsStopYear` (PRD Feature 3), so `draw = stop` and the window
> `stop ≤ y < draw` holds zero years: contributions stop and drawing starts in the *same* year.
> `{ contributionsStopYear: 2 }` alone makes year 2 **`"draw"`**, never `"coast"`. A Coast year
> exists only when `drawdownStartYear` is set explicitly and strictly greater. That is the PRD's
> semantics; any fixture wanting Coast must set both fields.

**What a Draw year changes, and nothing else:**

```
dividendsDrawnNzd      = grossDividends − usWithholding   // cash actually received
dividendsReinvestedNzd = 0                                // shares NOT increased by the dividend
purchasesNzd           = contributionsInvested (0) + dividendsReinvested (0) = 0
```

Price growth, the fee drag (`shares -= totalFees / closingPrice`), the `computeAnnualTax` call and
its argument construction, and the settlement `shares -= tax.nzTaxPayableNzd / closingPrice` are
**byte-identical in all three phases**. Principal is never sold to fund income.

**Tax does not change when dividends stop being reinvested.** Above the de minimis FIF taxes a
deemed return on opening market value; below it, gross dividends. Drawing changes neither base.
Any tax-logic change in this slice is a defect.

**Error handling:**

| Case | Behaviour |
|---|---|
| `drawdownStartYear < contributionsStopYear` | **Throw** `ProjectionInputError` naming both fields |
| `drawdownStartYear` given, `contributionsStopYear` omitted | **Throw** — same rule (`stop` is `Infinity`) |
| Either field > `termYears` | **Accepted**; the phase never starts |

**New fields (additive only):** `ProjectionRow.phase: "accumulate" \| "coast" \| "draw"`,
`ProjectionRow.dividendsDrawnNzd: number`, `ProjectionResult.totalDividendsDrawnNzd: number`.
`netGainNzd` keeps its formula (portfolio only, excluding drawn cash) — hence
`totalDividendsDrawnNzd` beside it.

**Named fixtures** (unlisted inputs zero / net basis / timing `"start"` / `contributionsPerYear: 1`):

- **P** — 1,000 sh @ 10, g 0.10, term 2, d0 **0.55**, dividendGrowth 0, `contributionPerEventNzd`
  1,100, direct 0.33, WHT 0, no fees. (Year 1 = projection-engine AC16's year 1.)
- **Q** — 10,000 sh @ 10, g 0.10, term **1**, d0 0.55, `usWithholdingRate` 0.15, direct 0.33, no
  contributions. (= projection-engine AC11 fixture.)
- **R** — 10,000 sh @ 10, g 0.10, term 2, d0 0.55, dividendGrowth 0, `contributionPerEventNzd`
  1,000, `usWithholdingRate` 0.15, direct 0.33.

## Acceptance Criteria

Each is one RED test, observed failing **on its own** with an assertion message. 1–9 append to
`lib/__tests__/projection.test.ts`; 10–13 to `components/__tests__/projectionInputs.test.ts`.

1. **Omitting both fields reproduces today's output exactly.** The projection-engine AC16 golden
   fixture, neither field set: y1 `closingValueNzd` **12,820.50**, `nzTaxPayableNzd` **201.465**,
   `closingValueAfterTaxNzd` **12,619.035**, `closingShares` **1,147.185**; y2 `grossDividendsNzd`
   **754.546925**, `closingValueNzd` **15,845.485425**, `nzTaxPayableNzd` **249.000485**,
   `closingValueAfterTaxNzd` **15,596.48494**; summary contributions **2,200**, `totalTaxNzd`
   **450.465485**, `netGainNzd` **3,396.48494**. Every row `phase "accumulate"`,
   `dividendsDrawnNzd 0`; `totalDividendsDrawnNzd === 0`.
2. **A value beyond the term is accepted and inert.** The same fixture with
   `contributionsStopYear: 99, drawdownStartYear: 99` `toEqual`s the AC1 result object in full
   (deep equality, including `phase`).
3. **Coast stops contributions but keeps the DRIP.** **P** with **`contributionsStopYear: 2,
   drawdownStartYear: 4`** — both fields, since Coast is empty otherwise; 4 > `termYears` 2, so
   Coast runs to the end. Y1 `phase "accumulate"`, `contributionsGrossNzd` 1,100, `closingShares`
   **1,147.185**, `closingValueAfterTaxNzd` **12,619.035**. Y2 `phase "coast"`,
   `contributionsGrossNzd` **0**, `contributionsInvestedNzd` 0, `dividendsReinvestedNzd`
   **630.95175**, `dividendsDrawnNzd` 0, `purchasesNzd` 630.95175, `closingValueNzd`
   **14,511.89025**, `nzTaxPayableNzd` **208.2140775**, `closingValueAfterTaxNzd`
   **14,303.6761725**, `cumulativeContributionsNzd` **1,100**. Discriminating: an inclusive
   `y <= stop` would contribute in year 2 → closing **15,776.89025**; a Coast that dropped the DRIP
   → closing **13,880.9385**.
4. **Draw pays the dividend out; principal is untouched.** **P** with `contributionsStopYear: 2,
   drawdownStartYear: 2` (`draw = stop`, so year 2 is the first Draw year). Assert year 1
   `phase === "accumulate"` explicitly **first**, then that the year 1 row `toEqual`s AC3's year 1
   row (a bare `toEqual` passes vacuously while the field is missing on both sides). Y2 `phase
   "draw"`, `grossDividendsNzd` **630.95175**, `dividendsDrawnNzd` **630.95175**,
   `dividendsReinvestedNzd` **0**, `purchasesNzd` 0, `closingValueNzd` **13,880.9385**
   (= `1,147.185 × 12.1`; the dividend bought **no** shares), `closingShares` **1,129.977225**,
   `closingValueAfterTaxNzd` **13,672.7244225**; `totalDividendsDrawnNzd` **630.95175**.
   **`closingShares` is 1,129.977225, not 1,147.185** — the dividend adds no shares, but the tax
   settlement still runs: `1,147.185 − 208.2140775 / 12.1 = 1,129.977225`. "Principal untouched" is
   pinned by `closingValueNzd` and `purchasesNzd`, not by `closingShares`.
5. **Drawing does not change the tax — below the de minimis.** The AC3 run (`stop 2, draw 4`) and
   the AC4 run (`stop 2, draw 2`) differ only in `drawdownStartYear`. Both give y2 `taxRegime
   "dividend"`, `taxableIncomeNzd` **630.95175**, `nzTaxPayableNzd` **208.2140775**, and
   `coast.closingValueAfterTaxNzd − draw.closingValueAfterTaxNzd
   = 14,303.6761725 − 13,672.7244225 = 630.95175` — exactly the drawn cash, to 6 dp.
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
   **9,314.9375**, `netGainNzd` **19,109.925**. A `||` falsy check treats 0 as unset and fails
   every figure here.
8. **Invalid phase input throws, nothing is clamped or coerced.** `ProjectionInputError` naming the
   offending field(s) for: `contributionsStopYear` or `drawdownStartYear` non-integer (`2.5`),
   negative (`-1`), `NaN`, or `Infinity`; `{ contributionsStopYear: 3, drawdownStartYear: 2 }`
   (message names **both**); `{ drawdownStartYear: 5 }` with `contributionsStopYear` omitted.
   `{ contributionsStopYear: 0 }` does **not** throw.
9. **No `NaN`/`Infinity` escapes the new paths.** `assertAllFinite` (runtime field enumeration, so
   it covers both new fields) passes for the AC3, AC4, AC6-draw and AC7 fixtures, plus
   `{ termYears: 1, contributionsStopYear: 0 }` with all other inputs at their `makeInput` defaults.
10. **Blank means absent, `"0"` means zero.** `buildProjectionInput` maps
    `contributionsStopYear: ""` → `undefined`, `"0"` → `0`, `"5"` → `5`. With
    `contributionsStopYear "5"` and `drawdownStartYear ""`, the built input has
    `drawdownStartYear === undefined` — the mapper never fills in the default; the engine owns it.
11. **Phase fields validate without coercion.** `"abc"`, `"-1"`, `"2.5"`, `"60"` each yield a field
    error naming the field; the projection does not run (invariant 14).
12. **The cross-field error surfaces verbatim.** `runProjection` on a valid form with
    `contributionsStopYear "5"`, `drawdownStartYear "3"` returns `{ ok: false, errors:
    ["ProjectionInputError: …"] }` naming both fields — not caught, not reworded.
13. **`formatPhase` labels the three phases.** A pure exported helper maps `"accumulate" | "coast" |
    "draw"` → `"Accumulate" | "Coast" | "Draw"`. No formatting logic in the `.tsx`.
14. **UI wiring** (inspection): two text inputs — *"Stop contributing from year (blank = never)"*
    and *"Start drawing dividends from year (blank = same as stop year)"* — in the existing grid,
    each with a `FieldError`, both defaulting to `""`. A **Phase** column after Year and an
    **Income Drawn** column (`dividendsDrawnNzd`, via `formatNzd`) after US WHT; all other columns
    unchanged in order and content. A **Total Income Drawn** (`totalDividendsDrawnNzd`) tile beside
    Net Gain, plus one static line: Net Gain excludes income already drawn.
15. **Before/after table in `notes.md`**, columns *Scenario · Metric · Before · After · Why*.
    Scenario = UI defaults (100k, 15y, 0 monthly, SCHD seed, direct 33%, WHT 15%); Before = both
    fields blank; After = `contributionsStopYear 0`, `drawdownStartYear 10`. Metrics: year-1
    `nzTaxPayableNzd`, year-10 `phase`, year-10 `dividendsDrawnNzd`, year-15 `finalValueNzd`,
    `totalDividendsDrawnNzd`. Capture **Before** by running the *pre-change* commit (scratch
    script, not committed), never estimated; state that it matches the new build with both fields
    blank.
16. `pnpm lint` zero warnings · `pnpm build` succeeds · `pnpm test` green · `pnpm exec tsc
    --noEmit` exit 0, all four on a clean checkout of the commit.

## Out of Scope

- **Inflation / real-terms reporting**, the **crossover / target-income report**, the **tax-mode
  segmented control**, the **presets dropdown**, charts, `/retirement`.
- **Capital drawdown** — no withdrawal-rate input, no depletion year.
- Any **restyling**, colour, font or layout change — deferred to a later `/impeccable` pass.
- Editing `lib/nzTax.ts`, `lib/funds.ts`, `data/*`, `app/*`, root `types.ts`, `vitest.config.mts`,
  `package.json`. **No new dependency.**
- A net-of-NZ-tax income field, a mid-year phase change, partial drawdown, and reducing
  `costBasisNzd` when dividends are drawn (no disposal occurred).

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first.
- **Scope of this refine pass.** Only ACs 3–5 changed; ACs 1, 2 and 6–16 already pass.
  **`lib/projection.ts` needs no change** — the phase gating and the tax settlement are correct as
  built. Edit only the `3PP-AC3`, `3PP-AC4`, `3PP-AC5` blocks in
  `lib/__tests__/projection.test.ts`: the coast run in AC3 and AC5 gains `drawdownStartYear: 4`;
  AC4's `closingShares` becomes `1_129.977225` and gains the year 1 `phase` and `closingValueNzd`
  assertions. Nothing else in either test file moves. Those two numbers changed because the
  **spec** was wrong — never bend a fixture to fit the code.
- **Mutation check, recorded in `notes.md`.** For each new AC, break the line it targets and
  confirm the test goes red. For the three changed ACs: `y < draw` → `y <= draw` must kill AC4;
  dropping the DRIP in a Coast year must kill AC3; skipping
  `shares -= nzTaxPayableNzd / closingPrice` must kill AC4's `closingShares`. Replace the stale
  "Blockers" section of `notes.md` with one line on the resolution.
- **Touch only:** `lib/projection.ts`, `lib/__tests__/projection.test.ts`,
  `components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
  `components/InvestmentProjectionCalculator.tsx`, and this slice's `notes.md`.
- **Purely additive.** Both new engine fields are optional. Outside the three refined blocks, **do
  not modify any existing assertion** — append new `it(...)` blocks only. A failing pre-existing
  test is a regression in your change: **stop and raise a blocker**, likewise if any expected value
  above disagrees with your arithmetic.
- **TDD split.** ACs 1–13 are **RED-first, mandatory**: write the test, run it alone
  (`pnpm test -t "<name>"`), record the assertion message in `notes.md`, then implement. A
  suite-level import/type error is **not** RED. Rendering (AC14) is exempt: advance with
  `bin/lean-spec advance --no-tdd` logging *"jsdom + testing-library are banned new deps; all
  engine and mapper logic is RED-first tested"*.
- **`??`, never `||`**, on both new fields — `0` is meaningful (AC7).
- **Constitution §2:** the phase decision lives in **one** helper in `lib/projection.ts`. No phase
  logic, no `"draw"` comparison, no arithmetic in the `.tsx`; `projectionInputs.ts` only parses and
  passes through. Do not touch the tax call's arguments.
- TypeScript strict: no `any`, no non-null assertions, no `as` cast to silence a missing field.
- Comments explain *why* only: boundary semantics, tax invariance under drawing, fee and tax
  settlement inside the share count, `0` is not "unset".
