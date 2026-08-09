# projection-engine

## Scope

Build `lib/projection.ts` — a pure per-year DRIP projection loop — plus hand-computed Vitest fixtures
in `lib/__tests__/projection.test.ts`. It retires audit findings 2, 3, 4, 6, 7, 8, 9, 14 and the
wrong-tax-base half of 1, by making every invariant in `.claude/rules/calculator-invariants.md`
(1–9, 12) a pinned test. No UI.

All money NZD, all rates **decimals 0–1** (percent-shaped input throws). Tax comes only from
`computeAnnualTax`; price growth only from `requirePriceGrowth`. Neither is re-derived here
(Constitution §2).

```ts
export interface ProjectionInput {
  termYears: number;                    // integer >= 1
  compoundingPeriodsPerYear: number;    // integer >= 1 — growth model only
  contributionsPerYear: number;         // integer >= 1 — deposit cadence only
  contributionTiming: "start" | "end";  // required; no default
  initialShares: number;                // >= 0
  initialSharePriceNzd: number;         // > 0
  contributionPerEventNzd: number;      // >= 0, per event (0 = no contributions)
  sharePriceGrowth: number;             // price-only, (-1, 1)
  initialDividendPerShareNzd: number;   // >= 0
  dividendGrowth: number;               // per share, (-1, 1)
  growthBasis: "net-of-expense-ratio" | "gross-of-expense-ratio";
  expenseRatioAnnual: number;           // [0,1); must be 0 when growthBasis is net
  platformFeeAnnualRate: number;        // [0,1) of value, charged yearly
  brokeragePerContributionNzd: number;  // >= 0, per event
  fxSpreadRate: number;                 // [0,1), buy leg, per contribution; 0 for an NZD asset
  usWithholdingRate: number;            // [0,1) — 0.15 with W-8BEN
  wrapper: Wrapper; marginalRate: number; pir?: number; fifThresholdNzd?: number;
}
export function project(input: ProjectionInput): ProjectionResult;
export function projectFund(fund: Fund, rest: Omit<ProjectionInput, "sharePriceGrowth">): ProjectionResult;
export class ProjectionInputError extends Error {}
```

**Year sequence** (t = 1..N; `rows[0]` is a pre-growth opening snapshot with all flows 0):

```
closingPrice = openingPrice × (1 + sharePriceGrowth)            // exactly once per year
openingValue = shares × openingPrice
per event k of C:  f = timing==="start" ? (k-1)/C : k/C
    eventPrice = openingPrice × (1+g)^f
    fx = (perEvent − brokerage) × fxSpreadRate
    invested = perEvent − brokerage − fx ;  shares += invested / eventPrice
divPerShare_t = initialDividendPerShareNzd × (1 + dividendGrowth)^t
grossDividends = shares × divPerShare_t                          // year end, post-contribution shares
usWht = grossDividends × usWithholdingRate ; dripCash = grossDividends − usWht
shares += dripCash / closingPrice
fees = (growthBasis==="gross" ? expenseRatioAnnual : 0) × value + platformFeeAnnualRate × value
shares −= fees / closingPrice                                    // fee drag reduces SHARES
closingValue = shares × closingPrice
purchases = Σ invested + dripCash ;  costBasis += purchases
tax = computeAnnualTax({ openingValueNzd: openingValue, closingValueNzd: closingValue,
      grossDividendsNzd: grossDividends, purchasesNzd: purchases, salesProceedsNzd: 0,
      foreignCostNzd: costBasis, usWithholdingPaidNzd: usWht, wrapper, marginalRate, pir,
      fifThresholdNzd })
shares −= tax.nzTaxPayableNzd / closingPrice                     // WHT already withheld — never totalTax
closingValueAfterTax = shares × closingPrice
```

Stated conventions: growth is applied to the **price**, so purchased shares inherit the remaining
growth automatically; dividends pay once at year end; the tax settlement happens after the closing
valuation (non-circular) and is not a taxable disposal (NZ has no CGT — `nz-tax.md`), so
`salesProceedsNzd` is always 0 and `costBasis` never falls.

