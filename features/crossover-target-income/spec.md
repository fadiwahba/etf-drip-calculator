# crossover-target-income

## Scope

Add a **target annual income** input, one appended pure function in `lib/projection.ts` giving the
first year **net dividend income** meets it **in today's dollars**, and a headline tile.

**C1 — pure append.** `project()`, `projectFund()`, `toRealTerms()`, `validateInput`,
`resolvePhase`, `buildYearZeroRow` and the five existing interfaces get **zero edited lines**.

```ts
findIncomeCrossover(real: RealProjectionResult, targetAnnualIncomeNzd: number): IncomeCrossover
// fields: targetAnnualIncomeNzd, inflationRate, netIncomeByYearNzd (index === year, [0] is 0),
// firstYearAboveTarget | crossoverYear | incomeAtCrossoverNzd (number | null), finalYearNetIncomeNzd
```

**C2 — "net dividends".** Per row, `net(t) = grossDividendsNzd − usWithholdingNzd −
nzTaxPayableNzd` = `grossDividendsNzd − totalTaxNzd` (`nzTax.ts`: `totalTaxNzd = nzTaxPayableNzd +
usWithholdingPaidNzd`); `nzTaxPayableNzd` is already net of the WHT credit, so nothing
double-counts. WHT never reaches the investor; the NZ bill is compulsory cash on a **deemed return
on portfolio value** — at 1.65% of value against a ~3.5% yield, about half the income (Constitution
§1, §5). **Fees are excluded**: the fund and platform net them from the **assets** (`project()` cuts
the share count). Net income may be **negative**; never clamp it (AC21).

**C3 — real, dated year 0.** Reads the **already-deflated** rows of a `RealProjectionResult`,
inheriting `toRealTerms`'s exponents (closing-dated money ÷ `(1+i)^t`; year 0 exponent 0), with
**no `(1+i)` arithmetic** of its own (Constitution §2). The **target is real**, so the comparison is
real-vs-real; with the toggle **off** no crossover is reported.

**C4 — every phase counts.** Years 1..N are all scanned, whatever the `phase` — the reading is *the
first year the income would cover the target if you started drawing then*. Gating on Draw would
return "never" for the UI default (all Accumulate).

**C5 — sustained, not first.** `crossoverYear` = smallest `y ∈ [1,N]` with `net(t) ≥ target` for
**every** `t ∈ [y,N]` — to the end of the term, never a fixed lookahead (AC20).
`firstYearAboveTarget` (smallest `y` with `net(y) ≥ target`) is returned too. `≥`, so an
exactly-met target counts; year 0 never crosses. Not crossed ⇒ **`null`**, never `0`, `-1` or the
last year; `finalYearNetIncomeNzd` is always populated.

**Fixture T** (`makeInput` defaults except): `initialShares` 10,000, `initialSharePriceNzd` 10,
`sharePriceGrowth` 0.1, `initialDividendPerShareNzd` 0.5, `dividendGrowth` 0.1, `termYears` 5,
`usWithholdingRate` 0.15, direct, `marginalRate` 0.33, no contributions, no fees, no phase fields.
Closed form `net(t) = 0.0385 × openingValue(t)`, `openingValue(t) = 100_000 × 1.1385^(t−1)`.
**Fixture U**: as T but `initialShares` 4,800, `initialDividendPerShareNzd` 0.35, `termYears` 4.
Cost basis 48,000: year 1 is **below** the NZ$50,000 threshold (`"dividend"`, 33% of dividends),
year 2 crosses it (`"fif"`, FDR), which raises tax and dips income.

## Acceptance Criteria

Each is one RED test, run alone. 1–12 and 20–21 append to `lib/__tests__/projection.test.ts` (new
`describe`); 13–16 to `components/__tests__/projectionInputs.test.ts`. Money uses
`toBeCloseTo(x, 6)`.

1. **Additive guarantee.** `project(T)` y1: `grossDividendsNzd` **5,500**, `usWithholdingNzd`
   **825**, `nzTaxPayableNzd` **825**, `taxMethod "fdr"`, `closingValueAfterTaxNzd` **113,850**;
   `toRealTerms(project(T), 0.10).rows[1].grossDividendsNzd` **5,000**. `git diff` on
   `lib/projection.ts` shows appended lines only.
