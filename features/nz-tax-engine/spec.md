# nz-tax-engine

## Scope

Build `lib/nzTax.ts`: the single shared NZ tax engine, as a pure function over one tax year, plus
hand-computed Vitest fixtures in `lib/__tests__/nzTax.test.ts`. It retires audit findings 1, 5 and 11
by giving every future caller one authoritative answer. Nothing is wired to the UI this slice.

The engine decides, per year: FIF vs ordinary-dividend regime (de minimis on **cost**, parameterised,
NZ$50,000 default); FDR at 5% of opening market value; Comparative Value as the alternative with
**lower-of** selection; rate = PIR capped at 28% for a PIE wrapper, marginal rate for a direct
holding; US withholding credited against the NZ liability and capped at it. Threshold crossing falls
out of the per-year call: the caller loops, each year decides independently.

Contract (exported from `lib/nzTax.ts`; all money NZD, all rates **decimals 0–1**, never percent):

```ts
type Wrapper = "pie" | "direct";
interface TaxYearInput {
  wrapper: Wrapper;
  foreignCostNzd: number;        // highest total cost of foreign holdings during the year
  openingValueNzd: number; closingValueNzd: number; grossDividendsNzd: number;
  purchasesNzd?: number;         // default 0   } CV inputs
  salesProceedsNzd?: number;     // default 0   }
  marginalRate: number; pir?: number;           // pir required when wrapper === "pie"
  usWithholdingPaidNzd?: number; // default 0
  fifThresholdNzd?: number;      // default DEFAULT_FIF_DE_MINIMIS_NZD
}
interface TaxYearResult {
  regime: "fif" | "dividend"; method: "fdr" | "cv" | "actual-dividends";
  aboveThreshold: boolean; taxableIncomeNzd: number; rate: number;
  grossTaxNzd: number; foreignTaxCreditNzd: number;
  nzTaxPayableNzd: number;       // grossTax − credit, floored at 0
  totalTaxNzd: number;           // nzTaxPayable + usWithholdingPaid
}
function computeAnnualTax(input: TaxYearInput): TaxYearResult;
class TaxInputError extends Error {}
```

`CV = (closing + dividends + sales) − (opening + purchases)`, floored at 0.
`fifIncome = max(0, min(fdr, cv))`. Exact tie → `method: "fdr"`. Results are unrounded floats
(invariant 15); tests use `toBeCloseTo`.

## Acceptance Criteria

Each AC is one RED test first. Test names must state the IRD rule encoded.

1. **De minimis — below threshold, actual dividends taxed.** cost 40,000; dividends 1,200; direct;
   marginal 0.33; WHT paid 180 → `regime "dividend"`, `method "actual-dividends"`,
   `aboveThreshold false`, taxable 1,200, gross 396, credit 180, payable **216**, total 396.
2. **FDR taxes a deemed return, not received dividends.** opening 200,000; closing 230,000; direct
   0.33; cost 200,000. With dividends 0 **and** with dividends 8,000 the result is identical:
   `method "fdr"`, taxable **10,000**, gross **3,300**. (Constitution §5.)
3. **Wrapper decides the rate; PIR caps at 28%.** opening 200,000, closing 240,000, dividends 0,
   cost 200,000. `wrapper "pie"` with `pir 0.33` → rate **0.28**, gross **2,800** (1.40% of value);
   same year `wrapper "direct"`, marginal 0.33 → rate 0.33, gross **3,300** (1.65%).
4. **CV is used when it is lower than FDR.** opening 200,000; closing 205,000; dividends 1,500;
   purchases 0; direct 0.33; cost 200,000 → CV 6,500 < FDR 10,000 → `method "cv"`, taxable 6,500,
   gross **2,145**.
5. **CV floors at zero — no FIF tax in a losing year.** opening 200,000; closing 170,000; dividends
   3,000; WHT paid 450; direct 0.33 → `method "cv"`, taxable **0**, gross **0**, credit **0**,
   payable **0**, total 450. A credit never produces a refund.
6. **US WHT is credited against the FIF liability and capped at it.** opening 200,000; closing
   240,000; dividends 8,000; direct 0.33; WHT paid 4,000 → gross 3,300, credit **3,300**, payable
   **0** (never negative), total **4,000**.
