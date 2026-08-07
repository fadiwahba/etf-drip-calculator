# Review — projection-engine

## Verdict

verdict: NEEDS_FIXES

The engine's arithmetic is correct. I re-derived AC1, AC4, AC6, AC8, AC9, AC10, AC11–AC15 and the
full AC16 two-year golden by hand and every field matches to the digit. The four gates pass. What
fails is **test strength on the one AC that guards the CV base**: AC13 as written cannot fail when
the DRIP is dropped from `purchasesNzd`, which is the exact defect it exists to catch. Two fixable
findings (F1, F3) are spec gaps; F2 is a live wrong-number risk the ACs do not cover.

### Gates (run by me, real output)

```
$ pnpm test
 Test Files  3 passed (3)
      Tests  56 passed (56)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm exec tsc --noEmit
(no output, exit 0)

$ pnpm build
 ✓ Compiled successfully
 ✓ Generating static pages (7/7)
Route (app): / 4.01 kB · /etf-comparison 68.6 kB · /retirement 11 kB
```

## Spec Compliance

Arithmetic re-derived independently (not read off the tests):

- **AC16 golden, end to end.** Y1: buy 1,100 @ 10 → 1,110 sh; dps 0.5×1.1 = 0.55; gross div 610.50;
  +610.50/11 = 55.5 sh → 1,165.5; closing 12,820.50; cost 10,000+1,710.50 = 11,710.50 < 50,000 →
  dividend regime → tax 610.50×0.33 = **201.465**; shares −18.315 → 1,147.185; after tax
  **12,619.035**. Y2: +1,100/11 = 100 sh → 1,247.185; dps 0.605; gross **754.546925**; +62.35925 sh;
  closing **15,845.485425**; tax **249.00048525**; after tax **15,596.48493975**. Summary tax
  **450.46548525**, netGain **3,396.48493975**. All match `lib/projection.ts:202-343`.
- **AC11–AC14.** FDR 5%×100,000 = 5,000; CV = 114,675+5,500−(100,000+4,675) = 15,500 → FDR lower;
  gross 1,650, credit 825, payable 825, totalTax 1,650; shares −825/11 = 75 → 10,350; after tax
  113,850. PIE at PIR 0.33 → capped 0.28 → 1,400 − 825 = **575** → 114,100. Correct.
- **AC15.** Y1 cost 46,600 (below) while market value is 51,260 (above) → tax 0 — the threshold
  really tests cost. Y2 cost 53,200 → FIF; FDR 2,563 vs CV 63,646−(51,260+6,600) = 5,786 → FDR;
  845.79; after tax 62,800.21. Correct.
- **AC4.** `100 × 1.21^0.5 = 110` exactly, so end→2.1 sh / 254.10 and start→2.31 sh / 279.51. The
  intra-year interpolation at `lib/projection.ts:232` is geometric, not arithmetic.
- **Off-by-one, geometric rates, cadence independence.** `for (let year = 1; year <= termYears; …)`
  (`projection.ts:212`) with a no-growth year-0 row (`167-200`) compounds exactly N times. No
  `annualRate / periods` form exists anywhere in the file (grepped). `compoundingPeriodsPerYear` is
  validated (`projection.ts:125`) and then never touches the growth maths — AC2 therefore passes by
  construction, but it stays a real regression guard if anyone reintroduces periodic compounding.
- **Dividend per share** (`projection.ts:245`) is `d0 × (1+g)^t`, applied to post-contribution shares
  (`247`); no yield is grown. **Fee drag** reduces shares only (`261`), so year N+1's opening value
  carries year N's fees — 10,000 × 0.99^t confirmed. **Only `nzTaxPayableNzd` leaves the portfolio**
  (`288`). **`netGainNzd` subtracts initial + cumulative contributions** (`330`).
- **Boundaries all clean.** Commit `878c393` touches exactly `lib/projection.ts`,
  `lib/__tests__/projection.test.ts`, `features/projection-engine/notes.md` — `components/*` and
  `app/*` untouched. No tax constant, threshold or lower-of logic in the file; every year routes
  through `computeAnnualTax` (`271-283`). No `data/*.json` import. Price growth only via
  `requirePriceGrowth` (`352`); SCHD 0.1237 − 0.0325 = 0.0912 comes from `lib/funds.ts:258-261`, and
  VYMI (null yield) / FDVV (null total return) both throw `MissingAssumptionError`, tested at
  `projection.test.ts:512-513`.

