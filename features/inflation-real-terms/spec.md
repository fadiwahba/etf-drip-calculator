# inflation-real-terms

## Scope

Report the projection in **today's dollars by default**, nominal on opt-in, plus a per-year
**Purchasing power lost** memo column. Also closes review findings **F1** and **F2** (test-only).

**R1 — one new pure function in `lib/`; real vs nominal is a VIEW, not a second projection.**

```ts
export interface RealProjectionRow extends ProjectionRow { purchasingPowerLostNzd: number }
export interface RealProjectionResult extends Omit<ProjectionResult, "rows"> {
  rows: RealProjectionRow[];
  inflationRate: number;
}
export function toRealTerms(result: ProjectionResult, inflationRate: number): RealProjectionResult
```

One `project()` call, then `toRealTerms` on its result. `project()`, `projectFund()`,
`ProjectionInput`, `ProjectionRow` and `ProjectionResult` get **zero edited lines**: inflation
changes no maths, so making it a projection input would imply it does and risk it reaching a tax
base.

**R2 — the deflator.** `t = row.year`; year-t amounts ÷ `(1+i)^t`, so year 1 is deflated by one
year. The `opening*` money fields are dated **t−1** (nominally `openingValueNzd(t) ===
closingValueAfterTaxNzd(t−1)`) and use `(1+i)^(t−1)`. **Year 0 uses exponent 0 for every field** —
it is the pre-growth snapshot, already in today's dollars, and `(1+i)^-1` would inflate it. Flows
are treated as year-end; no intra-year deflator.

**R3 — what is deflated.**

- ÷ `(1+i)^t`: `closingSharePriceNzd`, `closingValueNzd`, `closingValueAfterTaxNzd`,
  `contributionsGrossNzd`, `contributionsInvestedNzd`, `brokerageFeeNzd`, `fxSpreadCostNzd`,
  `expenseFeeNzd`, `platformFeeNzd`, `totalFeesNzd`, `dividendPerShareNzd`, `grossDividendsNzd`,
  `usWithholdingNzd`, `dividendsReinvestedNzd`, `dividendsDrawnNzd`, `purchasesNzd`,
  `taxableIncomeNzd`, `nzTaxPayableNzd`, `totalTaxNzd`.
- ÷ `(1+i)^(t−1)`: `openingSharePriceNzd`, `openingValueNzd`.
- Running PV sum `Σ(k≤t) contributionsGrossNzd(k)/(1+i)^k`: `cumulativeContributionsNzd`.
- Never: `openingShares`, `closingShares` (counts, not money); `costBasisNzd` (a statutory base
  tested against the **nominal** NZ$50,000 de minimis); `year`, `phase`, `taxRegime`, `taxMethod`,
  `aboveThreshold`. **A rate is never deflated.**

**Summary fields:** `initialInvestmentNzd` unchanged (dated 0); `finalValueNzd` and
`totalContributionsNzd` = the last row's real `closingValueAfterTaxNzd` and
`cumulativeContributionsNzd`; `totalFeesNzd` / `totalTaxNzd` / `totalDividendsDrawnNzd` = **sums of
the deflated rows**, never one deflator applied to a nominal total; `netGainNzd` = the same formula
on real parts; `inflationRate` echoed.

**R4 — purchasing power lost** = `nominal.closingValueAfterTaxNzd(t) − real…(t)`, 0 in year 0.
**Not a cash outflow:** never in a fee or tax total, never subtracted from a balance, never in
`netGainNzd`, and there is **no total** — summing balances across years double-counts.

**R6 — the toggle.** `showRealTerms` defaults **true**; `inflationRatePercent` defaults `"3"`, a
chosen planning assumption and not a published statistic, which the UI states (Constitution §3).
Off → nominal, memo column hidden, rate input **disabled** (value kept) and not parsed. On with an
invalid rate → field error and **no table**, never a silent fall-back to nominal.

**R7 — contributions stay NOMINAL.** A fixed dollar amount; the engine invests exactly that every
year and the real view shows it shrinking. Indexing it would change what is invested — a different
projection, contradicting R1 — and no auto-invest order indexes itself.

**Rate domain `0 ≤ i < 1`.** Deflation is **rejected**: real above nominal puts a negative number
in a column labelled "lost", which reads as a gain (Constitution §1). `i = 0` is legal.

**Tax stays nominal.** IRD taxes nominal dollars and FIF has no inflation adjustment.
`toRealTerms` runs after `project()` and can never feed a tax base; deflating a tax *amount* only
re-expresses cash already paid.