Per-year row: `year`, `openingShares`, `closingShares`, `openingSharePriceNzd`,
`closingSharePriceNzd`, `openingValueNzd`, `contributionsGrossNzd`, `contributionsInvestedNzd`,
`brokerageFeeNzd`, `fxSpreadCostNzd`, `expenseFeeNzd`, `platformFeeNzd`, `totalFeesNzd`,
`dividendPerShareNzd`, `grossDividendsNzd`, `usWithholdingNzd`, `dividendsReinvestedNzd`,
`closingValueNzd`, `taxRegime`, `taxMethod`, `aboveThreshold`, `taxableIncomeNzd`,
`nzTaxPayableNzd`, `totalTaxNzd`, `closingValueAfterTaxNzd`, `cumulativeContributionsNzd`,
`costBasisNzd`. Summary: `{ rows, initialInvestmentNzd, totalContributionsNzd, finalValueNzd,
totalFeesNzd, totalTaxNzd, netGainNzd }`. Floats, unrounded (invariant 15); tests use `toBeCloseTo`.

## Acceptance Criteria

Each is one RED test first, observed failing **on its own**. Unless stated, a fixture's unlisted
inputs are zero / `growthBasis: "net-of-expense-ratio"` / `timing: "start"` / `contributionsPerYear: 1`.

1. **N years compounds N times.** 1,000 shares @ 10, g 0.10, term 3, nothing else. `rows.length === 4`;
   `rows[0]` is year 0 with `closingValueNzd 10_000` and every flow 0; `rows[3].closingSharePriceNzd
   === 13.31`, `closingValueNzd === 13_310`. The `year <= term` defect gives **14,641**.
2. **Period rates are geometric, so compounding frequency is not a growth lever.** AC1 fixture run
   with `compoundingPeriodsPerYear` 1, 4, 12, 52 → every row field identical to 10 dp; final 13,310.
   The arithmetic form `annual/periods` at 12 gives ≈ **13,482**.
3. **Deposit cadence never changes the growth model.** g 0.10, term 2, `contributionPerEventNzd 100`,
   `contributionsPerYear` ∈ {1, 4, 12} → `closingSharePriceNzd` (11, 12.10) and `dividendPerShareNzd`
   identical across all three, while `cumulativeContributionsNzd` is 200 / 800 / 2,400. The engine
   never divides an annual amount by a frequency (audit finding 3).
4. **Contribution timing is applied per event, not credited at year start.** 0 initial shares,
   price 100, g 0.21, term 1, `contributionsPerYear 2`, `contributionPerEventNzd 121`.
   `"end"` → buys at 110 and 121 → **2.1** shares, closing **254.10**. `"start"` → buys at 100 and
   110 → **2.31** shares, closing **279.51**. Both contributed 242. Crediting all 242 at year start
   would give 2.42 shares / 292.82 — must not occur.
5. **Price-only growth plus a dividend stream, never both.** `projectFund(getFund("SCHD"), …)` runs
   with `sharePriceGrowth === 0.0912` (0.1237 − 0.0325, derived by `lib/funds.ts` only) and
   `rows[1].closingSharePriceNzd === 10 × 1.0912` for a 10.00 start. `project` never reads
   `totalReturnAnnualised` or `dividendYield`.
6. **Dividend grows per share, not as a yield.** 1,000 shares @ 10, g 0.10, term 3, d0 0.50,
   dividendGrowth 0.20 → `dividendPerShareNzd` = **0.60, 0.72, 0.864**; implied yield
   (`dps / closingPrice`) rises 5.4545% → 5.9504% → 6.4914%; `grossDividendsNzd === closingShares
   after contributions × dps`. The yield-growing defect gives year 3 dps **1.150**.
7. **A net-of-fees return is not charged the expense ratio again.** `growthBasis
   "net-of-expense-ratio"` with `expenseRatioAnnual 0.0006` throws `ProjectionInputError` naming both
   fields; with `0` it runs and every `expenseFeeNzd === 0`. `"gross-of-expense-ratio"` with 0.0006
   charges it.
8. **Fee drag compounds through the share count.** 1,000 shares @ 10, g 0, term 3,
   `growthBasis "gross-of-expense-ratio"`, `expenseRatioAnnual 0.01` → closing values **9,900 /
   9,801 / 9,702.99** (= 10,000 × 0.99^t) and `closingShares` 990 / 980.1 / 970.299. The
   value-only-deduction defect gives 9,700. Fees are charged once, by share reduction only — the
   growth rate is used unmodified.
