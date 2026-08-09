# PIE de minimis — wrapper-aware FIF gate

## Scope

Make the FIF de minimis a **direct-holding-only** rule in `lib/nzTax.ts`.

Binding authority: `.claude/rules/nz-tax.md` § "⚠️ The de minimis is a DIRECT-HOLDING rule only —
it never applies to a PIE". A NZ PIE runs the FIF calculation at fund level **from the first
dollar**; there is no cost below which a PIE investor escapes FIF. `docs/PRODUCT-NOTES.md` §1 says
the same. `lib/nzTax.ts:141` (`input.foreignCostNzd > fifThresholdNzd`) ignores `input.wrapper`, so
a sub-$50k PIE is modelled as `regime: "dividend"` and taxed on actual dividends at PIR
(`docs/AUDIT-2026-08-08-fable.md` finding #1).

**Decisions (binding on the implementation):**

1. **Where the gate lives — in `computeAnnualTax`, at the regime decision, not in
   `validateInput`.** The wrapper→regime rule is a modelling rule, not an input error: a PIE under
   $50k is perfectly valid input with a different correct answer. Keeping it beside the existing
   `aboveThreshold` line keeps one place deciding the regime (Constitution §2).
2. **`fifThresholdNzd` with `wrapper: "pie"` is accepted, and is defined as unable to change a
   PIE's tax.** Not silently ignored: it still sets the reported `aboveThreshold` fact, its
   validation still applies, and a test pins the rule. Rejecting it was refused because
   `lib/projection.ts:361` forwards the caller's threshold to **both** legs of `compareWrappers`,
   so a throw would make "compare both wrappers under the proposed $100,000 threshold" impossible,
   and that file is out of scope.
3. **`aboveThreshold` keeps its literal meaning — `foreignCostNzd > fifThresholdNzd` — for both
   wrappers, and no longer implies the regime.** It stays `boolean` (`lib/projection.ts:69` types
   it so, and that file is out of scope). Restated in the `TaxYearResult` doc comment: for a PIE it
   is informational only. This keeps PIE-above-$50k results byte-identical, and makes
   `regime === "fif" && aboveThreshold === false` the discriminator the UI needs.
4. **A PIE is always `regime: "fif"`.** The FDR/CV lower-of selection, the CV floor at zero and the
   exact-tie→`fdr` rule apply to it completely unchanged.

## Before / after (mandatory comparison)

Fixture **PIE-30k** — the audit's live case: `wrapper: "pie"`, `foreignCostNzd` 30,000,
`openingValueNzd` 30,000, `closingValueNzd` 32,700, `grossDividendsNzd` 975 (3.25%), `pir` 0.28,
`marginalRate` 0.33, no WHT.

| Field | Before (shipped) | After (correct) |
|---|---|---|
| `regime` / `method` | `dividend` / `actual-dividends` | `fif` / `fdr` |
| `taxableIncomeNzd` | 975 | 1,500 (5% × 30,000) |
| `rate` | 0.28 | 0.28 |
| `grossTaxNzd` | **273.00** | **420.00** |
| drag on 30,000 | **0.91%** | **1.40%** |

1.40% is the figure `.claude/rules/nz-tax.md` states for a PIR-28% holding. Control — the same
numbers with `wrapper: "direct"`, `marginalRate` 0.33: taxable 975, `grossTaxNzd` **321.75**,
**before === after, unchanged**.

## Acceptance Criteria

All values below are hand-computed. CV = closing + dividends + sales − (opening + purchases),
floored at 0; FDR = 5% × opening; lower of the two, tie → `fdr`.

1. **PIE below the de minimis runs FIF from the first dollar.** Fixture PIE-30k above. Expect
   `regime: "fif"`, `method: "fdr"` (FDR 1,500 ≤ CV 3,675), `aboveThreshold: false`,
   `taxableIncomeNzd` 1,500, `rate` 0.28, `grossTaxNzd` 420, `nzTaxPayableNzd` 420,
   `totalTaxNzd` 420.
2. **The same fixture as a direct holding is untouched.** PIE-30k with `wrapper: "direct"`,
   `marginalRate` 0.33, no `pir`. Expect `regime: "dividend"`, `method: "actual-dividends"`,
   `aboveThreshold: false`, taxable 975, `rate` 0.33, `grossTaxNzd` 321.75, `totalTaxNzd` 321.75.
   Assert AC1's and AC2's `regime` differ **in the same test body** — same inputs, only the wrapper
   differs.
3. **The PIE drag is 1.40% of value, not 0.91% of value.** On PIE-30k assert
   `grossTaxNzd / openingValueNzd` ≈ 0.014 (10 dp) and `grossTaxNzd` ≈ `FDR_RATE * 30_000 * 0.28`.
   Assert it is **not** 273 (= 975 × 0.28), the shipped number.
4. **Boundary — cost exactly at the threshold.** `foreignCostNzd` 50,000, opening 50,000, closing
   54,000, dividends 1,000. Direct (`marginalRate` 0.33): `regime: "dividend"`,
   `aboveThreshold: false`, taxable 1,000, `grossTaxNzd` 330. PIE (`pir` 0.28): `regime: "fif"`,
   `method: "fdr"` (FDR 2,500 ≤ CV 5,000), `aboveThreshold: false`, taxable 2,500,
   `grossTaxNzd` 700.
5. **Boundary — one cent over.** Same fixture with `foreignCostNzd` 50,000.01. Direct: `regime:
   "fif"`, `aboveThreshold: true`, taxable 2,500, `grossTaxNzd` 825. PIE: `regime: "fif"`,
   `aboveThreshold: true`, taxable 2,500, `grossTaxNzd` 700 — **identical to AC4's PIE**, while
   direct jumps 330 → 825. Assert both facts.
6. **PIE above the de minimis is byte-identical (regression pin).** `wrapper: "pie"`, cost 200,000,
   opening 200,000, closing 240,000, dividends 8,000, `pir` 0.28, `usWithholdingPaidNzd` 1,000.
   Expect `regime: "fif"`, `method: "fdr"`, `aboveThreshold: true`, taxable 10,000, `rate` 0.28,
   `grossTaxNzd` 2,800, `foreignTaxCreditNzd` 1,000, `nzTaxPayableNzd` 1,800, `totalTaxNzd` 2,800.
7. **Direct holdings at every size are byte-identical (regression pin).** Three fixtures, values
   copied from the current suite: (a) cost 40,000, dividends 1,200, marginal 0.33, WHT 180 →
   taxable 1,200, gross 396, credit 180, payable 216, total 396; (b) cost 200,000, opening 200,000,
   closing 230,000, dividends 0, marginal 0.33 → `fif`/`fdr`, taxable 10,000, gross 3,300;
   (c) cost 60,000 with `fifThresholdNzd: 100_000`, dividends 1,800, marginal 0.33 → `dividend`,
   gross 594.
8. **`fifThresholdNzd` cannot change a PIE's tax (decision 2).** Run PIE-30k three ways: no
   threshold, `fifThresholdNzd: 100_000`, `fifThresholdNzd: 10_000`. All three give `regime:
   "fif"`, `method: "fdr"`, taxable 1,500, `grossTaxNzd` 420. `aboveThreshold` is `false`, `false`,
   `true` respectively. Validation is not skipped: `fifThresholdNzd: 0` with `wrapper: "pie"` still
   throws `TaxInputError` matching `/fifThresholdNzd/`.
9. **Lower-of FDR/CV still applies to a PIE below the threshold (decision 4).** (a) Losing year —
   cost 30,000, opening 30,000, closing 24,000, dividends 900, `pir` 0.28, WHT 135: CV =
   max(0, −5,100) = 0 < FDR 1,500 → `method: "cv"`, taxable 0, `grossTaxNzd` 0,
   `foreignTaxCreditNzd` 0, `nzTaxPayableNzd` 0, `totalTaxNzd` 135. (b) Exact tie — cost 30,000,
   opening 30,000, closing 31,500, dividends 0: FDR 1,500 = CV 1,500 → `method: "fdr"`, taxable
   1,500, `grossTaxNzd` 420.
10. **A projection crossing $50k mid-run diverges by wrapper.** Three independent calls, costs
    45,000 → 52,000 → 60,000; y1 opening 45,000 / closing 49,500 / dividends 1,350 / purchases 0;
    y2 opening 55,000 / closing 62,000 / dividends 1,600 / purchases 5,000; y3 opening 62,000 /
    closing 70,000 / dividends 1,800 / purchases 3,000. Direct (0.33) regimes
    `["dividend","fif","fif"]`, gross tax 445.50 / 907.50 / 1,023. PIE (0.28) regimes
    `["fif","fif","fif"]`, taxable 2,250 / 2,750 / 3,100, gross tax 630 / 770 / 868. Assert the
    PIE's y1 tax is 630 and **not** 378 (= 975 × 0.28 shape of the old path: 1,350 × 0.28).
11. **No UI text claims a de minimis outcome a PIE never got.** (a) `formatSingleModeExplainer`
    with `wrapper: "pie"` must not contain "above the $50,000 de minimis" or "below the $50,000 de
    minimis"; it must state that FIF applies from the first dollar and that the de minimis is a
    direct-holding rule. Assert the `"direct"` line keeps its existing wording unchanged. (b) A row
    with `taxRegime: "fif"` and `aboveThreshold: false` must not render "above $50k" in the year
    table's regime cell (today `formatRegimeCell`, `InvestmentProjectionCalculator.tsx:64-69`,
    prints `FIF · FDR · above $50k` — flatly false for a $30k PIE). Move that cell's string logic
    into an exported helper in `components/projectionInputs.ts`, call it from the component, and
    test the helper — do not import the `.tsx` into a node-env test. Direct rows keep their exact
    current strings.