### F1 — AC13 does not pin what it claims (must fix)

`lib/__tests__/projection.test.ts:381-399` proves the cost-basis line, not the CV base. I ran the
mutation: change `lib/projection.ts:275` `purchasesNzd: purchases` → `purchasesNzd:
contributionsInvested` (DRIP dropped from the CV base, `costBasis += purchases` at `269` left alone)
and **all 19 tests still pass**. The fixture cannot discriminate: FDR 5,000 is lower whether CV is
15,500 or 20,175. Spec AC13 is explicit — "assert `purchasesNzd` explicitly". The coder's
decision 2 (costBasis delta as a proxy) is arithmetically valid but loses exactly the detection
power the AC was written for.

Fix — do both:
1. Add `purchasesNzd` to `ProjectionRow` (spec pseudocode already computes it) and assert it is
   4,675, not 0.
2. Add a fixture where the FDR/CV choice flips on the DRIP. 10,000 sh @ 10, **`sharePriceGrowth`
   −0.01**, term 1, d0 0.55, WHT 0.15, direct 0.33: closing price 9.90, +4,675/9.9 = 472.2222 sh,
   closing value **103,675**, cost 104,675 (above threshold). CV *with* the DRIP in purchases =
   103,675 + 5,500 − (100,000 + 4,675) = **4,500** < FDR 5,000 → `taxMethod "cv"`,
   `taxableIncomeNzd` 4,500, `nzTaxPayableNzd` 660, `totalTaxNzd` 1,485. Omitting the DRIP gives
   CV 9,175 → `"fdr"` / 5,000. That assertion kills the mutation.

### F2 — the fee base is unpinned (fix; no AC covers it)

`lib/projection.ts:256-259` charges the expense ratio and platform fee on the post-DRIP closing
value. AC8's fixture has g = 0 and no dividends, so opening value and post-DRIP value are equal.
Mutation: `const valueBeforeFees = openingValue;` → **all 19 tests pass**. In a real run (10% growth
plus a reinvested dividend) that mutation understates fees by more than 10% every year and
compounds. Add one assertion on `expenseFeeNzd` / `platformFeeNzd` in a fixture with growth *and* a
dividend, and state the chosen base in the comment at `256`.

### F3 — AC19 covers 3 of 16 fixtures

Spec AC19: "for all fixtures above plus the degenerate cases". `projection.test.ts:557-593` runs the
AC1, AC16 and AC15 fixtures plus one degenerate default. The AC11/AC14 tax paths, the AC9
brokerage/FX path and the AC8 fee path are never finiteness-checked. Extract the fixtures to consts
and loop `assertAllFinite` over all of them.

On the coder's AC19 RED admission: **acceptable as stated.** A finiteness guard genuinely cannot go
RED against an all-zero stub, and seeding NaN into the stub would test the test. The real risk AC19
carries is not a missing NaN but a *vacuous helper* — and I checked: `NUMERIC_ROW_FIELDS`
(`test:43-68`) lists all 24 numeric fields of `ProjectionRow` (`projection.ts:32-60`) and
`NUMERIC_SUMMARY_FIELDS` all 6 of `ProjectionResult` (`62-70`), so it is complete today. It will
silently stop covering any field added later. Deriving the list at runtime
(`Object.entries(row).filter(([, v]) => typeof v === "number")`) removes that decay and, as a bonus,
would have gone RED against the stub (missing rows/fields). Recommended, not required.

### Minor spec gaps (fix if cheap)

- `projection.test.ts:151-152` — AC3 asserts `dividendPerShareNzd ≈ 0` across cadences, vacuous
  because d0 = 0 in that fixture. Set d0 > 0 so the "dividends identical across cadences" claim
  means something.
- `projection.test.ts:98-101` — AC1's "every flow 0" checks 4 of the ~14 flow fields on `rows[0]`.
  Loop the field list.

