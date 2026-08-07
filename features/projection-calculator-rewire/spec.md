# projection-calculator-rewire

## Scope

Replace the inline maths in `components/InvestmentProjectionCalculator.tsx` (the component
`app/page.tsx` renders, live at etf-drip-calculator.vercel.app) with a single call to
`project()` from `lib/projection.ts`. The `useMemo` loop over `startBalance / dividends /
growth / expenses / taxes`, and the state keys `returnRate`, `dividendYield` (as used),
`expenseRatio` and `taxRate`, are deleted. Nothing under `lib/` changes.

This retires the live defects: tax at `dividends × 1.4%` (an FDR drag on *portfolio value*
applied to *dividends*, ~100× understated — audit finding 1), an 18% return with a 0.95%
yield added on top (invariant 5), non-compounding fee drag (8), `Number('') → 0` coercion
(14), and a "Total Growth %" that counts deposits as return (12).

**Unit-share convention.** `project()` works in shares; `data/funds.json` publishes neither a
share price nor a dividend per share. The UI therefore uses a synthetic **1 NZD unit**:
`initialSharePriceNzd = 1`, `initialShares = initialCapitalNzd`,
`initialDividendPerShareNzd = dividendYieldDecimal`. The projection is scale-invariant in
price (value = shares × price; every NZD input is absolute), so this loses nothing and
invents no price.

**Where growth comes from.** No preset dropdown this slice. Two editable assumption fields —
**Share price growth (price-only)** and **Dividend yield** — seeded once from
`getFund("SCHD")` (`sharePriceGrowth` 0.0912, `dividendYield` 0.0325, `asOf` 2026-06-30,
`source` shown in the UI). `sharePriceGrowth` is derived only by `lib/funds.ts`; the
component never subtracts a yield from a total return (Constitution §6).

**New input set** (all percent fields entered as percent, converted once):

| Field | Default | Why |
|---|---|---|
| Initial Capital (NZD) | 100000 | kept |
| Investment Term (years) | 15 | kept, integer 1–50 |
| Extra Monthly Contribution (NZD) | 0 | kept |
| Share price growth (% p.a., price only) | 9.12 | SCHD via `lib/funds.ts` |
| Dividend yield (% at start) | 3.25 | SCHD via `lib/funds.ts` |
| Dividend growth (% p.a., per share) | 0 | `dividendGrowth` is `null` on all six funds — 0 is a stated user assumption, labelled as such |
| Wrapper (`NZ PIE` / `US ETF (direct)`) | direct | Fady, Sharesies (PRD) |
| PIR (%) — shown only when wrapper = PIE | 28 | PIR cap, nz-tax.md |
| Marginal tax rate (%) | 33 | Fady (PRD); required by `computeAnnualTax` in both wrappers |
| US withholding (%) | 15 | W-8BEN, NZ–US DTA, nz-tax.md |
| Platform fee (% p.a.) | 0 | engine input; editable 0, not hidden |
| Brokerage per contribution (NZD) | 0 | as above |
| FX spread (%) | 0 | as above |

**Removed fields:** `Expected Return 18%` → replaced by price-only growth (double-counted the
yield). `Expense Ratio 0.26%` → removed; `growthBasis` is fixed to `"net-of-expense-ratio"`
with `expenseRatioAnnual: 0` because the seeded CAGR is already net (invariant 7; the engine
throws otherwise). `Tax Rate on Dividends 1.4%` → removed; replaced by wrapper + PIR/marginal
+ WHT. Fixed conventions, stated as UI text not inputs: `contributionsPerYear: 12`,
`contributionTiming: "start"`, `compoundingPeriodsPerYear: 1`, FIF threshold left at the
engine default.

Pure mapping/validation lives in a new React-free module `components/projectionInputs.ts`
(a `.tsx` cannot be imported by the node-environment Vitest config; no new deps allowed).

## Acceptance Criteria

Each of 1–8 is a RED-first test in `components/__tests__/projectionInputs.test.ts`. 9–15 are
verified by inspection / `pnpm dev`.