9. **Brokerage and FX spread are charged on every contribution.** 0 initial shares, price 10, g 0,
   term 1, `contributionsPerYear 4`, `contributionPerEventNzd 1_000`, `brokeragePerContributionNzd
   3`, `fxSpreadRate 0.005`, timing `"end"` → per event fx = (1,000 − 3) × 0.005 = 4.985, invested
   992.015. Row: `brokerageFeeNzd 12`, `fxSpreadCostNzd 19.94`, `contributionsGrossNzd 4_000`,
   `contributionsInvestedNzd 3_968.06`, `closingValueNzd 3_968.06`. With `fxSpreadRate 0` →
   invested 3,988.
10. **Contributions are not returns.** 1,000 shares @ 10, g 0, no dividends, term 2,
    `contributionPerEventNzd 1_000` → `finalValueNzd 12_000`, `totalContributionsNzd 2_000`,
    `netGainNzd === 0`. No summary field is `(final/initial)^(1/N) − 1`.
11. **FIF taxes the opening market value; DRIP is taxed in the year it arises.** 10,000 shares @ 10
    (cost basis 100,000), g 0.10, term 1, d0 0.55, `usWithholdingRate 0.15`, direct, marginal 0.33.
    grossDividends **5,500**; `usWithholdingNzd` **825**; `dividendsReinvestedNzd` **4,675** → +425
    shares; `closingValueNzd` **114,675**; `purchasesNzd` fed to tax **4,675**; `costBasisNzd`
    **104,675**; `taxMethod "fdr"`, `taxableIncomeNzd` **5,000** (5% × 100,000, not of dividends),
    `nzTaxPayableNzd` **825** (1,650 gross − 825 credit), `totalTaxNzd` **1,650**. No cash was
    received, yet tax is owed this year.
12. **Only `nzTaxPayableNzd` is settled from the portfolio.** Same fixture: shares fall by 825/11 =
    **75** to 10,350 and `closingValueAfterTaxNzd === 113_850`. Deducting `totalTaxNzd` would
    double-charge the withholding (113,025) — must not occur.
13. **A reinvested dividend counts as a purchase in the CV base.** Same fixture: CV =
    (114,675 + 5,500 + 0) − (100,000 + 4,675) = **15,500**, so FDR 5,000 is the lower and is chosen.
    Omitting the DRIP from `purchasesNzd` gives CV 20,175 — assert `purchasesNzd` explicitly.
14. **The wrapper is passed through, never re-derived.** AC11 fixture with `wrapper "pie"`,
    `pir 0.33` → `rate 0.28`, gross tax **1,400**, credit 825, `nzTaxPayableNzd` **575**,
    `closingValueAfterTaxNzd` **114,100**.
15. **The de minimis crosses mid-projection and tests cost, not market value.** 4,000 shares @ 10
    (cost 40,000), g 0.10, term 2, `contributionPerEventNzd 6_600`, direct 0.33, no dividends.
    Y1: cost **46,600**, `aboveThreshold false`, `taxRegime "dividend"`, tax 0 — even though
    `closingValueNzd` is **51,260**, already over 50,000. Y2: cost **53,200**, `aboveThreshold true`,
    `"fif"`/`"fdr"`, `taxableIncomeNzd` **2,563** (5% × 51,260), `nzTaxPayableNzd` **845.79**,
    `closingValueAfterTaxNzd` **62,800.21**.
16. **Golden 2-year end-to-end.** 1,000 shares @ 10, g 0.10, term 2, d0 0.50, dividendGrowth 0.10,
    `contributionPerEventNzd 1_100`, timing `"start"`, direct 0.33, no fees, no WHT.
    Y1: buys 110 @ 10 → 1,110 sh; dps 0.55; gross div **610.50**; +55.5 sh; closing **12,820.50**;
    tax **201.465**; after tax **12,619.035** (1,147.185 sh).
    Y2: buys 100 @ 11; dps 0.605; gross div **754.546925**; +62.35925 sh; closing **15,845.485425**;
    tax **249.000485**; after tax **15,596.48494**.
    Summary: contributions **2,200**, `totalTaxNzd` **450.465485**, `netGainNzd` **3,396.48494**.
