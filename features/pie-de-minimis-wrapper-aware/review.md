# Review — pie-de-minimis-wrapper-aware

Reviewed commit `6238d7c` on `feat/nz-tax-engine`. All checks below were run by the reviewer in a
throwaway worktree at HEAD; both temp worktrees (`/private/tmp/review-pie`, the pre-existing
`/private/tmp/gc4`) were removed afterwards. `git worktree list` now shows only the main checkout and
`git status` only the lean-spec harness files (`workflow.json`, `.lean-spec/auto.json`) that were
already dirty before this review.

## Verdict

verdict: APPROVE

**The headline finding, stated plainly: the shipped bug inverted which wrapper the product
recommends below $50,000.** I re-derived the AC15 fixture independently against the real engine — at
`initialCapital 48000 · yield 1.5% · marginal 39% · term 12` the corrected engine gives
`firstDecisiveWrapper: "direct"` (years 1–5), then `flipWrapper: "pie"` from year 6. Under the old
wrapper-blind gate the same shape of scenario made the PIE look cheaper in exactly the sub-$50k range
where a direct holding is genuinely cheaper. This is not only a mispriced PIE — it is a reversed
recommendation, and it is the most consequential thing in this slice.

## Spec Compliance

**Blast radius (verified empirically, not by reading).** I extracted `git show HEAD~1:lib/nzTax.ts`
and diffed old vs new field-by-field (all 9 result fields, `Object.is`) over 600 pseudo-random
inputs spanning both wrappers, costs 0–120k, custom and default thresholds, purchases/sales/WHT and
five marginal rates:

```
cases=600 differed=137 outsideWindowDiffs=0 inWindowIdentical=0
```

- Every `wrapper: "direct"` case: byte-identical. Zero exceptions.
- Every `wrapper: "pie"` case with `foreignCostNzd > threshold`: byte-identical. Zero exceptions.
- **Only** `wrapper: "pie"` with cost at-or-below the threshold differed — and *every* such case
  differed (no silent no-ops hiding a partial fix).
- Exact boundary `cost === threshold`, checked at 50,000 / 100,000 / 40,802.4: direct old===new and
  stays `dividend`/`aboveThreshold:false`; PIE moves `dividend` → `fif` with `aboveThreshold:false`.
  One cent over: both wrappers old===new, both `fif`.
- `fifThresholdNzd: 0` still throws `TaxInputError` matching `/fifThresholdNzd/` for both engines.

The Priority-1 boundary holds exactly as required. `lib/nzTax.ts:156` is the only behavioural line.

**ACs 1–10.** `lib/__tests__/nzTax.test.ts` is a **pure append** (`+344 / −0`) — all 21 pre-existing
ACs untouched. Every AC's asserted numbers match the spec's hand-computed values verbatim, including
AC3's `not.toBeCloseTo(273)` (`lib/__tests__/nzTax.test.ts:446, 480, 580, 600`). Decision 2 is pinned
by AC8 (`:580`): three thresholds → identical `regime`/`method`/taxable/gross tax, `aboveThreshold`
`false/false/true`, plus the still-throws validation case. Decision 4 is pinned by AC9 (`:600`): CV
floor at zero and the exact-tie→`fdr` rule both exercised on a sub-$50k PIE. A PIE is always
`regime: "fif"` (`lib/nzTax.ts:156` — the `dividend` branch is now unreachable for a PIE).

**AC11 / Priority 3 — real rendered strings, not formatter source.** I ran `formatTaxModeExplainer`
and `formatRegimeCell` through the real `runProjection` for eight scenarios and read the output:

| case | explainer | year cells |
|---|---|---|
| PIE $30k | `NZ PIE: Year 1 is FIF (FDR), FIF applies from the first dollar — the de minimis is a direct-holding rule only, taxed at PIR 28.0%.` | `y1–y3: FIF · FDR` |
| PIE at $50k | same PIE wording | `y1: FIF · FDR · above $50k` |
| PIE $200k | same PIE wording | `y1–y3: FIF · FDR · above $50k` |
| PIE $48k crossing | same PIE wording | `y1: FIF · FDR` then `y2+: FIF · FDR · above $50k` |
| direct $30k / $50k / $200k / crossing | unchanged pre-fix wording, incl. `Regime changes to FIF in year 2.` | unchanged pre-fix strings |

