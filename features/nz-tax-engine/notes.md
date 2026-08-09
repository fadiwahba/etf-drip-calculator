## What was built

`lib/nzTax.ts` — the single shared NZ tax engine, a pure function `computeAnnualTax(input):
TaxYearResult` over one tax year, matching the spec's contract exactly. `lib/__tests__/nzTax.test.ts`
has one hand-computed Vitest fixture per acceptance criterion (18 tests, AC1-AC12; several ACs need
more than one `it` to cover both the happy path and the shared finite-result assertion).

Verified all 12 spec-fixture numbers against `.claude/rules/nz-tax.md` by hand before writing any
code — no disagreement found, no blocker to raise.

Decisions:

- **Regime/method decision** — `aboveThreshold = foreignCostNzd > fifThresholdNzd` (strictly
  greater; a cost exactly at the threshold stays in the de minimis "dividend" regime, matching
  nz-tax.md's "≤ NZ$50,000 (de minimis)" wording). Below/at threshold → `regime: "dividend"`,
  `method: "actual-dividends"`, taxable = `grossDividendsNzd`. Above → `regime: "fif"`,
  `taxableIncomeNzd = max(0, min(FDR, CV))`, `method` picks `"fdr"` on an exact tie per spec.
- **Rate** — `wrapper === "pie"` → `min(pir, PIR_CAP)`; `"direct"` → `marginalRate`. Applied
  uniformly whether the year lands in the dividend or FIF regime (the spec header states this as a
  general wrapper→rate rule, not regime-scoped, and no AC contradicts it).
- **CV** — `max(0, (closing + dividends + sales) − (opening + purchases))`, exactly the spec
  formula; floors at zero so a losing year produces $0 FIF tax (nz-tax.md).
- **US WHT credit** — `foreignTaxCreditNzd = min(usWithholdingPaidNzd, grossTaxNzd)` (capped at the
  liability, never a refund). `totalTaxNzd = nzTaxPayableNzd + usWithholdingPaidNzd` — the *full*
  amount paid to the US, not just the credited portion, per the spec's `TaxYearResult` comment and
  confirmed by AC6 (WHT paid 4,000, credit 3,300, total 4,000).
- **Validation (AC10)** — `TaxInputError` for: non-finite (`NaN`/`Infinity`) in any numeric field;
  negative money field; `marginalRate`/`pir` outside 0–1; `wrapper: "pie"` with `pir` undefined;
  `fifThresholdNzd <= 0`. Every message names the offending field. Nothing is coerced to 0
  (invariant 14) — optional fields default via `?? 0` only when `undefined`, so an explicit `NaN`
  still fails validation instead of being silently replaced.
- **No non-null assertions on input** — `resolvePir(input)` narrows `input.pir` to `number` via a
  direct property-access check-then-return (TS control-flow narrowing on the property itself),
  avoiding a `pir!` on an optional input field per the guardrail.
- **Constants** (AC12) — `FDR_RATE = 0.05`, `DEFAULT_FIF_DE_MINIMIS_NZD = 50_000`,
  `PIR_CAP = 0.28`, each with an IRD URL and "Verified 2026-08-06" comment, matching
  `.claude/rules/nz-tax.md`'s Sources list and verification date. `DEFAULT_FIF_DE_MINIMIS_NZD`'s
  comment notes the unconfirmed Budget 2026 $100,000 proposal (2026-27) without hardcoding it — the
  threshold stays a parameter (`fifThresholdNzd`) with the current statutory default.
- Deleted `lib/__tests__/harness.test.ts` (the placeholder smoke test) now that a real calculation
  test suite exists, per its own comment and the Coder Guardrails.

No blockers: every hand-computed number in the spec matched my reading of `.claude/rules/nz-tax.md`
(FDR = 5% of opening value, CV lower-of with a zero floor, PIR cap at 28%, US WHT capped credit, cost-
based de minimis) — see the AC-by-AC trace below in the TDD section's fixtures for the arithmetic.

## How to verify

```
$ pnpm test
...
 Test Files  1 passed (1)
      Tests  18 passed (18)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
✓ Compiled successfully
✓ Generating static pages (6/6)
```

All three green. `lib/nzTax.ts` has zero imports from `data/*`, no React/Next, no I/O — a pure
module, importable by any future caller (projection loop, UI) as the one authoritative tax engine.

## TDD

### RED

Ran `pnpm test` with `lib/__tests__/nzTax.test.ts` written (one `it` per AC, plus AC10's field-level
sub-cases) and `lib/nzTax.ts` not yet created:

```
> etf-investment-calculator@0.1.0 test /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator
> vitest run

 RUN  v4.1.10 /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator

 ❯ lib/__tests__/nzTax.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  lib/__tests__/nzTax.test.ts [ lib/__tests__/nzTax.test.ts ]
Error: Cannot find package '@/lib/nzTax' imported from
/Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator/lib/__tests__/nzTax.test.ts
 ❯ lib/__tests__/nzTax.test.ts:2:1
      1| import { describe, it, expect } from "vitest";
      2| import {
       | ^
      3|   computeAnnualTax,
      4|   TaxInputError,

 Test Files  1 failed (1)
      Tests  no tests
```

Every AC's test fails to even run (module-resolution failure), confirming all 18 tests genuinely
depend on the not-yet-written implementation — none of them pass vacuously.

### GREEN

After implementing `lib/nzTax.ts`, ran `pnpm test` again:

```
> etf-investment-calculator@0.1.0 test /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator
> vitest run

 RUN  v4.1.10 /Users/fady/Sandbox/Personal/fullstack-projects/etf-investment-calculator


 Test Files  1 passed (1)
      Tests  18 passed (18)
   Start at  15:45:57
   Duration  240ms (transform 23ms, setup 0ms, import 31ms, tests 5ms, environment 0ms)
```

All 18 tests pass, covering AC1–AC12 (AC10 split into 7 field-level sub-cases, AC11 both inlined via
a shared `expectAllFinite` helper on every fixture above and as its own dedicated test).

## Cycle 1

Fix cycle for `review.md` verdict NEEDS_FIXES. Test-only — `lib/nzTax.ts` ends this cycle
byte-identical to how it started (`git diff lib/nzTax.ts` is empty, pasted below). Only
`lib/__tests__/nzTax.test.ts` changed. Three findings addressed:

- **F1 — de minimis boundary (`nzTax.ts:135`).** Added a fixture pinning `foreignCostNzd === 50_000`
  (default threshold) to `regime: "dividend"`, `aboveThreshold: false`, and `50_000.01` to
  `regime: "fif"`, `aboveThreshold: true`. Locks the existing `>` comparison — the correct reading
  per `.claude/rules/nz-tax.md` ("cost ≤ NZ$50,000 → FIF does not apply"). No code change.
- **F2 — exact FDR = CV tie (`nzTax.ts:160`).** Added a fixture with opening 200,000, closing
  210,000, dividends 0 → FDR = CV = 10,000 exactly, asserting `method: "fdr"` and taxable 10,000 per
  `spec.md:41`. Locks the existing `<=` comparison. No code change.
- **F3 — AC11 gap.** Added the missing `expectAllFinite(withoutOverride)` call to the AC8
  `withoutOverride` fixture (`nzTax.test.ts:181-190`) — one line, no new fixture needed.

### RED — F1 (de minimis boundary)

Temporarily flipped `nzTax.ts:135` from `input.foreignCostNzd > fifThresholdNzd` to `>=`, ran
`pnpm test`:

```
❯ lib/__tests__/nzTax.test.ts (20 tests | 1 failed) 8ms
   × boundary — cost exactly at the de minimis threshold stays below it; one cent over crosses it 3ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  lib/__tests__/nzTax.test.ts > computeAnnualTax > boundary — cost exactly at the de minimis
threshold stays below it; one cent over crosses it
AssertionError: expected 'fif' to be 'dividend' // Object.is equality

Expected: "dividend"
Received: "fif"

 ❯ lib/__tests__/nzTax.test.ts:253:32
    253|     expect(atThreshold.regime).toBe("dividend");
       |                                ^

 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

Reverted `>=` back to `>` (the correct, spec-matching operator).

### RED — F2 (FDR = CV tie)

Temporarily flipped `nzTax.ts:160` from `fdrIncome <= cv ? "fdr" : "cv"` to `<`, ran `pnpm test`:

```
❯ lib/__tests__/nzTax.test.ts (20 tests | 1 failed) 9ms
   × boundary — FDR = CV exact tie resolves to method fdr, per spec 3ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  lib/__tests__/nzTax.test.ts > computeAnnualTax > boundary — FDR = CV exact tie resolves to
method fdr, per spec
AssertionError: expected 'cv' to be 'fdr' // Object.is equality

Expected: "fdr"
Received: "cv"

 ❯ lib/__tests__/nzTax.test.ts:282:27
    282|     expect(result.method).toBe("fdr");
       |                           ^

 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

Reverted `<` back to `<=` (the correct, spec-matching operator, matching `spec.md:41`'s "Exact tie →
`method: fdr`").

### GREEN

With both operators reverted and the F3 one-line addition in place, ran the full gate:

```
$ pnpm test
 Test Files  1 passed (1)
      Tests  20 passed (20)

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
✓ Compiled successfully
✓ Generating static pages (6/6)

$ git diff lib/nzTax.ts
(empty — no output)
```

20 tests pass (18 original + 2 new boundary fixtures), zero lint warnings, build succeeds,
`lib/nzTax.ts` is byte-identical to the pre-cycle version.