7. **The de minimis tests cost, not market value.** cost 45,000 with opening/closing value 70,000;
   dividends 2,100; direct 0.33 → `regime "dividend"`, gross **693**.
8. **The threshold is a parameter.** cost 60,000, dividends 1,800, direct 0.33, `fifThresholdNzd
   100_000` → `regime "dividend"`, gross **594**. Same input without the override → `regime "fif"`.
9. **Threshold crossing is decided year by year.** Three independent calls, direct 0.33, WHT 0:
   Y1 cost 45,000, dividends 1,350 → `"dividend"`, gross **445.50**;
   Y2 cost 52,000, opening 55,000, closing 62,000, dividends 1,600, purchases 5,000 → `"fif"`,
   `"fdr"` (FDR 2,750 < CV 3,600), gross **907.50**;
   Y3 cost 60,000, opening 62,000, closing 70,000, dividends 1,800, purchases 3,000 → `"fif"`,
   `"fdr"` (3,100 < CV 6,800), gross **1,023**.
10. **Invalid input fails loudly.** `computeAnnualTax` throws `TaxInputError` (message naming the
    field) for: `NaN`/`Infinity` in any numeric field; negative money field; `marginalRate` or `pir`
    outside 0–1; `wrapper: "pie"` with `pir` undefined; `fifThresholdNzd` ≤ 0. Nothing is coerced to
    0 (invariant 14).
11. **No `NaN`/`Infinity` escapes.** For every valid fixture above, each numeric field of
    `TaxYearResult` is finite (`Number.isFinite`) — assert it in a shared helper (invariant 13).
12. **Cited constants are exported.** `FDR_RATE === 0.05`, `DEFAULT_FIF_DE_MINIMIS_NZD === 50_000`,
    `PIR_CAP === 0.28`, each declared with an IRD URL and the date checked in a comment beside it.

## Out of Scope

- Any React, component, page, hook or UI wiring. No rendered number changes, so **no before/after
  comparison applies** to this slice.
- The projection loop, DRIP, fees, FX rate/spread, brokerage, inflation, contribution scheduling.
- Editing `data/etfs.json`, `data/dividend_portfolio.json` (next slice) or root `types.ts`.
- FIF methods other than FDR and CV (cost, deemed rate of return, attributed FIF income).
- Quick-sale adjustments, the ASX-listed share exemption, imputation/franking credits, RWT/NRWT,
  CGT/trader intent, second jurisdictions, filing-grade rounding.
- Deciding the caller's `foreignCostNzd`, FX conversion, or where W-8BEN status comes from — all are
  arguments.

## Coder Guardrails

- Read `.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` first. Every rate and
  threshold must trace to the former. **Never state a rate from memory** — cite the IRD URL from its
  Sources list plus the date checked (2026-08-06 verification stands).
- **TDD is mandatory.** One failing test per AC before any implementation. Fixtures are hand-computed
  and the numbers above are the expected values — if one disagrees with your reading of the rule,
  stop and raise it as a blocker rather than changing the fixture to match your code.
- Touch only `lib/nzTax.ts` and `lib/__tests__/nzTax.test.ts`. You may delete
  `lib/__tests__/harness.test.ts` (it says to, once a real calculation test exists). Nothing else.
- Pure engine: no imports from `data/*`, no React/Next, no I/O, no `Date.now()`, no module-level
  mutable state. Numbers arrive as arguments.
- Rates are decimals. A percent-shaped input (e.g. `33`) must throw, not silently multiply by 33x —
  this is the shape of audit finding 1.
- Tax base discipline (invariant 11): FDR/CV rates apply to **income derived from value**; the
  dividend rate applies to **dividends**. Never cross them.
- Comment the *why* only: the IRD rule, the lower-of tie-break, the CV floor, and one note on the PIE
  modelling convention (a PIE does the FIF calc at fund level; we model it as the investor-rate
  substitution the rules file specifies) plus the unconfirmed NZ$100,000 2026–27 proposal.
- `pnpm lint` zero warnings, `pnpm build` succeeds, `pnpm test` green before close. TypeScript strict;
  no `any`, no non-null assertions on input.