1. **No zero-coercion.** `parseNumericField` returns a discriminated result, never a number
   fallback. `""`, `"   "`, `"abc"`, `"-5"` (for a non-negative field), `"1e999"`, a
   non-integer term, and a value outside the field's stated range each return
   `{ ok: false }` with a message naming the field. No input path calls `parseFloat` and
   substitutes `0` (invariant 14).
2. **Percent → decimal exactly once.** `buildProjectionInput` on a fully valid form yields
   `sharePriceGrowth 0.0912`, `dividendGrowth 0`, `marginalRate 0.33`,
   `usWithholdingRate 0.15`, `platformFeeAnnualRate 0`, `fxSpreadRate 0`. No field is divided
   by 100 twice, and no decimal-shaped field is divided at all.
3. **Unit-share convention.** Same call yields `initialSharePriceNzd === 1`,
   `initialShares === 100000`, `initialDividendPerShareNzd === 0.0325`.
4. **Cadence is not multiplied.** `contributionsPerYear === 12`,
   `contributionPerEventNzd === 500` for a 500 monthly input,
   `contributionTiming === "start"`, `compoundingPeriodsPerYear === 1`. The old
   `extraContribution * 12` is gone (invariant 3).
5. **Net basis.** `growthBasis === "net-of-expense-ratio"` and `expenseRatioAnnual === 0`
   for every form state; there is no expense-ratio input to make it otherwise.
6. **Wrapper passthrough.** `wrapper: "pie"` yields `pir` as a decimal (0.28) and
   `marginalRate` still present; `wrapper: "direct"` yields `pir: undefined` — never `0`.
7. **Seeded assumptions carry provenance and never re-derive.** The seed helper called with
   `getFund("SCHD")` returns growth `9.12`, yield `3.25`, plus that row's `asOf` and
   `source`. The module contains no `totalReturnAnnualised - dividendYield` (Constitution §6).
8. **A null assumption is unavailable, not zero.** The seed helper called with
   `getFund("VYMI")` and `getFund("FDVV")` returns an unavailable state: growth field empty
   string, a message naming the ticker and that the assumption is unpublished, and
   `ok: false`. `0` is never substituted. `runProjection` on an unavailable/invalid form
   returns `{ ok: false, errors }` and never calls `project()`.
9. **Engine errors surface verbatim.** `runProjection` wraps `project()` in try/catch and
   returns `{ ok: false, errors: ["<name>: <message>"] }` for `ProjectionInputError`,
   `TaxInputError` and `MissingAssumptionError` (test: force each — e.g. `pir` missing under
   PIE, `sharePriceGrowth` 150%). The component renders that panel and renders **no table and
   no summary numbers**. Nothing is caught silently.
10. **Field errors block the projection.** With any field invalid, the component shows the
    per-field message beneath that input and the panel "Fix the highlighted inputs to see a
    projection"; the table and summary tiles are absent from the DOM, not zero-filled.
11. **The table renders engine rows only.** Same `<table>`/`<thead>`/`<tbody>` structure and
    row striping, columns: Year · Start Balance (`openingValueNzd`) · Contributions
    (`contributionsGrossNzd`) · Gross Dividends (`grossDividendsNzd`) · US WHT
    (`usWithholdingNzd`) · Fees (`totalFeesNzd`) · Regime · Taxable Income
    (`taxableIncomeNzd`) · NZ Tax (`nzTaxPayableNzd`) · End Balance
    (`closingValueAfterTaxNzd`). Row 0 renders with all flows 0. No value is computed in the
    component (Constitution §2).
12. **The regime is disclosed per year.** The Regime cell shows `taxRegime`, `taxMethod` and
    whether `aboveThreshold`, e.g. `FIF · FDR · above $50k` / `Dividend · below` (nz-tax.md,
    non-negotiable 4). With the defaults, year 1 is `FIF · FDR`, not a dividend tax.
