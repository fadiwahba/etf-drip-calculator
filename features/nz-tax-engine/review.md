# Review — nz-tax-engine

## Verdict

verdict: NEEDS_FIXES

The engine's maths is **correct**. I re-derived all 12 ACs by hand and ran the code against extra
probe fixtures — every number matches, no wrong number found, no rate stated from memory. What is
missing is test coverage of two contract branches that flip a whole regime, plus one AC11 assertion.
All three fixes are test-only, one line each. **Do not change any number in `lib/nzTax.ts`.**

## Spec Compliance

Gates run by me, not taken from `notes.md`:

```
pnpm test  →  Test Files 1 passed (1) · Tests 18 passed (18)
pnpm lint  →  ✔ No ESLint warnings or errors
pnpm build →  ✓ Compiled successfully · ✓ Generating static pages (6/6)
```

Arithmetic re-derived independently (not read off the assertions):

| AC | My derivation | Code | OK |
|---|---|---|---|
| 1 | 40k ≤ 50k → div; 1,200×0.33=396; credit min(180,396)=180; pay 216; total 396 | same | ✓ |
| 2 | FDR 0.05×200k=10,000; CV 30,000 / 38,000 → min=FDR; 3,300 both | same | ✓ |
| 3 | FDR 10,000; PIE min(0.33,0.28)=0.28→2,800 (1.40%); direct 0.33→3,300 (1.65%) | same | ✓ |
| 4 | CV 205k+1.5k−200k=6,500 < FDR 10,000 → "cv"; 2,145 | same | ✓ |
| 5 | CV 170k+3k−200k=−27k→0; "cv"; gross 0; credit min(450,0)=0; pay 0; total 450 | same | ✓ |
| 6 | FDR 10,000; gross 3,300; credit min(4,000,3,300)=3,300; pay 0; total 4,000 | same | ✓ |
| 7 | cost 45k ≤ 50k despite value 70k → div; 2,100×0.33=693 | same | ✓ |
| 8 | 60k ≤ 100k → div, 594; no override 60k > 50k → fif | same | ✓ |
| 9 | Y1 445.50; Y2 FDR 2,750 < CV 3,600 → 907.50; Y3 FDR 3,100 < CV 6,800 → 1,023 | same | ✓ |
| 10 | all five throw classes present, field named in every message | `nzTax.ts:65-118` | ✓ |
| 11 | all result fields finite | helper `nzTax.test.ts:13-20` | partial, see F3 |
| 12 | 0.05 / 50,000 / 0.28 exported with IRD URL + date | `nzTax.ts:44-63` | ✓ |

Specific checks you asked for, each confirmed by execution:

- **De minimis tests cost, not market value, and is parameterised** — `nzTax.ts:135` reads
  `foreignCostNzd`, never `openingValueNzd`; default `DEFAULT_FIF_DE_MINIMIS_NZD` at `nzTax.ts:126`.
- **FDR = 5% of opening** — `nzTax.ts:148`, opening only.
- **CV formula and floor** — `nzTax.ts:151-157` is `max(0, (closing+div+sales) − (opening+purchases))`.
- **Lower-of + tie** — `nzTax.ts:160-161`. Probe with FDR = CV = 10,000 returned `method: "fdr"`. The
  spec's `max(0, min(fdr, cv))` outer floor is absent in code, but `fdr ≥ 0` and `cv ≥ 0` are both
  guaranteed by validation and the CV floor, so it is provably equivalent. Not a defect.
- **Rates** — `nzTax.ts:132` `min(pir, PIR_CAP)` for PIE, `marginalRate` for direct.
- **WHT credit** — `nzTax.ts:166-170`: capped at the liability, payable floored at 0, no refund,
  `totalTax` keeps the full WHT paid. AC5 (total 450 on zero NZ tax) and AC6 (total 4,000) both hold.
- **Invalid input** — nothing coerced. `?? 0` at `nzTax.ts:99-101,123-126` fires only on `undefined`,
  so an explicit `NaN` still reaches `assertFiniteMoney` and throws (invariant 14 held).
- **No NaN/Infinity escape** — all inputs are validated finite and non-negative before any arithmetic.
  I probed a deliberate float64 overflow (opening 1e308, closing/div 1.5e308): result stayed finite.
- **Tax base (invariant 11)** — FIF rate applies to FDR/CV income, dividend rate applies to dividends,
  and in the FIF regime dividends are only an input to CV, never taxed separately. No crossing.

**Boundary — `cost === threshold`** (you asked explicitly). Code uses `>` (`nzTax.ts:135`), so a cost
of exactly NZ$50,000 stays **below** the threshold → dividend regime. Probe confirms
(`50_000 → dividend/false`, `50_000.01 → fif/true`). This is **the defensible reading**:
`.claude/rules/nz-tax.md` says "≤ NZ$50,000 (de minimis) → FIF does not apply", and the IRD FIF
exemptions page frames it as cost that *did not exceed* $50,000. The spec is **silent** on the exact
tie — flagging it as required. It should be pinned by a test, not left to the next reader (F1).