2. **Net = gross − WHT − NZ tax payable.** Fixture U, `toRealTerms(…, 0)`: `netIncomeByYearNzd` =
   `[0, 1238.16, 1188.83952, 1333.87794144, 1496.61105029568]`, each equal to its row's
   `grossDividendsNzd − totalTaxNzd`. Year-1 discriminators: gross alone **1,848**; `gross − WHT`
   **1,570.80**; `gross − nzTaxPayable` **1,515.36**; `dividendsDrawnNzd` **0**.
3. **Fees are not subtracted.** Fixture U with `platformFeeAnnualRate: 0.01` at `i = 0`:
   `netIncomeByYearNzd[1]` is still **1,238.16** (a fee-subtracting version gives 694.452), and
   `[2]` is **1,176.877944** — below AC2's 1,188.83952 only via the share count.
4. **Real, deflated to year 0.** Fixture T at `i = 0`: `[0, 3850, 4383.225, 4990.3016625,
   5681.45844275625, 6468.34043707799]` — the closed form above, year 1 closing on **10,350**
   shares. At `i = 0.10`: `[0, 3500, 3622.5, 3749.2875, 3880.5125625, 4016.3305021875]`
   (= `3500 × 1.035^(t−1)`), `inflationRate` **0.10** echoed.
5. **Real vs nominal.** Fixture T, target **3,800**: at `i = 0.10` `crossoverYear` **4**,
   `incomeAtCrossoverNzd` **3,880.5125625**; the same target on the `i = 0` result gives **1** —
   nominal is 3 years optimistic. Target **5,000**: `i = 0.10` gives **null**, `i = 0` gives **4**.
6. **Boundary / off-by-one.** Fixture T at `i = 0.10`: target **3,749.2875** (exactly year 3's
   income) ⇒ `crossoverYear` **3**, `incomeAtCrossoverNzd` **3,749.2875**; target **3,749.2876** ⇒
   **4**. A `>` comparison gives 4 for the first; a year/index off-by-one gives 2 or 4.
7. **Year 0 never crosses.** Fixture T at `i = 0.10`, target **0** ⇒ `crossoverYear` **1**,
   `firstYearAboveTarget` **1**; `netIncomeByYearNzd[0]` exactly **0**, `length === rows.length`
   (**6**).
8. **Phase-independent (C4).** Fixture T at `i = 0.10`, target 3,800: every row has `phase
   "accumulate"` and `dividendsDrawnNzd` **0**, yet `crossoverYear` is **4** (a Draw-only
   implementation returns `null`). The same fixture with `contributionsStopYear: 0` has
   `rows[1].dividendsDrawnNzd` **4,675** and still gives `netIncomeByYearNzd[1]` **3,500**.
9. **Never crossed (C5).** Fixture T at `i = 0.10`, target **5,000**: `crossoverYear`,
   `firstYearAboveTarget`, `incomeAtCrossoverNzd` all **`null`** (`toBeNull`, not falsy — not `0`,
   `-1` or `5`); `finalYearNetIncomeNzd` **4,016.3305021875**.
10. **Sustained vs first (C5).** Fixture U at `i = 0`, target **1,200**: `firstYearAboveTarget`
    **1**, `crossoverYear` **3**, `incomeAtCrossoverNzd` **1,333.87794144**,
    `finalYearNetIncomeNzd` **1,496.61105029568**; `rows[1].taxRegime "dividend"` and
    `rows[2].taxRegime "fif"` pin the de minimis dip. A "first year exceeding" version reports **1**.
11. **Target validated, nothing coerced.** `findIncomeCrossover(real, x)` throws
    `ProjectionInputError` naming `targetAnnualIncomeNzd` for `NaN`, `Infinity`, `-Infinity`, `-1`;
    `0` and `1e9` do not throw.
