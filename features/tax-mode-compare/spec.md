# tax-mode-compare

## Scope

Append `compareWrappers()` to `lib/projection.ts` — PIE and direct side by side, plus the year the
cheaper wrapper flips — and wire a three-way `NZ PIE` / `US ETFs (direct)` / `Compare both` control,
its conditional inputs and a live one-line explainer into the calculator.

**D0 — pure append.** Every existing function and interface in `lib/projection.ts` gets **zero
edited and zero deleted lines**.

```ts
export const WRAPPER_TIE_EPSILON_NZD = 1e-6; // float64 drift (invariant 15)
export interface WrapperComparisonYear {
  year: number; pieClosingValueAfterTaxNzd: number; directClosingValueAfterTaxNzd: number;
  differenceNzd: number;          // pie − direct, signed
  cheaperWrapper: Wrapper | null; // null === tie
}
export interface WrapperComparison {
  pie: ProjectionResult; direct: ProjectionResult;
  years: WrapperComparisonYear[];  // index === year; [0] always ties
  firstDecisiveYear: number | null; firstDecisiveWrapper: Wrapper | null;
  flipYear: number | null; flipWrapper: Wrapper | null;
  finalDifferenceNzd: number; pieTotalTaxNzd: number; directTotalTaxNzd: number;
}
export function compareWrappers(input: ProjectionInput): WrapperComparison;
```