17. **A missing assumption fails loudly.** `projectFund(getFund("VYMI"), …)` and
    `projectFund(getFund("FDVV"), …)` throw `MissingAssumptionError` from `requirePriceGrowth` — no
    projection, no substituted 0. `project` with `sharePriceGrowth: NaN` throws
    `ProjectionInputError`.
18. **Invalid input throws, nothing is coerced to 0.** `ProjectionInputError` naming the field for:
    any non-finite or negative money field; `initialSharePriceNzd <= 0`; `termYears`,
    `compoundingPeriodsPerYear` or `contributionsPerYear` not a positive integer; a rate outside its
    stated range, including a percent-shaped `12.37` or `33`; `sharePriceGrowth`/`dividendGrowth`
    ≤ −1; `contributionTiming` or `growthBasis` not one of its literals. `TaxInputError` from
    `computeAnnualTax` (e.g. `wrapper "pie"` with no `pir`) propagates unwrapped.
19. **No `NaN`/`Infinity` escapes.** A shared helper asserts `Number.isFinite` on every numeric field
    of every row and of the summary, for all fixtures above plus the degenerate cases: `termYears 1`,
    `initialShares 0`, `contributionPerEventNzd 0`, g 0, d0 0.

## Out of Scope

- **The three-phase model** (`contributionsStopYear`, `drawdownStartYear`, Coast/Draw), **inflation**
  (real vs nominal, purchasing-power column), **crossover reporting**, the **tax-mode segmented
  control**, **presets UI**, charts, and **any component/page/hook wiring**. Later slices.
- Any React/Next import; editing `components/*`, `app/*`, `data/*`, root `types.ts`, `lib/nzTax.ts`
  or `lib/funds.ts`. No rendered number changes this slice, so no before/after comparison applies.
- An FX **rate** and its path (assumed constant, so it cancels; only the spread is a cost), sell-leg
  FX, capped/tiered platform fees, monthly or quarterly dividend accrual, share-count rounding to
  whole shares, capital drawdown, and reducing `costBasisNzd` for the tax-settlement sale
  (a stated conservative convention — cost only rises).
- Re-deriving any tax rule, threshold or `sharePriceGrowth` locally.

## Coder Guardrails

- Read `.claude/rules/calculator-invariants.md` and `.claude/rules/nz-tax.md` first. Every AC number
  above maps to an invariant; the test name must state the invariant it pins.
- **TDD, with per-AC RED evidence.** The previous slice's RED was rejected because a suite-level
  import failure hid the individual failures. Therefore: first commit a `lib/projection.ts` skeleton
  whose exports exist and throw `new Error("not implemented")` so the suite imports cleanly; then,
  for each AC in turn, write its test, run **that test alone** (`pnpm test -t "<name>"`), and record
  the assertion message (expected vs received) in `notes.md` before writing any implementation for
  it. A failure that is an import/type error, not an assertion, does not count as RED.
- Fixtures are hand-computed and the numbers above are the expected values. If one disagrees with
  your arithmetic, **stop and raise a blocker** — do not edit the fixture to match your code.
- Touch only `lib/projection.ts` and `lib/__tests__/projection.test.ts`.
- Pure module: no React/Next, no `Date.now()`, no module-level mutable state, no network, and it must
  not import `data/*.json` itself. It may import types plus `requirePriceGrowth` from `lib/funds.ts`
  and `computeAnnualTax`/`TaxInputError`/types from `lib/nzTax.ts`.
- **One engine per concern** (Constitution §2): no `0.05`, no `50_000`, no `0.28`, no lower-of logic,
  no de minimis comparison in this file — call `computeAnnualTax` and read its result fields.
- Fee drag: reduce the share count **or** fold into the rate, never both (invariant 8). This file
  reduces shares.
- Comments explain *why* only: the contribution-timing convention, the year-end dividend convention,
  why the tax settlement follows the closing valuation, why the DRIP is a purchase for CV, and why
  only `nzTaxPayableNzd` leaves the portfolio.
- `pnpm lint` zero warnings, `pnpm build` succeeds, `pnpm test` green. TypeScript strict; no `any`,
  no non-null assertions on input.