No PIE string anywhere claims "above/below the $50,000 de minimis". Direct wording is byte-identical.
AC11(b) is satisfied: `fif + aboveThreshold:false` renders `FIF · FDR` with no threshold claim
(`components/projectionInputs.ts:626-631`), the helper is exported and unit-tested without importing
the `.tsx`, and `InvestmentProjectionCalculator.tsx:18,649` just calls it.

**Out of scope respected.** Seven files changed, exactly the guardrail's list plus `notes.md`.
`lib/projection.ts`, `lib/funds.ts`, `data/*`, `package.json`/lockfile untouched — no new dependency,
no restyling (the `.tsx` diff is one import line, one deleted local function, one call site).

**notes.md before/after** is real computed output and I reproduced it: PIE-30k 273.00 → 420.00
(0.91% → 1.40% of value), and the direct control at the same numbers 321.75 before and after,
asserted in the same test body so a reverted gate cannot pass silently.

**TDD evidence** shows eight ACs failing individually with distinct, correct assertion messages
(`expected 'dividend' to be 'fif'`, `expected 0.0091 to be close to 0.014`, …), not a suite-level
import error; the three regression pins are documented as green before and after, as the guardrail
required. The AC11 RED is a genuine "not exported yet" for `formatRegimeCell` plus a real string
assertion for the explainer.

## Code Quality

**The three test corrections — adjudicated one by one.**

1. **AC6 (Fixture R)** — justified and *arithmetically correct*, not merely "what the engine now
   prints". I recomputed all four years by hand: PIE y1 FDR 5%×40,000=2,000 ×0.28=560 → 47,440; y2
   5%×47,440=2,372×0.28=664.16 → 55,519.84; y3 → 64,294.54624; y4 → 73,823.87721664. All match the
   new assertions to the last digit. Direct legs 48,000 / 56,800 / 65,372.4 / 74,634.8782 are the
   **same literals** as before. `firstDecisiveYear 3/"pie"` → `1/"direct"` is right: this fixture
   pays no dividends, so a below-threshold direct holding pays $0 while the PIE pays FDR from year 1.
2. **AC7 (Fixture F)** — justified. Hand-checked y1 (direct 400×0.39=156 → 44,244 unchanged; PIE
   2,000×0.28=560 → 43,840) and the y2 cost-basis mechanism (43,840/11 = 3,985.4545 shares → dividends
   398.5454 → cost basis 40,798.5454545…, matching the new literal and dropping below the fixture's
   tight 40,802.4). `pie.rows[2].aboveThreshold` `true` → `false` is a real consequence, and harmless
   because it no longer decides a PIE's regime. Tolerances were **tightened**, not loosened (y3/y4
   `toBeCloseTo(…, 2)` → `(…, 6)`). Renaming the test rather than leaving "a real flip" asserting
   `flipYear: null` was the honest choice, and the lost flip coverage was flagged, not buried.
3. **AC15 (`components/__tests__/projectionInputs.test.ts:728-755`) — re-derived independently, and
   it is right.** Running the real engine myself:

   | yr | PIE | direct | diff (pie−direct) | winner |
   |---|---|---|---|---|
   | 1 | fif/fdr | dividend | −391.20 | direct |
   | 2 | fif/fdr | dividend | −883.06 | direct |
   | 3 | fif/fdr, above | fif/fdr, above | −642.93 | direct |
   | 5 | fif/fdr, above | fif/fdr, above | −9.5071 | direct |
   | 6 | fif/fdr, above | fif/fdr, above | +395.72 | **pie** |

   `firstDecisiveWrapper: "direct"`, `flipYear: 6`, `flipWrapper: "pie"` — confirmed. The claimed
   mechanism checks out by hand at year 1: direct 720 dividends × 0.39 = 280.80 vs PIE
   5%×48,000×0.28 = 672.00, difference exactly −391.20; direct's cost basis crosses $50k between
   years 2 and 3 and switches to 1.95% against the PIE's 1.4%. Year 5's −9.51 margin is ~9.5 million
   times `WRAPPER_TIE_EPSILON_NZD` (1e-6) — not a tie, so the fixture discriminates rather than
   sitting on a knife edge. The replacement assertions are strictly **stronger** than the ones
   removed (`flipYear` pinned to the literal `6` instead of `not.toBeNull()`, plus
   `firstDecisiveWrapper`). Nothing went further than needed: only that one test changed in the file;
   everything else in the diff is added AC11 coverage.

