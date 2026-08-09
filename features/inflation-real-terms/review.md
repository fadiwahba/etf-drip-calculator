# inflation-real-terms — review

## Verdict

verdict: APPROVE

Gates re-run independently in a clean `git worktree` at HEAD (`35d14ce`), worktree removed after:

```
pnpm lint                → ✔ No ESLint warnings or errors        (exit 0)
pnpm exec tsc --noEmit   → no output                             (exit 0)
pnpm test                → Test Files 4 passed (4)
                           Tests 119 passed (119)
pnpm build               → ✓ Compiled successfully, 4 routes     (exit 0)
```

Matches the orchestrator's measurement exactly. Tree left as found (`git status`: only the
pre-existing `workflow.json` / `.lean-spec/auto.json`, untouched by me).

## Spec Compliance

**Additive guarantee — structural, not statistical.** `git diff --numstat HEAD~1 HEAD` gives
`119  0  lib/projection.ts`, and the diff is a **single hunk** `@@ -435,3 +435,122 @@` — a pure
append after `projectFund()`. Every byte of `project()`, `projectFund()`, `validateInput`,
`resolvePhase`, `buildYearZeroRow` and the three interfaces is identical to HEAD~1. The 500-fixture
`Object.is` run in `notes.md` is therefore corroboration, not the proof; the proof is that the
bytes did not change. Files changed are exactly the six the guardrails allow; `lib/nzTax.ts`,
`lib/funds.ts`, `data/*`, `app/*`, `types.ts`, `package.json` are absent from
`git diff --name-only HEAD~1 HEAD`. No new dependency.

**Risk 1 — tax on nominal figures. Clean.** `computeAnnualTax` has exactly one non-test call site,
`lib/projection.ts:350`, inside `project()`. `toRealTerms` (`lib/projection.ts:456`) consumes a
finished `ProjectionResult` and calls nothing. No deflated value can reach a tax base by
construction, not by discipline.

**Risk 2 — `costBasisNzd` never deflated. Verified, and verified by mutation.** It is not in the
override list (`lib/projection.ts:505-530`); it carries through the `...row` spread.
`AC4` (`lib/__tests__/projection.test.ts`) pins it with `Object.is` against the nominal row on
every row. My mutation M8 (deflate `costBasisNzd`) → **1 failed** (AC4). The regime question is
also structurally answered: `taxRegime`/`aboveThreshold` are decided inside `project()` before
`toRealTerms` exists, so the real view cannot change which regime applied — my M8 run confirmed no
regime assertion moved, only the AC4 identity check.

**Risk 3 — memo is not a cash outflow. Clean.** `purchasingPowerLostNzd` (`lib/projection.ts:503`)
is a read-only difference. Totals at `:548-553` sum `totalFeesNzd`, `totalTaxNzd` and
`dividendsDrawnNzd` only; `netGainNzd` (`:551`) is `finalReal − initial − realCumulativeContribs`
with no memo term; no balance subtracts it. No `totalPurchasingPowerLostNzd` field exists (AC5
asserts the absence). Mutations M6 (memo into `totalFeesNzd`), M7 (into `totalTaxNzd`) and M13
(memo subtracted from `closingValueAfterTaxNzd`) all died.

**Risk 4 — one `project()` call.** `runProjection` calls `project()` once
(`components/projectionInputs.ts:348`) and derives `real` from that same object at `:374`. AC11
pins `on.value toEqual off.value`. I confirmed independently on the UI-default scenario: the
nominal result is byte-identical with the toggle on and off.

**Exponents and field classification.** `closingDeflator = (1+i)^t`, `openingDeflator = (1+i)^(t−1)`,
both pinned to 1 at `t = 0` (`:466`, `:469`). `cumulativeContributionsNzd` is a running PV sum
(`:499`), not a nominal total over one deflator. Share counts, `year`, `phase`, `taxRegime`,
`taxMethod`, `aboveThreshold` pass through untouched. There is no rate field on a row, so "a rate
is never deflated" holds vacuously; the nearest equivalent, a share count, is covered by my M9.

**ACs 1–17.** All present and passing. AC13 (UI, inspection): plain `<input type="checkbox">` at
`components/InvestmentProjectionCalculator.tsx:370` checked by default (`:53`); rate input `:385`
defaulting `"3"` (`:54`), `disabled={!form.showRealTerms}` with the value kept (`:388-390`);
`FieldError` `:393`; the assumption line "3% is a chosen planning assumption, not a published
forecast." `:395`; **Purchasing power lost** column last, after End Balance (`:510`, `:551`); tile
headings suffixed `" (today's dollars)"` (`:107`, `:426-463`); the memo/nominal-contributions
static line `:563`. No existing column or class changed — the only edits to pre-existing JSX swap
`projection.value` for `displayResult` and append the suffix. No restyling.

**AC17 — before/after table.** I recomputed the UI-default scenario myself (scratch test, deleted).
Every figure in `notes.md` matches to the last digit: nominal final 382,720.887339 / real
245,653.974057; y15 dividends 3,380.370795 / 2,169.731382; total tax 51,208.228184 / 38,836.923309;
net gain 282,720.887339 / 145,653.974057; y15 memo 137,066.913282. Ratio 0.6418619473967174 equals
`1/1.03^15` to full float precision. Real total tax is visibly *not* `51,208.228/1.03^15`
(= 32,869.5), so it is a genuine PV sum. `1.03^30 = 2.427262` → real ≈ 41.2%, so the ~2.43×
overstatement headline is right. The "nominal path unchanged" claim holds by the byte-identity
argument above and by my own toggle-on/off comparison.

## Code Quality