13. **Summary tiles come from the result object.** Final Portfolio Value (`finalValueNzd`,
    after tax) · Final-Year Gross Dividends (last row's `grossDividendsNzd`) · Total Tax
    (`totalTaxNzd`) · Net Gain (`netGainNzd`). "Total Growth %" and "4% Withdrawal Income" are
    deleted — the first counted contributions as return (invariant 12), the second is an
    unsourced rule contradicting the dividends-only non-goal.
14. **`NaN`/`Infinity` cannot print.** A `formatNzd` helper returns `"—"` when
    `!Number.isFinite(value)`; every displayed number goes through it (test: `NaN`,
    `Infinity`, `-0`, `1234.5`).
15. **A changed answer is explained.** A persistent notice above the inputs names the three
    removed fields and states that tax now follows FIF/FDR on portfolio value, so results
    differ materially from the previous version. Plain text, existing styles.
16. **Before/after in `notes.md`.** A table with columns *Scenario · Metric · Old · New ·
    Why*, covering the default scenario (100k, 15y, no contributions) at minimum: year-1
    dividends, year-1 tax (old model gives **$13.30**), year-15 final value, plus the same
    three with `wrapper: "pie"`, `pir: 28`. Old figures are captured by **running the current
    loop before deleting it** (scratch script, not committed), not estimated.
17. `pnpm lint` zero warnings · `pnpm build` succeeds · `pnpm test` green ·
    `pnpm exec tsc --noEmit` exit 0. All four — any failure breaks the Vercel deploy.

## Out of Scope

- Tax-mode segmented control and `Compare both`; three-phase model (`contributionsStopYear`,
  `drawdownStartYear`); inflation / real-terms view; crossover reporting; presets dropdown and
  the SCHD-vs-Blend comparison; `/retirement`; charts.
- **Any restyling, font, colour or layout change** — deferred to a later `/impeccable` pass.
  Reuse the existing Card / grid / table markup and class strings.
- Editing `lib/*`, `data/*`, `app/*`, root `types.ts`, other components, `vitest.config.mts`,
  `package.json`. No fund picker. No URL/localStorage persistence.
- Displaying share counts or the synthetic unit price (an internal convention, not a fact).
- Overriding `fifThresholdNzd`, W-8BEN toggle, sell-leg FX, whole-share rounding.

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first.
- **Touch only** `components/InvestmentProjectionCalculator.tsx`,
  `components/projectionInputs.ts` (new), `components/__tests__/projectionInputs.test.ts`
  (new), `features/projection-calculator-rewire/notes.md`.
- **Constitution §2:** `projectionInputs.ts` parses, range-checks and converts units. It
  performs **no projection, fee or tax arithmetic** — no rate, threshold, compounding, `0.05`,
  `50_000`, `0.28`. The only arithmetic allowed is `/100` and the unit-share assignment, each
  with a *why* comment. If you want a number the engine does not return, raise a blocker; do
  not compute it in the component.
- **TDD is relaxed for rendering only.** Advance with
  `bin/lean-spec advance --no-tdd` logging: *"UI slice — rendering needs jsdom +
  testing-library, both banned new deps; all mapping/validation logic is RED-first tested."*
  ACs 1–9 are still RED-first: write the test, run it alone (`pnpm test -t "<name>"`), record
  the assertion message in `notes.md`, then implement. An import/type error is not RED.
- Do **not** import the `.tsx` in a test: Vitest is `environment: "node"` and tsconfig has
  `jsx: "preserve"`.
- Use `project()`, not `projectFund()` — the growth field is user-editable, so a fund object
  would override the edit. Use `getFund` / `isProjectable` / `requirePriceGrowth` only for
  seeding and the null path. Never read `data/etfs.json`.
- Keep the component a client component; keep the `useMemo` (now wrapping `runProjection`),
  and the existing `Input`/`Label`/`Card` imports. Add `Select`/`RadioGroup` only from
  `components/ui/` if already present, else a plain `<select>`.
- Comments explain *why* only: the unit-share convention, the fixed net growth basis, the
  start-of-month contribution convention, why `pir` is `undefined` rather than `0`.
- TypeScript strict: no `any`, no non-null assertions on input, no `as` casts to silence a
  missing field.