**Mutation testing.** Baseline 205/205. Re-ran the coder's three and added four of my own; all seven
killed (counts are the default reporter's real numbers):

| mutant | result |
|---|---|
| M1 revert gate → `if (!aboveThreshold)` | 12 failed / 193 passed |
| M2 gate on the wrong wrapper → `wrapper === "pie"` | 37 failed / 168 passed |
| M3 `aboveThreshold` `>` → `>=` | 2 failed / 203 passed |
| **R1** direct-side boundary only (gate uses `>=`, reported field untouched) | 2 failed / 203 passed |
| **R2** PIE gets dividend relief *exactly at* the boundary | 1 failed / 204 passed — killed precisely by nzTax AC4 |
| **R3** `aboveThreshold` forced `true` for a PIE (informational field corrupted) | 6 failed / 199 passed |
| **R4** flip direction inverted in `compareWrappers` (`> 0 ? "direct" : "pie"`) | 6 failed / 199 passed — kills the AC15 flip pin and projection AC6/AC7 |

Sources restored after every mutant; post-restore run back to 205/205 and `git status` clean.

**Gates, run independently in a clean worktree at HEAD (real output).**

```
$ pnpm lint                → ✔ No ESLint warnings or errors        (exit 0)
$ pnpm exec tsc --noEmit   → (no output)                            (exit 0)
$ pnpm test                → Test Files 4 passed (4) · Tests 205 passed (205)
$ pnpm build               → ✓ Compiled successfully · 7/7 static   (exit 0)
```

Matches the orchestrator's measurement: lint 0, tsc 0, **205** tests, build 0.

**Constitution.** §2 — the gate exists only at `lib/nzTax.ts:156`; `formatRegimeCell` reads the row's
own `aboveThreshold` and re-derives nothing. §3 — no rate or threshold value was changed, and the
existing IRD citations beside `FDR_RATE`/`DEFAULT_FIF_DE_MINIMIS_NZD`/`PIR_CAP` are intact. §9 — the
new comments explain *why* (the nz-tax.md rule, the audit finding, the 0.91%-vs-1.40% consequence).
Invariant 13/14 — `expectAllFinite` is called on the new fixtures and validation still throws by
field name.

**Nits (not blocking, no fix cycle needed).**

- `lib/__tests__/projection.test.ts:1817` retypes an *unchanged direct-leg* literal
  `48_913.75309090909` → `48_913.7530909091` (differs by 7.3e-12, inside the 1e-6 tolerance, no
  behaviour change). notes.md lists it as "unchanged"; strictly it was re-typed. Harmless, but it is
  a touch on a line the boundary said to leave alone.
- Two exact `expect(y1.differenceNzd).toBe(0)` assertions became `toBeCloseTo(…, 6)`. Consistent with
  the file's style and the new values are order-1e3, so 1e-6 is not a real loosening.
- `notes.md:106` mislabels which regression pins were green pre-fix (it calls AC5 "byte-identical
  PIE-above-threshold"; in the spec and in the test file AC5 is "one cent over" and AC6 is the PIE
  above the de minimis). The tests themselves are named correctly; only the narrative is shifted.

**Observations for a later slice (out of this spec's scope, do not fix here).**

- A PIE row *above* the threshold still renders `FIF · FDR · above $50k`. The statement is literally
  true (cost > threshold) and keeping it was required to hold PIE-above byte-identical, but for a PIE
  the suffix names a test that never applied. Worth revisiting when the year table is next touched.
- The year-0 row is a wrapper-blind placeholder (`lib/projection.ts:258`), so a $200k PIE *and* a
  $200k direct holding both render `Dividend · below` at year 0. Pre-existing, unchanged by this
  commit, and `lib/projection.ts` is out of scope — but for a PIE it now visibly contradicts the new
  explainer line.
- The static page copy at `components/InvestmentProjectionCalculator.tsx:121-122` ("or actual
  dividends below the $50k threshold") is shown in every mode, including PIE. Pre-existing and not an
  AC11 target, but it is the last place on the page that implies the de minimis is wrapper-blind.