**D1 — "cheaper" = the bigger pile, not the smaller tax bill.** `cheaperWrapper` ranks
`closingValueAfterTaxNzd` (Fixture P: the PIE's annual bill overtakes at `1.00509ⁿ >
0.0195/0.014`, ≈ year 66, its balance ~39% ahead).

**D2 — flip year.** `firstDecisiveYear` = smallest `y ∈ [1,N]` that is not a tie;
`firstDecisiveWrapper` its winner. `flipYear` = the smallest later `y` that is not a tie and has a
**different** winner. Leaving a tie is not a flip; only the **first** flip is reported. No flip ⇒
`null`, never `0`, `-1` or the last year; all years tied ⇒ all four fields `null`. Tie =
`Math.abs(differenceNzd) <= WRAPPER_TIE_EPSILON_NZD`.

**D3 — `usWithholdingRate` is identical in both runs, never zeroed for the PIE.** A NZ PIE holding
US equities does bear US WHT at fund level; zeroing it flatters the PIE and breaks D4 (AC19).

**D4 — only the wrapper differs.** `compareWrappers` runs `project({ ...input, wrapper: "pie" })`
and `project({ ...input, wrapper: "direct" })`. `input.wrapper` is **ignored**; capital, term,
growth, yield, fees, FX, WHT, phases, `pir`, `marginalRate` and `fifThresholdNzd` pass through
byte-identical, and `input` is not mutated.

**D5 — the flip year is nominal, and deflator-invariant.** `A/(1+i)^t > B/(1+i)^t ⟺ A > B`, so one
shared inflation rate cannot change a year's winner; nominal is chosen because the epsilon tie test
would otherwise move with `i`.

**D6 — the explainer**, one line: the regime (`FIF`/`Dividend`), the method (`FDR`/`CV`/`actual
dividends`), whether cost basis is above or below the de minimis (amount from
`DEFAULT_FIF_DE_MINIMIS_NZD`), and the rate applied — PIR (plus `capped at 28%` when the entered PIR
exceeds `PIR_CAP`) or marginal. It describes year 1 and names the first year `taxRegime` changes.

**Fixtures** — `makeInput` defaults except `initialSharePriceNzd` 10, `sharePriceGrowth` 0.1,
`marginalRate` 0.39, `pir` 0.28, `usWithholdingRate` 0, no fees, no contributions, `dividendGrowth`
0. **P**: `initialShares` 10,000, `initialDividendPerShareNzd` 0, `termYears` 3 — no dividends, so
CV (10%) always beats FDR and `V(t) = V(t−1) × (1.1 − 0.05r)`. **C** = P, `pir` 0.39. **L** = P,
`marginalRate` 0.175. **E** = P, `marginalRate` 0.28. **R**: `initialShares` 4,000,
`contributionsPerYear` 1, `contributionTiming` "end", `contributionPerEventNzd` 4,000,
`initialDividendPerShareNzd` 0, `termYears` 4 — cost basis 40,000/44,000/48,000/52,000/56,000
crosses NZ$50,000 in year 3. **F** = R with no contributions, `initialDividendPerShareNzd` 0.1,
`fifThresholdNzd` **40,802.4** (tuned, not a legal claim) — the runs straddle it in year 2 alone.

## Acceptance Criteria

One RED test each, run alone. 1–11, 19 and 20's data pin append to
`lib/__tests__/projection.test.ts`; 12–15 and 20's explainer pin to
`components/__tests__/projectionInputs.test.ts`. Money: `toBeCloseTo(x, 6)` unless stated.

1. **Pure append, no regression.** `git diff lib/projection.ts` shows appended lines only; all 147
   existing ACs green, with only a mechanical `wrapper` → `taxMode` rename in `makeForm` and its 4
   override sites — no assertion changed.
2. **Fixture P; runs not swapped.** `pie` **108,600 / 117,939.6 / 128,082.4056**; `direct`
   **108,050 / 116,748.025 / 126,146.2410125**; `differenceNzd` **+550 / +1,191.575 /
   +1,936.1645875**; `cheaperWrapper` `"pie"` throughout; `finalDifferenceNzd` **1,936.1645875**;
   `pieTotalTaxNzd` **4,571.5544**, `directTotalTaxNzd` **6,333.5614875**. A swap negates every
   difference. `years.length === rows.length`, `years[i].year === i`, `years[0]` a tie.
3. **PIR cap (Fixture C: `pir` 0.39, `marginalRate` 0.39).** Identical to P — difference
   **1,936.1645875**. Uncapped, both legs are 126,146.2410125 and every year ties.
4. **Ordering reverses at/below 28% (Fixture L).** `direct` **109,125 / 119,082.65625 /
   129,948.9486328125**; differences **−525 / −1,143.05625 / −1,866.5430328125**; `cheaperWrapper`
   `"direct"` every year; `flipYear` `null`.
5. **Exact tie (Fixture E, both rates 0.28).** Every `differenceNzd` **exactly 0** (`toBe(0)`),
   `cheaperWrapper` `null`, all four decisive/flip fields `toBeNull()`, `pieTotalTaxNzd ===
   directTotalTaxNzd`.
6. **De minimis (Fixture R).** No dividends ⇒ a 0 below-threshold tax base ⇒ years 1–2 identical:
   **48,000** then **56,800** in both runs, difference **0**, `taxRegime` `"dividend"`. Year 3
   (`costBasisNzd` **52,000**, `"fif"`): `pie` **65,684.8**, `direct` **65,372.4**, difference
   **312.4**. Year 4: **75,333.6928** vs **74,634.8782**, difference **698.8146**.
   `firstDecisiveYear` **3** (not 1, not 4), `firstDecisiveWrapper` `"pie"`, `flipYear` `null`.
7. **A real flip (Fixture F).** Year 1 (both below 40,802.4, `"dividend"`): **44,288** vs
   **44,244**, difference **+44**, winner `"pie"`. Year 2: `costBasisNzd` **40,802.2181818181818**
   (direct, `aboveThreshold false`) vs **40,802.6181818181818** (pie, `true`, `"fdr"`, taxable
   **2,214.4**); **48,499.38618181818** vs **48,913.75309090909**, difference
   **−414.36690909091**, winner `"direct"`. Years 3–4 (both `"fif"`): **−184.40** then **+91.26**
   (`toBeCloseTo(x, 2)`), winners `"direct"` then `"pie"`. `firstDecisiveYear` **1**, `flipYear`
   **2**, `flipWrapper` `"direct"` — the year-4 reversal is not reported; off-by-one gives 1 or 3.
8. **Deflator-invariant (D5).** Fixture P via `toRealTerms(…, 0.03)`: per-year winners and
   `flipYear` match the `(…, 0)` run; year-3 real values **117,213.545195** (pie) and
   **115,441.680321** (direct) at `toBeCloseTo(x, 3)` — the nominal values ÷ `1.03³ = 1.092727`
   exactly (`103³ = 1,092,727`).
9. **Missing `pir` throws.** `compareWrappers(makeInput({ wrapper: "direct", pir: undefined }))`
   throws `TaxInputError` matching `/pir is required/`, unwrapped — no fallback to `marginalRate`,
   no skipped PIE run.
10. **Only the wrapper varies (D4).** Fixture F: `comparison.pie` `toEqual`s `project({ ...input,
    wrapper: "pie" })` and `comparison.direct` the `"direct"` run; `input` `toEqual`s a clone taken
    before the call; `input.wrapper` `"pie"` vs `"direct"` gives identical output.
11. **No `NaN`/`Infinity`** in any numeric field of `years` or either `ProjectionResult`, for P, L,
    R, F and `makeInput({ termYears: 1, pir: 0.105 })`.
12. **`taxMode` replaces `wrapper`.** `ProjectionFormState.wrapper` is removed for `taxMode: "pie" |
    "direct" | "compare"`. `buildProjectionInput`: `"pie"` ⇒ `wrapper "pie"` + decimal `pir`;
    `"direct"` ⇒ `wrapper "direct"`, `pir` `undefined`; `"compare"` ⇒ `wrapper "direct"` (base run)
    with `pir` **still parsed** (`"28"` ⇒ `0.28`). `"taxMode" in value === false`.
13. **`runProjection`.** `"compare"` ⇒ `comparison` defined, `comparison.direct` `toEqual`s `value`
    (no third `project()` call), `comparison.years.length === value.rows.length`. `"pie"`/`"direct"`
    ⇒ `comparison === undefined`. `"compare"` with `pirPercent: ""` ⇒ `ok: false` carrying
    `TaxInputError: pir is required when wrapper is "pie"` — surfaced, never coerced (invariant 14).
14. **Explainer, single modes.** `formatTaxModeExplainer(form, run)` (new export). UI-default form,
    `"direct"` ⇒ contains `US ETFs (direct)`, `marginal rate 33.0%`, `Year 1`, `FIF`, `FDR`,
    `above`, `$50,000` (from `DEFAULT_FIF_DE_MINIMIS_NZD`, not a literal), `US withholding 15%`.
    `"pie"` + `pirPercent "28"` ⇒ `NZ PIE`, `PIR 28.0%`, not `marginal`; `"30"` ⇒ also `capped at
    28%`. `initialCapital "40000"` + `extraMonthlyContribution "500"` ⇒ `below`, `Dividend`, `actual
    dividends`, and the first `FIF` year. `run.ok === false` ⇒ a fixed line quoting no rate.
15. **Explainer, compare mode.** Contains `NZ PIE`, `US ETFs (direct)`, both rates, `identical
    inputs`, and either the PIE's lead via `formatNzd` with *the cheaper wrapper never changes*, or
    the flip year and the wrapper it flips to. No `NaN`/`Infinity`/`undefined` in any mode.
16. **UI** (inspection, TDD-exempt): a segmented control from `components/ui/tabs.tsx`
    (`Tabs`/`TabsList`/`TabsTrigger`) labelled *NZ PIE* / *US ETFs (direct)* / *Compare both*,
    replacing the wrapper `Select`; PIR shown for `pie`/`compare` only, marginal rate for
    `direct`/`compare` only; the explainer one line under it; in compare mode a block with both
    final values, the difference and the flip year. All else unchanged.
17. **Before/after table in `notes.md`** — *Scenario · Marginal · PIR · PIE final · Direct final ·
    Difference · Flip year*. Rows: **P** (39/28 → 128,082.4056 vs 126,146.2410125, `null`), **L**
    (17.5/28 → 128,082.4056 vs 129,948.9486328125, `null` — the cap is a ceiling, not a discount),
    **F** (flip 2), and the **UI default** (100k, 15y, SCHD seed, 33%, PIR 28%, WHT 15%, inflation
    3%) from a real run. `null` is the usual and correct answer.
18. `pnpm lint` (zero warnings) · `pnpm build` · `pnpm test` · `pnpm exec tsc --noEmit`, all green
    on a **clean checkout of the commit**.
19. **WHT is never zeroed on the PIE leg (D3).** Fixture **W** = P plus
    `initialDividendPerShareNzd` 0.55, `usWithholdingRate` 0.15, `pir` **0.105**, `termYears` 1.
    Both legs: dividends 10,000 × 0.55 = 5,500, `usWithholdingNzd` **825** on both legs' `rows[1]`;
    4,675 reinvested buys 425 shares at 11 → `closingValueNzd` **114,675**; FDR 5% × 100,000 =
    **5,000**, under CV 15,500. PIE: 5,000 × 0.105 = 525, credit capped at 525 → `nzTaxPayableNzd`
    **0**, value **114,675**, `pieTotalTaxNzd` **825**. Direct: 5,000 × 0.39 = 1,950, credit 825 →
    payable **1,125**, value **113,550**, `directTotalTaxNzd` **1,950**, `differenceNzd` **1,125**.
    `pir` 0.105 discriminates: zeroing the PIE's WHT reinvests 5,500 → 115,500 − 525 = **114,975**
    ≠ 114,675. At `pir` 0.28 the credit is uncapped and both give 114,100.
20. **The two labels are pinned by number, not by name.** Fixture L (direct wins every year):
    `pie.rows[1].nzTaxPayableNzd` **1,400** (5,000 × 0.28) vs `direct.rows[1].nzTaxPayableNzd`
    **875** (5,000 × 0.175) — each leg's own rate, so a swap moves both. Explainer:
    `makeForm({ taxMode: "compare", initialCapital: "100000", termYears: "3",
    sharePriceGrowthPercent: "10", dividendYieldPercent: "0", usWithholdingPercent: "0" })` rebuilds
    P and L; `marginalRatePercent` "39" ⇒ the line contains `NZ PIE leads by ` +
    `formatNzd(1_936.1645875)` as **one** substring, "17.5" ⇒ `US ETFs (direct) leads by ` +
    `formatNzd(1_866.5430328125)`. Two mirrored runs, two amounts: a swap misplaces the amount
    either way.

## Out of Scope

- Portfolio presets and the Dividend Blend, a W-8BEN toggle, capital drawdown, safe-withdrawal
  modelling, `/retirement`, charts, a per-year compare table.
- Any change to `project()`, `toRealTerms()`, `findIncomeCrossover()` or the tax maths.
- Editing `lib/nzTax.ts`, `lib/funds.ts`, `data/*`, `app/*`, `types.ts`, `vitest.config.mts`,
  `package.json`, `components/ui/*`. **No new dependency. No restyling** (a later `/impeccable`).

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first.
- **Touch only:** `lib/projection.ts`, `lib/__tests__/projection.test.ts`,
  `components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
  `components/InvestmentProjectionCalculator.tsx`, this slice's `notes.md`.
- **A number you cannot reproduce is a blocker, not a fix.** If an expected value here disagrees
  with your arithmetic, **stop on that AC**: leave its test asserting the spec's number and failing,
  so the disagreement is visible in the suite. Never reconcile it in place, even when you turn out
  to be right — last slice a coder raised the blocker and still wrote the engine's value into the
  test.
- **Constitution §2:** `compareWrappers` calls `project()` twice and does no tax, fee, growth or
  deflator arithmetic; the mapper and `.tsx` format strings only. Import `PIR_CAP` and
  `DEFAULT_FIF_DE_MINIMIS_NZD` from `lib/nzTax`; never restate them, never compute `Math.min(pir,
  PIR_CAP)` outside `computeAnnualTax`. **§1:** invalid input errors, never coerces to 0;
  `TaxInputError` propagates unwrapped; `NaN`/`Infinity` never render.
- **TDD.** ACs 1–15, 19 and 20 are **RED-first, mandatory**: write it, run it alone
  (`pnpm test -t "<name>"`), record the assertion message, then implement. A suite-level import or
  type error is **not** RED.
  AC16 is exempt (`bin/lean-spec advance --no-tdd`; jsdom/testing-library are banned new deps).
- **Mutation check in `notes.md`** — mutate your own code, report what died. At least: swap the two
  runs; zero `usWithholdingRate` on the PIE run; pass `marginalRate` to the PIE run; `flipYear =
  firstDecisiveYear`; report the last flip; shift the year scan by one; return `0` for `null`; treat
  a tie as a flip; rank on `totalTaxNzd`. Default reporter only (**`--reporter=basic` exits non-zero
  on Vitest 4 regardless**). Restore the file between runs.
- TypeScript strict: no `any`, no non-null assertions, no `as`. Comments explain *why* only.
