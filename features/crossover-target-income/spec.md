# crossover-target-income

## Scope

Add a **target annual income** input, one appended pure function in `lib/projection.ts` giving the
first year **net dividend income** meets that target **in today's dollars**, and a headline tile.
The PRD's question: *when can I live off my dividends?*

**C1 — pure append.** `project()`, `projectFund()`, `toRealTerms()`, `validateInput`,
`resolvePhase`, `buildYearZeroRow` and the five existing interfaces get **zero edited lines**.

```ts
export interface IncomeCrossover {
  targetAnnualIncomeNzd: number;
  inflationRate: number;            // echoed from the real result
  netIncomeByYearNzd: number[];     // index === year === row index; [0] is 0
  firstYearAboveTarget: number | null;
  crossoverYear: number | null;     // first SUSTAINED year
  incomeAtCrossoverNzd: number | null;
  finalYearNetIncomeNzd: number;
}
export function findIncomeCrossover(
  real: RealProjectionResult,
  targetAnnualIncomeNzd: number
): IncomeCrossover
```

**C2 — "net dividends".** Per row, `net(t) = grossDividendsNzd − usWithholdingNzd −
nzTaxPayableNzd`; identically `grossDividendsNzd − totalTaxNzd` (`nzTax.ts`: `totalTaxNzd =
nzTaxPayableNzd + usWithholdingPaidNzd`). WHT is taken at source and never reaches the investor.
The NZ liability is a compulsory cash bill that year; under FIF it taxes a **deemed return on
portfolio value**, not the dividend, so it cannot be a fraction of the dividend — the whole-year
amount is subtracted. At 1.65% of value against a ~3.5% yield it takes about half the income, so
omitting it makes the headline ~2× optimistic (Constitution §1, §5). `nzTaxPayableNzd` is already
net of the WHT credit, so subtracting both double-counts nothing. **Fees are excluded**: fund and
platform net them from the **assets** (`project()` cuts the share count), never bill them against
dividend cash, and their drag already shows as fewer shares in later years. The rule is: subtract
the investor's own compulsory cash obligations for that year, not costs taken out of the assets.
Net income may be **negative**; never clamp it.

**C3 — real, dated year 0.** The function reads the **already-deflated** rows of a
`RealProjectionResult`, inheriting `toRealTerms`'s exponents (closing-dated money ÷ `(1+i)^t`; year
0 exponent 0), and contains **no `(1+i)` arithmetic** (Constitution §2). The **target is real** —
"$80,000" means today's money — so the comparison is real-vs-real. With the real-terms toggle
**off** there is no real view, so no crossover is reported and the UI says so; a nominal answer to
a real question is the wrong-number failure mode.

**C4 — every phase counts.** Years 1..N are all scanned, whatever the `phase`. In Accumulate/Coast
the reading is *the first year the income would cover the target if you started drawing then*.
Gating on Draw would return "never" for the UI default (phase fields blank ⇒ all Accumulate), the
primary persona. The year is exact for "reinvest until Y, then draw", since nothing before Y
changes. Gross dividends, WHT and NZ tax are phase-independent in the engine.

**C5 — sustained, not first.** `crossoverYear` = smallest `y ∈ [1,N]` with `net(t) ≥ target` for
**every** `t ∈ [y,N]`; a year above target followed by a shortfall is not living off dividends.
`firstYearAboveTarget` (smallest `y` with `net(y) ≥ target`) is returned too, so both readings stay
testable. `≥`, so an exactly-met target counts. Year 0 is the pre-growth snapshot and never
crosses. Not crossed ⇒ **`null`**, never `0`, `-1` or the last year; `finalYearNetIncomeNzd` is
always populated so the UI still reports something honest.