## Out of Scope

- `lib/projection.ts`, `lib/funds.ts`, `data/*`, and every other engine or component.
- Changing the PIE rate-substitution convention, the PIR cap, the WHT credit, FDR/CV maths, or the
  `DEFAULT_FIF_DE_MINIMIS_NZD` value.
- The Budget 2026 $100,000 proposal — still UNCONFIRMED, still a parameter defaulting to $50,000.
- The other audit findings (dividend-growth default, Compare card units, income conventions,
  cost defaults). Any styling, new dependency, or new UI control.

## Coder Guardrails

- **Files:** `lib/nzTax.ts`, `lib/__tests__/nzTax.test.ts`, and — for AC11 only —
  `components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
  `components/InvestmentProjectionCalculator.tsx`. **Nothing else.**
- **Expected blocker, do not work around it.** `lib/__tests__/projection.test.ts` pins the *wrong*
  behaviour and is **out of scope**: AC6 (Fixture R) asserts `comparison.pie.rows[1].taxRegime ===
  "dividend"` at a $40,000 cost, and AC7 (Fixture F, `fifThresholdNzd: 40_802.4`) asserts the same
  plus exact after-tax values. Both must fail after this change; others may too. Run the full suite,
  enumerate every failing assertion with its old and new value, and **stop and raise a blocker**.
  Do not edit, weaken, skip or delete that file, and do not "fix" it by softening `lib/nzTax.ts`.
- **Arithmetic disagreements are blockers, never silent edits.** If your own calculation disagrees
  with any expected value in this spec, leave the test asserting the **spec's** number, let it fail,
  and raise a blocker naming both figures. Never reconcile in place, even when you are right. This
  has gone wrong twice.
- **TDD, RED-first.** Every AC is one test, observed failing **individually** for the right reason
  before any `lib/nzTax.ts` edit. A suite-level import error is not a RED. AC6 and AC7 are
  regression pins and **cannot** RED — run them green on the pre-change code and green again after,
  record both runs in `notes.md`, and do not contrive a failure.
- **`vitest --reporter=basic` exits non-zero on Vitest 4 regardless of result.** A harness using it
  proves nothing about RED or GREEN. Use the default reporter and read the pass/fail counts.
- Constitution §2 — the gate lives only in `lib/nzTax.ts`; no component or engine may re-derive it.
  Constitution §3 / nz-tax.md non-negotiable 3 — cite the IRD source and the date beside any rate or
  threshold you touch. §9 — comments explain *why*.
- Invariant 14 — invalid input throws `TaxInputError` naming the field; never coerce. Invariant 13 —
  no `NaN`/`Infinity` in any returned field; call the suite's `expectAllFinite` on every new fixture.
- All 21 existing ACs in `lib/__tests__/nzTax.test.ts` must stay green untouched.
- Quality bars on a clean checkout of the commit: `pnpm lint` (zero warnings), `pnpm build`,
  `pnpm test`, `pnpm exec tsc --noEmit`.