**Fixture P** = existing `makeFixtureP`, no phase fields. Nominal y1: `closingValueNzd` 12,820.50,
`nzTaxPayableNzd` 201.465, `closingValueAfterTaxNzd` 12,619.035. Y2: `grossDividendsNzd` 685.95175,
`closingValueNzd` 15,776.89025, `nzTaxPayableNzd` 226.3640775, `closingValueAfterTaxNzd`
15,550.5261725; totals contributions 2,200, tax 427.8290775, `netGainNzd` 3,350.5261725.
**Fixture R** = existing `makeFixtureR`.

## Acceptance Criteria

Each is one RED test, observed failing on its own. ACs 1–8 and 14–16 append to
`lib/__tests__/projection.test.ts`; 9–12 to `components/__tests__/projectionInputs.test.ts`. Money
assertions use `toBeCloseTo(x, 6)`.

1. **`i = 0` is the identity.** `toRealTerms(project(P), 0)`: every row and summary field equals
   `project(P)`'s (`toEqual` once `purchasingPowerLostNzd` is removed), every
   `purchasingPowerLostNzd` exactly `0`, `inflationRate` `0`. `project(P)` still returns the
   nominal path above.
2. **Deflator and exponents — P at `i = 0.10`.** Year 0 equals nominal year 0 exactly, memo `0`.
   Y1: `openingValueNzd` **10,000** and `openingSharePriceNzd` **10** (t−1 = 0, undeflated),
   `closingSharePriceNzd` **10**, `contributionsGrossNzd` **1,000**, `dividendPerShareNzd` **0.5**,
   `grossDividendsNzd` **555**, `closingValueNzd` **11,655**, `purchasesNzd` **1,555**,
   `taxableIncomeNzd` **555**, `nzTaxPayableNzd` **183.15**, `closingValueAfterTaxNzd`
   **11,471.85**, `cumulativeContributionsNzd` **1,000**. Y2: `openingValueNzd` **11,471.85**
   (chain check — equals y1's real `closingValueAfterTaxNzd`), `openingSharePriceNzd` **10**,
   `closingSharePriceNzd` **10**, `contributionsGrossNzd` **909.090909**, `grossDividendsNzd`
   **566.902273**, `closingValueNzd` **13,038.752273**, `nzTaxPayableNzd` **187.07775**,
   `closingValueAfterTaxNzd` **12,851.674523**, `cumulativeContributionsNzd` **1,909.090909**.
   Discriminating: `(1+i)^t` on the `opening*` fields gives y2 `openingValueNzd` 10,428.13; a
   `(1+i)^(t−1)` everywhere gives y1 `closingValueAfterTaxNzd` 12,619.035.
3. **The deflator uses the inflation rate, not the growth rate.** P at **`i = 0.03`**: y1
   `closingValueAfterTaxNzd` **12,251.490291**, memo **367.544709**; y2 `closingValueAfterTaxNzd`
   **14,657.862355**, memo **892.663817**. (AC2 uses `i = g = 0.10` for round numbers; this AC is
   what kills a `sharePriceGrowth` mix-up.)
4. **Non-money fields pass through untouched.** P at `i = 0.10`, `Object.is` against the nominal
   row on every row: `openingShares`, `closingShares` (y1 **1,147.185**, y2
   **1,285.1674522727273**), `costBasisNzd` (y1 **11,710.50**, y2 **13,496.45175**), `year`,
   `phase`, `taxRegime`, `taxMethod`, `aboveThreshold`.
5. **Purchasing power lost is a memo, not an outflow.** P at `i = 0.10`: every row satisfies
   `memo === nominal.closingValueAfterTaxNzd − real.closingValueAfterTaxNzd`; y0 exactly `0`, y1
   **1,147.185**, y2 **2,698.851650**. Real `totalFeesNzd` **0** and real `totalTaxNzd`
   **370.22775** exclude it; real y2 `closingValueAfterTaxNzd` is **12,851.674523**, so no balance
   is reduced by it. No `totalPurchasingPowerLostNzd` field exists.
6. **Real totals are PV sums, not one deflated total.** P at `i = 0.10`: `initialInvestmentNzd`
   **10,000** (`Object.is`), `finalValueNzd` **12,851.674523**, `totalContributionsNzd`
   **1,909.090909** (**not** 2,200/1.21 = 1,818.181818), `totalTaxNzd` **370.22775** (**not**
   427.8290775/1.21 = 353.57775), `totalFeesNzd` 0, `totalDividendsDrawnNzd` 0, `netGainNzd`
   **942.583614**, `inflationRate` 0.10.
7. **Contributions are nominal; the real view shows them shrinking.** P at `i = 0.10`: nominal
   `contributionsGrossNzd` **1,100** in both years; real **1,000** (y1) and **909.090909** (y2).
   Indexed contributions would give real 1,000 in y2 — that is the failure signal.
8. **The rate is validated, nothing is clamped.** `toRealTerms(project(P), x)` throws
   `ProjectionInputError` naming `inflationRate` for `NaN`, `Infinity`, `-Infinity`, `-0.01`
   (deflation), `1` and `3` (percent-shaped). `0` and `0.999` do not throw.
9. **`parseInflationRate(form)`** (new export): `showRealTerms: false` → `{ ok: true, value:
   undefined }` even for `"abc"`. `showRealTerms: true`: `"3"` → `0.03`, `"0"` → `0`, `""` → error
   *"Inflation rate (%) is required"*, `"abc"` and `" "` → a field error. Never `0` by coercion
   (invariant 14).
10. **`buildProjectionInput` surfaces the field error, never the value.** Toggle on with
    `inflationRatePercent "abc"` → `{ ok: false, errors: { inflationRatePercent: … } }`; toggle off
    with the same value → `ok: true`. On success `"inflationRate" in value === false`.
11. **One projection, two views.** `runProjection` returns `{ ok: true, value, real }`. Toggle on
    at `"3"`: `real.inflationRate === 0.03`, `real.rows.length === value.rows.length`, and `value`
    `toEqual`s the same form with the toggle **off** (whose `real` is `undefined`).
12. **The engine error surfaces verbatim.** Toggle on, `inflationRatePercent "150"` → `{ ok: false,
    errors: ["ProjectionInputError: …"] }` naming `inflationRate`, not reworded.
13. **UI** (inspection): a plain `<input type="checkbox">` *"Show in today's dollars (real terms)"*,
    checked by default; an *"Inflation rate (% p.a.)"* input defaulting to `"3"`, `disabled` when
    the toggle is off, with a `FieldError` and the line *"3% is a chosen planning assumption, not a
    published forecast."*; a **Purchasing power lost** column **after End Balance** (last, away from
    Fees and NZ Tax), only when the toggle is on; tiles and cells read `real` when on and `value`
    when off, tile headings suffixed *"(today's dollars)"*; one static line: the memo is not a cash
    outflow and contributions are a fixed nominal amount. Existing columns unchanged. No restyling.
