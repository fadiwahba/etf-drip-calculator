# Review — nz-tax-engine (fix cycle 1)

## Verdict

verdict: APPROVE

All three findings from the previous review are closed. `lib/nzTax.ts` is byte-identical, the two
new boundary tests genuinely discriminate, and the three gates pass on my own run.

## Spec Compliance

**Engine unchanged.** `git diff HEAD~1 HEAD -- lib/nzTax.ts` is empty. The commit
(`b741dd8`) touches only `features/nz-tax-engine/notes.md` (+95) and `lib/__tests__/nzTax.test.ts`
(+47) — 142 insertions, 0 deletions. The final committed file has the correct operators:

- `lib/nzTax.ts:135` — `const aboveThreshold = input.foreignCostNzd > fifThresholdNzd;` (`>`, so
  cost *equal* to the threshold stays below it, matching `.claude/rules/nz-tax.md`: "cost ≤
  NZ$50,000 → FIF does not apply").
- `lib/nzTax.ts:160` — `method = fdrIncome <= cv ? "fdr" : "cv";` (`<=`, so an exact tie reports
  `"fdr"`, matching `spec.md:41`).

`lib/` has no uncommitted changes, so what I read is what is committed.

**F1 — de minimis boundary. Closed.** `lib/__tests__/nzTax.test.ts:244-268`. Cost exactly `50_000`
asserts `regime "dividend"` and `aboveThreshold false`; `50_000.01` asserts `"fif"` / `true`. This
test can fail: flip `:135` to `>=` and cost 50,000 yields `aboveThreshold true` → `regime "fif"`,
so `:253` fails. Confirmed by the captured RED in notes.md. The over-threshold half does not
discriminate on its own (both `>` and `>=` are true at 50,000.01), but it correctly pins the other
side of the step, so the pair is right.

**F2 — exact FDR = CV tie. Closed.** `lib/__tests__/nzTax.test.ts:273-285`. Opening 200,000,
closing 210,000, dividends/purchases/sales 0. I re-derived it: FDR = `0.05 × 200_000` = 10,000
exactly (no float residue); CV = `(210_000 + 0 + 0) − (200_000 + 0)` = 10,000. A true tie, not an
approximate one. The test can fail: flip `:160` to `<` and `10_000 < 10_000` is false → `"cv"`, so
`:282` fails. Note that `taxableIncomeNzd` is 10,000 under *both* operators, so the
`expect(result.method).toBe("fdr")` assertion at `:282` is the only discriminator — it is present,
which is exactly what the finding asked for.

**F3 — missing finite assert. Closed.** `expectAllFinite(withoutOverride)` added at
`lib/__tests__/nzTax.test.ts:190`. AC11 now covers every valid fixture in the file.

**No regression.** The diff is additive only (no `-` lines outside the diff header). All 12 ACs are
still asserted with the same expected values: AC1 `:36-44`, AC2 `:62-65`, AC3 `:81-89`, AC4
`:103-106`, AC5 `:121-127`, AC6 `:142-146`, AC7 `:160-162`, AC8 `:177-190`, AC9 `:205-238`, AC10
`:288-346`, AC11 `:349-360`, AC12 `:365-368`. No `toBeCloseTo` precision was loosened (all still
digit 6), no assertion deleted or replaced with a weaker one. Test count went 18 → 20, matching two
new fixtures.

## Code Quality

**TDD evidence is real, not paraphrase.** `notes.md` § Cycle 1 shows two separate RED runs, each
with the flipped operator named by file:line, real Vitest output including the failing test title,
the `AssertionError: expected 'fif' to be 'dividend'` / `expected 'cv' to be 'fdr'` messages, and
the source frame with the caret pointing at `:253` and `:282`. Both runs report `19 passed (20)` —
consistent with the new tests being present during RED and exactly one failing. The GREEN block
records the reverts and an empty `git diff lib/nzTax.ts`, which I independently confirmed.

**Gates — my own run, real output:**

```
$ pnpm test
 Test Files  1 passed (1)
      Tests  20 passed (20)
   Duration  139ms

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
 ✓ Generating static pages (6/6)
Route (app)                              Size     First Load JS
┌ ○ /                                    11 kB           123 kB
└ ○ /etf-comparison                       70.1 kB        182 kB
```

**Constitution and rules adherence.** Still a pure engine — no `data/*` imports, no React, no I/O,
no `Date.now()`, no module-level mutable state. Tax base discipline (invariant 11) is intact:
`grossTaxNzd = taxableIncomeNzd × rate` at `lib/nzTax.ts:164`, with `taxableIncomeNzd` sourced from
dividends only in the below-threshold branch (`:145`) and from FDR/CV value-derived income above it
(`:148-161`). Invariant 13 (no NaN/Infinity escapes) and 14 (fail loudly, never coerce to 0) remain
covered. Invariant 15 (unrounded floats) holds — nothing rounds. The new comments at `:244-246` and
`:270-272` explain *why* the operator direction matters and cite the rule, which is the comment
convention this repo asks for.

**Non-blocking, deferred (carried from the previous review):** `wrapper` has no runtime validation
in `computeAnnualTax`, so a `wrapper` string other than `"pie"` falls through the ternary at
`lib/nzTax.ts:132` and silently uses `marginalRate`. TypeScript blocks this at compile time; it only
bites an untyped/JSON-sourced caller. Acknowledged and deferred by the owner — not a gate.

**Non-blocking nit:** the working tree has unrelated modifications outside this feature
(`app/etf-comparison/page.tsx`, `components/RetirementAnalysis.tsx`, `data/etfs.json`,
`data/dividend_portfolio.json`). They are not in either commit of this feature and `lib/` is clean,
so they do not affect this verdict — but they should be resolved before `close` so the branch does
not carry stray edits.