**Mutation testing — 15/15 killed, including 8 of my own.** Run in the clean worktree with the
default reporter (never `--reporter=basic`), reading real pass/fail counts. Baseline 82 passed.
Source restored and re-verified after every run.

| Mutation | Result | Killed by |
|---|---|---|
| M1 closing exponent `t → t−1` | KILLED 5 failed | AC2, AC3, AC5, AC6, AC7 |
| M2 opening exponent `t−1 → t` | KILLED 1 failed | AC2 chain check |
| M3 closing exponent `t → t+1` (mine) | KILLED 5 failed | AC2, AC3, AC5, AC6, AC7 |
| M4 growth rate 0.10 in place of `inflationRate` (mine) | KILLED 2 failed | **AC3 (i = 0.03)**, AC1 |
| M5 `cumulativeContributionsNzd` deflated wholesale | KILLED 2 failed | AC2, AC6 |
| M6 memo summed into `totalFeesNzd` | KILLED 2 failed | AC5, AC6 |
| M7 memo summed into `totalTaxNzd` (mine) | KILLED 2 failed | AC5, AC6 |
| M8 `costBasisNzd` deflated | KILLED 1 failed | AC4 |
| M9 `closingShares` deflated (mine) | KILLED 1 failed | AC4 |
| M10 `dividendPerShareNzd` left nominal (mine) | KILLED 1 failed | AC2 |
| M11 `assertHalfOpenRate` dropped | KILLED 2 failed | AC8, AC12 |
| M12 year-0 guard removed on `openingDeflator` (mine) | KILLED 1 failed | AC2 |
| M13 memo subtracted from the balance (mine) | KILLED 4 failed | AC2, AC3, AC5, AC6 |
| M14 platform fee skipped in `draw` (`project()`) | KILLED 1 failed | **AC14** |
| M15 real `totalTaxNzd` = nominal total ÷ one deflator (mine) | KILLED 2 failed | AC5, AC6 |

M4 is the important one: with the growth-rate substitution, AC2 (`i = g = 0.10`) still passes and
**AC3 at `i = 0.03` is what dies** — exactly as the spec predicted. The `i = 0.03` fixture is
carrying real weight, not decoration.

**Both folded-in findings are genuinely closed.** F1: M14 (`platformFee = phase === "draw" ? 0 :
…`) now **dies** on AC14, which was the survival case in the previous review. F2: `3PP-AC9`
(`lib/__tests__/projection.test.ts`) now runs a real Coast fixture (`drawdownStartYear: 4`) pinned
by `expect(coastResult.rows[2].phase).toBe("coast")`, so it cannot drift back to a duplicated Draw
run.

**Tests not weakened.** `git diff HEAD~1 HEAD -- lib/__tests__/projection.test.ts` is 234
insertions / **1 deletion** — that single deletion is the sanctioned AC15 line. The mapper test
diff is 111 insertions / **0 deletions**. The `makeForm()` extension (`showRealTerms: true`,
`inflationRatePercent: "3"`) is disclosed in `notes.md:29-30`, matches the shipped UI defaults, and
loosens nothing — it makes every pre-existing mapper test additionally exercise the real path. All
30 pre-existing ACs pass unedited.

**Constitution.** §2: every `/(1+i)` lives in `toRealTerms`; `grep` for `Math.pow` / `1 +` in the
`.tsx` and `projectionInputs.ts` returns only comments, and the mapper does a single `/100`
(`components/projectionInputs.ts:166-179`). §1: `assertHalfOpenRate` rejects `NaN`, `±Infinity`,
negatives and percent-shaped values with a `ProjectionInputError`; `parseInflationRate` never
coerces to 0 (invariant 14); `formatNzd` returns `"—"` for non-finite, and AC16's
`assertAllFinite` covers `toRealTerms` at `i ∈ {0, 0.03, 0.10, 0.999}` plus the degenerate 1-year
term. §3: the 3% default is commented and shown in the UI as a chosen assumption with no invented
IRD/RBNZ citation. No `any`, no non-null assertions, no silencing `as`. Comments explain *why*.

**Non-blocking observations** (no fix required, recorded for the next cycle):

1. AC14 and AC15 were GREEN from the first run, disclosed at `notes.md:24-28`. They are test-only
   pins over an unchanged engine, so a genuine RED is impossible without mutating `project()`.
   I verified their teeth the only way available — M14 kills AC14 — so the intent of the guardrail
   is met even though the letter ("ACs 14–16 RED-first") is not.
2. Most RED evidence for ACs 1–7/16 is `toRealTerms is not a function`. That is a legitimate
   per-test failure, not a suite-level import error (esbuild strips types, so the missing export is
   `undefined` at the call site), and the coder verified that explicitly. It does prove less about
   the *values* than an assertion diff would; the 15/15 mutation score is what closes that gap.
3. A negative rate typed into the UI (e.g. `-2`) surfaces through the engine-error banner rather
   than the inline `FieldError`, reusing the shared message "…not a percent (e.g. 0.005, not 0.5)",
   which reads slightly oddly for a negative. AC12 sanctions engine-error surfacing for
   out-of-domain rates, so this is consistent, not a defect — but the wording could be sharpened in
   a later UX pass.
4. `runProjection` parses the rate twice (`components/projectionInputs.ts:214`, `:360`) and carries
   an unreachable `throw` for the `undefined` branch. Both are commented and deliberate — keeping
   the only `/100` inside `parseInflationRate`. Redundant, but the safe direction.
5. `const lastRow = rows[rows.length - 1]` (`lib/projection.ts:546`) would be `undefined` on an
   empty rows array. `project()` cannot produce one (`termYears ≥ 1` → ≥ 2 rows), so this is
   theoretical only.