14. **F1 — the fee drag is charged in every phase.** Fixture **R**, `platformFeeAnnualRate: 0.01`,
    run twice: Draw (`contributionsStopYear: 0`) and Coast (`contributionsStopYear: 0,
    drawdownStartYear: 4`). Draw y1: `totalFeesNzd` **1,100**, `closingValueNzd` **108,900**,
    `dividendsDrawnNzd` **4,675**, `taxMethod "fdr"`, `taxableIncomeNzd` **5,000**,
    `nzTaxPayableNzd` **825**, `closingShares` **9,825**, `closingValueAfterTaxNzd` **108,075**.
    Coast y1: `totalFeesNzd` **1,146.75**, `dividendsReinvestedNzd` **4,675**, `closingValueNzd`
    **113,528.25**, `nzTaxPayableNzd` **825**, `closingShares` **10,245.75**,
    `closingValueAfterTaxNzd` **112,703.25**. Every row of both runs:
    `totalFeesNzd / (closingValueNzd + totalFeesNzd)` = **0.01** to 12 dp. A fee skipped in a Draw
    year gives `totalFeesNzd` 0 and `closingShares` 9,925.
15. **F2 — 3PP-AC9 checks the real Coast fixture.** In that block only, the first fixture becomes
    `makeFixtureP({ contributionsStopYear: 2, drawdownStartYear: 4 })`, with
    `expect(rows[2].phase).toBe("coast")` so it cannot drift again.
16. **No `NaN`/`Infinity` in the real view.** `assertAllFinite` passes for `toRealTerms` of P at
    `i = 0`, `0.03`, `0.10`, `0.999`; R with `contributionsStopYear: 0` at `i = 0.03`; and
    `project(makeInput({ termYears: 1 }))` at `i = 0.03`.