## Code Quality

**The three self-declared decisions.**

1. `closingShares` = post-tax — **defensible.** It is the only reading under which `closingShares`
   becomes next year's `openingShares` consistently, and
   `closingValueAfterTaxNzd = closingShares × closingSharePriceNzd` holds. Caveat for the UI slice:
   within a row `closingValueNzd ≠ closingShares × closingSharePriceNzd`, so any component that
   recomputes value from the share count silently gets the after-tax figure. Worth a column comment.
2. `purchasesNzd` via the `costBasisNzd` delta — **defect**, see F1. The identity is right; using it
   *instead of* an explicit assertion is what breaks the AC.
3. Summary composition — **both defensible.** `totalTaxNzd` including US WHT is coherent: the WHT
   really did leave the portfolio (it reduced the DRIP at `projection.ts:251`), so tax-borne
   reconciles with `netGainNzd`. `totalFeesNzd` excluding brokerage/FX is arithmetically right —
   those are already netted out of `contributionsInvestedNzd`, so adding them would double-report.
   But the *name* will mislead: invariant 9 exists to surface the FX spread, and a headline "total
   fees" that hides it is the wrong default for a UI. Next slice should either rename it
   (`totalRecurringFeesNzd`) or add a sibling `totalTransactionCostsNzd`. Not a blocker here.

**Mutation testing.** I mutated `lib/projection.ts` in place, ran the suite, and restored from HEAD
(working tree verified clean afterwards). 10 of 12 mutations are killed: off-by-one → AC1/2/3/10/16;
fee-deducted-from-value-only → AC8; settling `totalTaxNzd` → AC12/AC14; growing the yield instead of
the per-share dividend → 6 tests; dividends on opening shares → AC16; `costBasis` without the DRIP →
AC11/AC13; `netGain` ignoring contributions → AC10/AC16; FX spread on gross → AC9; opening value at
the closing price → 5 tests; arithmetic `1 + g·f` interpolation → AC4. The two survivors are F1
and F2. No assertion looks weakened to reach green — the expected values in the tests are the
spec's hand-computed numbers, verbatim, and I re-derived them independently.

**TDD evidence — the claim of reproducibility is false.** `notes.md:109-112` says the full
18-failure transcript is "reproducible from git history of `lib/projection.ts` before the
implementation commit". There is no such commit: `git log --all -- lib/projection.ts` returns
exactly one commit (`878c393`), and there is no stash or other branch holding a stub. The
stub-first guardrail (`spec.md:186-189`, "first commit a `lib/projection.ts` skeleton") was not
followed, so the RED state cannot be re-run. The excerpts shown *are* genuine per-assertion
mismatches, not an import failure, so the substance of the "no suite-level RED" rule is met — but
the process differed from the letter (all 19 tests written, then one suite run, rather than
`pnpm test -t` per AC before implementing it), and the AC4 excerpt is a `TypeError` on an undefined
row rather than an assertion. **Fix:** correct that sentence in `notes.md` — either paste the full
18-failure output you actually observed, or state plainly that the stub was never committed and the
transcript is excerpt-only. Do not leave a claim in the record that a future reader cannot check.

**Other observations.**

- `projection.ts:188-198` — the year-0 row carries placeholder tax labels (`taxRegime "dividend"`,
  `aboveThreshold false`) even when the opening cost is well above the de minimis. Documented, and
  harmless to the maths, but a UI badge reading `rows[0]` would state the wrong regime. Consider
  making those fields optional on year 0 rather than asserting a false one.
- Validation (`projection.ts:79-163`) is thorough and fails loudly; nothing is coerced to 0.
  Leaving `wrapper`/`marginalRate`/`pir` to `computeAnnualTax` so `TaxInputError` propagates
  unwrapped is the right call under Constitution §2, and `test:545-552` pins it.
- Comments explain *why* throughout (timing convention, year-end dividend, why tax follows the
  closing valuation, why the DRIP is a purchase, why only `nzTaxPayableNzd` leaves). Constitution §9
  satisfied. TypeScript strict, no `any`, no non-null assertions on input.