## Code Quality

Strong. Findings below are test coverage, not correctness.

**F1 (required) — the de minimis boundary has no test.** No fixture uses `foreignCostNzd` exactly
equal to the threshold. This single comparison flips the regime between `dividends × rate` and
`1.65% of value` — the largest behaviour swing in the file, and the branch most likely to be
"tidied" by a future editor. Add a fixture at exactly `50_000` asserting `regime: "dividend"`,
`aboveThreshold: false`, plus the default-threshold case just over it. Keep the current `>`; the
behaviour is right, only the lock is missing.

**F2 (required) — the exact FDR = CV tie has no test.** `spec.md:41` states "Exact tie →
`method: "fdr"`" as part of the contract, and `nzTax.ts:160` implements it with `<=`. Nothing asserts
it, so flipping `<=` to `<` keeps all 18 tests green while silently changing the reported method. Add
a fixture where FDR = CV (e.g. opening 200,000, closing 210,000, dividends 0 → both 10,000) asserting
`method: "fdr"` and taxable 10,000.

**F3 (required) — AC11 is not applied to every valid fixture.** AC11 says the shared helper runs on
every valid fixture; `nzTax.test.ts:181-190` (`withoutOverride`) is the one result object with no
`expectAllFinite(...)` call. One line.

**Non-blocking observations (do not fix in this slice unless the owner asks):**

- `wrapper` is not validated at runtime. A value such as `"PIE"` coming from JSON or UI state falls
  through `nzTax.ts:132` to the `direct` branch and silently returns the marginal rate. Probe:
  `wrapper: "PIE"` → rate 0.33, gross 3,300, no throw. TypeScript blocks it today and AC10 does not
  list it, so it is out of scope here — but it is a Constitution §1 shape ("wrong number, not a
  crash") and worth an AC when the UI starts feeding this engine.
- AC10 tests `NaN`/`Infinity` on two of the numeric fields, not all. I read the validator and the
  remaining fields (`purchasesNzd`, `salesProceedsNzd`, `usWithholdingPaidNzd`, `marginalRate`,
  `fifThresholdNzd`) are all covered by the same code path, so coverage is representative, not thin.
- `resolvePir` (`nzTax.ts:87-92`) duplicates the check already in `validateInput`. The duplication is
  deliberate and correct — it is what removes the need for a `pir!` non-null assertion. Leave it.

**Constitution and rules adherence:** all tax logic in `lib/nzTax.ts` (§2 ✓). Every constant carries
an IRD URL from the Sources list in `.claude/rules/nz-tax.md` plus "Verified 2026-08-06"
(`nzTax.ts:44-63`) — §3 ✓; the three values (5%, 50,000, 28%) match the rules file exactly, and no
other rate is hardcoded (WHT % and marginal bands are arguments, not constants). Deemed return, not
received dividends, is enforced and tested (§5 ✓). Unrounded floats kept (invariant 15 ✓). Comments
explain *why* only, including the PIE fund-level modelling convention (`nzTax.ts:128-131`) and the
unconfirmed Budget 2026 NZ$100,000 proposal (`nzTax.ts:53-55`) — §9 ✓. No `any`, no non-null
assertion, no imports at all, no `Date.now()`, no module-level mutable state.

**Guardrail scope:** commits `a7b9e4f`/`4973816`/`3aee717` touch only `features/nz-tax-engine/*`,
`lib/nzTax.ts` and `lib/__tests__/nzTax.test.ts`. The dirty files in the working tree
(`data/etfs.json`, `data/dividend_portfolio.json`, `components/RetirementAnalysis*.tsx`,
`app/etf-comparison/page.tsx`) have mtimes of 2026-08-06 17:15 and 2025-08-17 — they pre-date this
branch and are not this coder's work. `lib/__tests__/harness.test.ts` was never committed, so its
deletion leaves no diff; consistent with the note.

**TDD evidence is real, not paraphrase.** I rebuilt the tree at the test-only commit `4973816` in a
scratch dir and ran vitest: it reproduced the RED block in `notes.md` verbatim —
`Cannot find package '@/lib/nzTax'`, `Test Files 1 failed (1)`, `Tests no tests`. `git diff 4973816
3aee717 -- lib/__tests__/nzTax.test.ts` is **empty**: not one assertion was altered after RED, so the
tests were not weakened to pass. Caveat worth naming: the RED is a suite-level import failure, which
proves the tests depend on the module but cannot prove each assertion is individually load-bearing —
that is why I re-derived all 12 fixtures by hand above rather than trusting the RED alone. F1 and F2
are exactly the two branches that RED shape cannot protect.