**Fixture T** (`makeInput` defaults except): `initialShares` 10,000, `initialSharePriceNzd` 10,
`sharePriceGrowth` 0.1, `initialDividendPerShareNzd` 0.5, `dividendGrowth` 0.1, `termYears` 5,
`usWithholdingRate` 0.15, direct, `marginalRate` 0.33, no contributions, no fees, no phase fields.
Closed form `net(t) = 0.0385 × openingValue(t)`, `openingValue(t) = 100_000 × 1.1385^(t−1)`.
**Fixture U** (de minimis crossing — the PRD's demanding case): as T but `initialShares` 4,800,
`initialDividendPerShareNzd` 0.35, `termYears` 4. Cost basis 48,000, so year 1 is **below** the
NZ$50,000 threshold (`taxRegime "dividend"`, 33% of dividends) and year 2 crosses it (`"fif"`,
FDR), which raises tax and dips income.

## Acceptance Criteria

Each is one RED test, observed failing alone. 1–12 append to `lib/__tests__/projection.test.ts`
(new `describe`); 13–16 to `components/__tests__/projectionInputs.test.ts`. Money uses
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
   `[2]` is **1,176.877944** — below AC2's 1,188.83952 only because the fee cut the share count.
4. **Real, deflated to year 0.** Fixture T at `i = 0`: `[0, 3850, 4383.225, 4990.1284125,
   5681.26119763125, 6468.115873503178]`. At `i = 0.10`: `[0, 3500, 3622.5, 3749.2875,
   3880.5125625, 4016.3305021875]` (= `3500 × 1.035^(t−1)`), `inflationRate` **0.10** echoed.
5. **Real target vs nominal comparison.** Fixture T, target **3,800**: at `i = 0.10`
   `crossoverYear` **4**, `incomeAtCrossoverNzd` **3,880.5125625**; the same target on the `i = 0`
   result gives **1** — nominal is 3 years too optimistic in a 5-year fixture. Target **5,000**:
   `i = 0.10` gives **null**, `i = 0` gives **4**.
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
    `rows[2].taxRegime "fif"` pin the de minimis crossing that causes the dip. A "first year
    exceeding" implementation reports **1** — a year the plan cannot sustain.
11. **Target validated, nothing coerced.** `findIncomeCrossover(real, x)` throws
    `ProjectionInputError` naming `targetAnnualIncomeNzd` for `NaN`, `Infinity`, `-Infinity`, `-1`;
    `0` and `1e9` do not throw.
12. **No `NaN`/`Infinity`.** Every entry of `netIncomeByYearNzd` and every numeric field of
    `IncomeCrossover` is finite for T at `i = 0`, `0.03`, `0.10`; U at `i = 0`; and
    `makeInput({ termYears: 1 })` at `i = 0.03`.
13. **`parseTargetIncome(form)`** (new export): `""` and `"   "` ⇒ `{ ok: true, value: undefined }`
    — no target, not an error, since a blank field must not hide the whole table. `"0"` ⇒ `0`, a
    legitimate target distinct from blank (invariant 14). `"80000"` ⇒ `80000`. `"abc"`, `"-1"` ⇒ a
    field error naming *Target annual income*.
14. **`buildProjectionInput`.** `targetAnnualIncome: "abc"` ⇒ `{ ok: false, errors: {
    targetAnnualIncome: … } }`; blank ⇒ `ok: true`; on success `"targetAnnualIncomeNzd" in value
    === false` — it is not a `ProjectionInput`, same reasoning as `inflationRate`.
15. **`runProjection` wiring.** Toggle on, target `"3800"` ⇒ `crossover` defined,
    `crossover.inflationRate === real.inflationRate`, `netIncomeByYearNzd.length ===
    value.rows.length`. Toggle **off** ⇒ `crossover === undefined` (C3). Toggle on, target blank ⇒
    `crossover === undefined`, `real` still defined, `ok: true`.
16. **One projection.** With the toggle on, `value` `toEqual`s the same form with the target blank
    — a target changes no projection output and triggers no second `project()` call.
17. **UI** (inspection): a *"Target annual income (NZD, today's dollars)"* input defaulting to
    `"80000"`, noted as a placeholder, not a recommendation; a *"Dividend Income Crossover"* tile
    reading *"Year N"* or *"Not reached within N years"*, with a sub-line giving
    `incomeAtCrossoverNzd` or `finalYearNetIncomeNzd` through `formatNzd`; *"First reached in year
    X, but not sustained until year N"* only when the two differ; *"Turn on today's dollars to see
    the crossover year"* when the toggle is off; *"Enter a target annual income…"* when blank; one
    static line that Accumulate/Coast income is reinvested, so the year answers *"if you switched
    to drawing then"*; a **Net dividend income** column, last, only when `crossover` is defined.
    Existing tiles and columns unchanged. No restyling.
18. **Before/after table in `notes.md`** — *Scenario · Target · Crossover (real, today's $) ·
    Crossover (nominal) · Δ years · Why*. Rows: fixture T @ 3,800 (year 4 vs year 1); fixture T @
    5,000 (never vs year 4); and the **UI-default scenario** (100k, 15y, 0 monthly, SCHD seed,
    direct 33%, WHT 15%, phase fields blank, inflation 3%, target 80,000) from an actual run, with
    its real answer, nominal answer and `finalYearNetIncomeNzd`. State the PRD headline:
    `1.03^30 ≈ 2.4273`, so a nominal income figure overstates purchasing power ~2.43× over 30
    years, and the number Fady acts on is the **difference in years**.
19. `pnpm lint` zero warnings · `pnpm build` · `pnpm test` green · `pnpm exec tsc --noEmit` exit 0
    — all four on a **clean checkout of the commit**.

## Out of Scope

- The **tax-mode segmented control**, **presets dropdown**, **capital drawdown**,
  **safe-withdrawal-rate modelling**, **`/retirement`**, charts.
- Inflation-indexed targets or contributions; a per-phase target; solving for the contribution
  needed to hit a target; any change to `project()`'s maths or cash flows.
- A crossover in the nominal view (C3), subtracting fees from income (C2), a "first year exceeding"
  headline (C5).
- Any **restyling**, colour, font or layout change — deferred to a later `/impeccable` pass.
- Editing `lib/nzTax.ts`, `lib/funds.ts`, `data/*`, `app/*`, `types.ts`, `vitest.config.mts`,
  `package.json`. **No new dependency.**

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first.
- **Touch only:** `lib/projection.ts`, `lib/__tests__/projection.test.ts`,
  `components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
  `components/InvestmentProjectionCalculator.tsx`, this slice's `notes.md`.
- **Additive guarantee (AC1).** Put the `git diff` of `lib/projection.ts` in `notes.md` proving a
  pure append. Modify no existing assertion; adding the new field to `makeForm()` is allowed and
  must be disclosed. A failing pre-existing test is a regression in your change — **stop and raise
  a blocker**, likewise if any expected value above disagrees with your arithmetic.
- **Constitution §2:** all crossover logic lives in `findIncomeCrossover`; no income or deflator
  arithmetic in the `.tsx` or in `projectionInputs.ts`, which only picks what to render. **§1:**
  invalid input throws or shows a field error, nothing coerced to 0, blank ≠ `0`, `NaN`/`Infinity`
  never render. Reuse the file's existing validation helpers instead of writing a new check.
- **One `project()` call** per run (AC16) — never re-run the projection to find the year.
- **TDD.** ACs 1–16 are **RED-first, mandatory**: write it, run it alone (`pnpm test -t "<name>"`),
  record the assertion message, then implement. A suite-level import or type error is **not** RED.
  AC17 is exempt: `bin/lean-spec advance --no-tdd`, logging *"jsdom + testing-library are banned
  new deps; all engine and mapper logic is RED-first tested"*.
- **Mutation check in `notes.md`** — mutate your own code, report what died. At least: drop the WHT
  term; drop the `nzTaxPayableNzd` term; subtract `totalFeesNzd`; use `dividendsDrawnNzd`; return
  `firstYearAboveTarget` as `crossoverYear`; `≥` → `>`; start the scan at index 0; scan `rows`
  instead of the real rows; return `0` instead of `null`; drop the target validation.
  **`vitest --reporter=basic` exits non-zero on Vitest 4 whatever the result** — a harness using it
  calls every mutation "killed" and proves nothing; a previous coder made exactly that mistake. Run
  without it, restoring the file between runs.
- TypeScript strict: no `any`, no non-null assertions, no `as` to silence a missing field.
- Comments explain *why* only: why NZ tax is subtracted but fees are not, why the target is real,
  why every phase is scanned, why "sustained" beats "first", why `null` beats `0`.