12. **No `NaN`/`Infinity`.** Every entry of `netIncomeByYearNzd` and every numeric field is finite
    for T at `i = 0`, `0.03`, `0.10`; U at `i = 0`; and `makeInput({ termYears: 1 })` at `i = 0.03`.
13. **`parseTargetIncome(form)`** (new export): `""` and `"   "` ⇒ `{ ok: true, value: undefined }`
    — blank is not an error. `"0"` ⇒ `0`, distinct from blank (invariant 14). `"80000"` ⇒ `80000`.
    `"abc"`, `"-1"` ⇒ a field error naming *Target annual income*.
14. **`buildProjectionInput`.** `targetAnnualIncome: "abc"` ⇒ `{ ok: false, errors: {
    targetAnnualIncome: … } }`; blank ⇒ `ok: true`; on success `"targetAnnualIncomeNzd" in value
    === false` — not a `ProjectionInput`, as with `inflationRate`.
15. **`runProjection` wiring.** Toggle on, target `"3800"` ⇒ `crossover` defined,
    `crossover.inflationRate === real.inflationRate`, `netIncomeByYearNzd.length ===
    value.rows.length`. Toggle **off** ⇒ `crossover === undefined` (C3). Toggle on, target blank ⇒
    `crossover === undefined`, `real` still defined, `ok: true`.
16. **One projection.** With the toggle on, `value` `toEqual`s the same form with the target blank
    — no second `project()` call.
17. **UI** (inspection): a *"Target annual income (NZD, today's dollars)"* input defaulting to
    `"80000"` (a placeholder, not a recommendation); a *"Dividend Income Crossover"* tile reading
    *"Year N"* / *"Not reached within N years"*, sub-line `incomeAtCrossoverNzd` or
    `finalYearNetIncomeNzd` via `formatNzd`; *"First reached in year X, but not sustained until year
    N"* only when the two differ; *"Turn on today's dollars to see the crossover year"* toggle-off;
    *"Enter a target annual income…"* when blank; a static line that Accumulate/Coast income is
    reinvested (*"if you switched to drawing then"*); a **Net dividend income** column, last, only
    when `crossover` is defined. Existing tiles and columns unchanged.
18. **Before/after table in `notes.md`** — *Scenario · Target · Crossover (real) · Crossover
    (nominal) · Δ years · Why*. Rows: fixture T @ 3,800 (year 4 vs 1); T @ 5,000 (never vs 4); the
    **UI-default scenario** (100k, 15y, 0 monthly, SCHD seed, direct 33%, WHT 15%, phase fields
    blank, inflation 3%, target 80,000) from an actual run, with both answers and
    `finalYearNetIncomeNzd`. State `1.03^30 ≈ 2.4273`: a nominal figure overstates purchasing power
    ~2.43× over 30 years; Fady acts on the **difference in years**.
19. `pnpm lint` (zero warnings) · `pnpm build` · `pnpm test` · `pnpm exec tsc --noEmit` — all green
    on a **clean checkout of the commit**.
20. **"Sustained" runs to the end (R4).** **Fixture V** = T but `initialShares` 4,600,
    `initialDividendPerShareNzd` 0.25, `termYears` 7. Yield on opening value is 2.75%, under FDR's
    deemed 5%, so the de minimis crossing **cuts** income: `net = 0.67 × gross =
    0.018425 × OV` below the threshold, `net = gross − 1.65% × OV = 0.011 × OV` above it; `OV(1) =
    46,000`, `OV(t+1) = 1.1 × OV(t) + net(t)`. `rows[3].costBasisNzd` **49,622.83926654203**
    (≤ 50,000, `taxRegime "dividend"`), `rows[4].costBasisNzd` **51,127.12400668227** (`"fif"`).
    At `i = 0`, `netIncomeByYearNzd` = `[0, 847.55, 947.92110875, 1060.17866605371875,
    707.8987012424659, 786.4754570803796, 873.7742328163018, 970.7631726589113]`. Target **800**:
    `firstYearAboveTarget` **1**, `crossoverYear` **6**, `incomeAtCrossoverNzd`
    **873.7742328163018**, `finalYearNetIncomeNzd` **970.7631726589113**. The dip lands **3 years**
    after the qualifying year, so a 2- or 3-year lookahead returns **1**.