17. **Before/after table in `notes.md`** — *Scenario · Metric · Nominal (toggle off) · Real (toggle
    on, 3%) · Why*. Scenario = UI defaults (100k, 15y, 0 monthly, SCHD seed, direct 33%, WHT 15%,
    phase fields blank). Metrics: year-15 `finalValueNzd`, year-15 `grossDividendsNzd`,
    `totalTaxNzd`, `netGainNzd`, year-15 purchasing power lost. State the sanity check
    `1.03^15 ≈ 1.5580`, so real ≈ **64%** of nominal, and the PRD headline: at 3% over 30 years
    `1.03^30 ≈ 2.4273`, so a nominal figure **overstates purchasing power by ~2.43×** (real ≈ 41%).
    Confirm from a run of the pre-change commit (scratch script, not committed) that the nominal
    column is unchanged.
18. `pnpm lint` zero warnings · `pnpm build` succeeds · `pnpm test` green · `pnpm exec tsc
    --noEmit` exit 0 — all four on a **clean checkout of the commit**.

## Out of Scope

- The **crossover / target-income report** (next slice, depends on this), the **tax-mode segmented
  control**, the **presets dropdown**, **capital drawdown**, **`/retirement`**, charts.
- **Inflation-indexed contributions** or target income.
- Deflating `costBasisNzd` or the FIF threshold; any inflation adjustment to a tax base; any change
  to `computeAnnualTax` or its arguments.
- Negative inflation, intra-year deflators, a per-period inflation path, a total purchasing-power
  figure, a real CAGR or IRR.
- Any **restyling**, colour, font or layout change — deferred to a later `/impeccable` pass.
- Editing `lib/nzTax.ts`, `lib/funds.ts`, `data/*`, `app/*`, `types.ts`, `vitest.config.mts`,
  `package.json`. **No new dependency.**

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first.
- **Touch only:** `lib/projection.ts`, `lib/__tests__/projection.test.ts`,
  `components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
  `components/InvestmentProjectionCalculator.tsx`, this slice's `notes.md`.
- **Additive guarantee.** `project()`, `projectFund()`, `validateInput`, `resolvePhase`,
  `buildYearZeroRow` and the three existing interfaces get **zero edited lines**. Record in
  `notes.md`: the `git diff` of `lib/projection.ts` showing a pure append, and a scratch
  (uncommitted) run diffing the pre-change and post-change `project()` over **500 pseudorandom
  inputs** with `Object.is` on every field, plus the UI-default scenario — zero differences.
- **Do not modify any existing assertion** except the `3PP-AC9` block (AC15). Adding the two new
  fields to `makeForm()` is allowed and must be disclosed in `notes.md`. A failing pre-existing
  test is a regression in your change: **stop and raise a blocker** — likewise if any expected
  value above disagrees with your arithmetic.
- **TDD.** ACs 1–12 and 14–16 are **RED-first, mandatory**: write it, run it alone
  (`pnpm test -t "<name>"`), record the assertion message, then implement. A suite-level import or
  type error is **not** RED. AC13 is exempt: `bin/lean-spec advance --no-tdd`, logging *"jsdom +
  testing-library are banned new deps; all engine and mapper logic is RED-first tested"*.
- **Mutation check in `notes.md`** — mutate your own code, report what died. At least: exponent `t`
  → `t−1`; `opening*` deflated by `t`; `cumulativeContributionsNzd` deflated wholesale; the memo
  added into `totalFeesNzd`; `costBasisNzd` deflated; the negative-rate check dropped; the fee
  skipped in a Draw year. **`vitest --reporter=basic` exits non-zero on Vitest 4 whatever the
  result** — a harness using it calls every mutation "killed" and proves nothing; the last coder
  made that mistake. Run without it, restoring the file between runs.
- **Constitution §2:** every deflation lives in `toRealTerms`. No `/(1+i)` in the `.tsx` or in
  `projectionInputs.ts` beyond its single `/100`. The component picks which result to render.
  **§1:** invalid input throws or shows a field error; nothing coerced to 0; `NaN`/`Infinity` never
  render. **§3:** comment the 3% default as a chosen assumption with no published source — do
  **not** invent an IRD or RBNZ citation.
- TypeScript strict: no `any`, no non-null assertions, no `as` to silence a missing field.
- Comments explain *why* only: why inflation is not a `ProjectionInput`, why year 0 uses exponent
  0, why `opening*` is dated t−1, why `costBasisNzd` stays nominal, why contributions are nominal.