21. **Negative net income, never clamped (R8).** **Fixture W** = T but
    `initialDividendPerShareNzd` 0.1, `termYears` 3. Cost basis 100,000 is above the threshold from
    year 1, so every year is FDR and the 1.1% yield sits under the 1.65% FDR drag:
    `net = gross − 1.65% × OV = −0.0055 × OV`, `OV` = 100,000 → 109,450 → 119,793.025
    (`× 1.0945`/yr). At `i = 0`: `netIncomeByYearNzd` `[0, -550, -601.975, -658.8616375]`,
    `finalYearNetIncomeNzd` **−658.8616375**; target **0** ⇒ `firstYearAboveTarget` and
    `crossoverYear` both **`null`**. A `Math.max(0, …)` clamp gives `[0, 0, 0, 0]`, final **0** and
    crossover **1**. AC18's UI-default row is the same mechanism: real net income turns negative in
    year **9**, ending **−1,568.51**.

## Out of Scope

- The **tax-mode segmented control**, **presets dropdown**, **capital drawdown**,
  **safe-withdrawal-rate modelling**, **`/retirement`**, charts; inflation-indexed or per-phase
  targets; solving for a contribution; any change to `project()`'s maths.
- A crossover in the nominal view (C3), fees subtracted from income (C2), a "first year exceeding"
  headline (C5); any **restyling**, colour, font or layout change.
- Editing `lib/nzTax.ts`, `lib/funds.ts`, `data/*`, `app/*`, `types.ts`, `vitest.config.mts`,
  `package.json`. **No new dependency.**

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first.
- **Touch only:** `lib/projection.ts`, `lib/__tests__/projection.test.ts`,
  `components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
  `components/InvestmentProjectionCalculator.tsx`, this slice's `notes.md`.
- **Additive guarantee (AC1).** Put the `git diff` of `lib/projection.ts` in `notes.md`. Modify no
  existing assertion; adding the new field to `makeForm()` is allowed and must be disclosed. A
  failing pre-existing test is a regression — **stop and raise a blocker**.
- **A number you cannot reproduce is a blocker, not a fix.** If an expected value here disagrees
  with your arithmetic, **stop and raise a blocker** — never resolve it in place, even when you turn
  out to be right. Last cycle's in-place AC4 fix left the spec contradicting the code.
- **Constitution §2:** all crossover logic lives in `findIncomeCrossover` — no income or deflator
  arithmetic in the `.tsx` or `projectionInputs.ts`. **§1:** invalid input throws or shows a field
  error, nothing coerced to 0, blank ≠ `0`, `NaN`/`Infinity` never render; reuse the file's existing
  validators.
- **One `project()` call** per run (AC16).
- **TDD.** ACs 1–16 are **RED-first, mandatory**: write it, run it alone (`pnpm test -t "<name>"`),
  record the assertion message, then implement. A suite-level import or type error is **not** RED.
  AC17 is exempt (`bin/lean-spec advance --no-tdd`: jsdom/testing-library are banned new deps).
  ACs 20–21 pin already-correct code and cannot RED; their evidence is the mutation — apply it,
  record the failure, restore, confirm green.
- **Mutation check in `notes.md`** — mutate your own code, report what died. At least: drop the WHT
  term; drop the `nzTaxPayableNzd` term; subtract `totalFeesNzd`; use `dividendsDrawnNzd`; return
  `firstYearAboveTarget` as `crossoverYear`; `≥` → `>`; start the scan at index 0; return `0`
  instead of `null`; drop the target validation; shorten the sustained scan to a 2-year lookahead
  (AC20); wrap net income in `Math.max(0, …)` (AC21). Default reporter only (`--reporter=basic`
  always exits non-zero on Vitest 4); restore the file between runs.
- TypeScript strict: no `any`, no non-null assertions, no `as` to silence a missing field.
- Comments explain *why* only (NZ tax in but fees out; the real target; `null` over `0`).
