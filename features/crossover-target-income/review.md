# Review — crossover-target-income (fix cycle 1)

## Verdict

verdict: APPROVE

Both surviving mutations from cycle 0 now die, on exactly the new tests written for them. The two
new ACs are genuinely discriminating — I re-derived fixtures V and W by hand from the engine's own
loop before trusting any literal. Nothing regressed, `lib/projection.ts` is byte-identical, and all
four gates are green in a clean worktree at HEAD (`5676f36`).

## Spec Compliance

**1. The two survivors now die.** Applied myself in a clean worktree, default reporter, file
restored and confirmed clean between runs:

| Mutation | Site | Result |
|---|---|---|
| 2-year lookahead: `t < netIncomeByYearNzd.length` → `t < Math.min(year + 2, …)` | `lib/projection.ts:607` | **Killed** — `Tests 1 failed \| 146 passed (147)`, the failure is AC20 |
| `Math.max(0, …)` on net income | `lib/projection.ts:588` | **Killed** — `Tests 1 failed \| 146 passed (147)`, the failure is AC21 |

Each kills precisely one test, and it is the test written for it. No collateral kills, so the ACs
are aimed, not accidental.

**2. AC20 and AC21 are discriminating, not vacuous.** Re-derived both from `project()`'s loop
(`lib/projection.ts:280-403`), not from the spec.

*Fixture V* (`lib/__tests__/projection.test.ts:1523`). The engine reinvests `gross − WHT`
(`projection.ts:329`) and then sells shares for `nzTaxPayableNzd` (`projection.ts:367`), so
`OV(t+1) = 1.1 × OV(t) + net(t)`. Below the threshold `net = 0.67 × gross = 0.0275 × 0.67 × OV`;
above it FDR bites and `net = (0.0275 − 0.0165) × OV`. My hand series:

`[0, 847.55, 947.92110875, 1060.178666053719, 707.898701242466, 786.4754570803796, 873.7742328163018, 970.7631726589112]`

— all eight agree with the test. The de minimis crossing is real and lands where the spec says: I
computed the cumulative `costBasis` (`projection.ts:348`, which uses the **closing** basis for that
year's tax call) as **49,622.83926654203** after year 3 and **51,127.124006…** after year 4, both
matching the test's assertions to within `toBeCloseTo(…, 6)`.

The discrimination is real: year 1 (847.55) clears the 800 target, but the **dip lands at years 4
and 5** (707.90 and 786.48) — 3 and 4 years later. A 2- or 3-year lookahead from year 1 sees only
847.55 / 947.92 / 1060.18, all clearing, and returns **1** instead of **6**. I confirmed the 3-year
variant is also killed (see Code Quality).

*Fixture W* (`lib/__tests__/projection.test.ts:1546`). Cost basis 100,000 is above the threshold
from year 1, CV (`0.1 × OV`) always exceeds FDR (`0.05 × OV`) so FDR is used every year, and the
1.1% yield sits under the 1.65% drag: `net = −0.0055 × OV`, `OV` = 100,000 → 109,450 → 119,793.025.
Hand result `[0, −550, −601.975, −658.8616375]` matches the test exactly. These are **genuinely
negative in the hundreds of dollars**, not small-and-rounding-noise. Under the clamp the series
becomes `[0, 0, 0, 0]`, and target `0` then reports a crossover at year 1 — a confidently wrong
"you're already there" for a portfolio that is bleeding cash. Exactly the failure mode
`calculator-invariants.md` warns about.

**3. `lib/projection.ts` byte-identical.** `git diff HEAD~1 HEAD -- lib/projection.ts` produces no
output. `git diff --numstat HEAD~1 HEAD` is `116/0 notes.md`, `38/0 projection.test.ts` — nothing
else. The pure-append guarantee of C1/AC1 still holds.

**4. No regression.** 147 tests pass, 145 of them the prior set. The test diff is purely additive:
two new `it(…)` blocks appended after AC12 inside the existing `describe`, no line deleted, no
existing assertion touched, no helper edited (both fixtures are built through the existing
`makeFixtureT` overrides at `projection.test.ts:1282`).

**5. AC4's corrected literals.** `spec.md:65-66` now reads
`[0, 3850, 4383.225, 4990.3016625, 5681.45844275625, 6468.34043707799]`, byte-identical to
`projection.test.ts:1380` and to my own derivation from `net(t) = 0.0385 × 100_000 × 1.1385^(t−1)`.
The spec/code contradiction I raised in cycle 0 is closed.

**6. `notes.md`.** `## Cycle 1` is a pure append at `notes.md:169`; the Cycle-0 TDD transcripts and
the AC18 before/after table are untouched (116 insertions, 0 deletions). The coder also accepts the
new guardrail in writing and states it re-derived both fixtures *before* writing assertions, using
a scratch test that never touched a tracked file — consistent with what I found.

## Code Quality

**My own two mutations, both killed.** Applied to the sustained scan, the only logic cycle 1
newly pins:

| # | Mutation | Result |
|---|---|---|
| N1 | 3-year lookahead: `t < Math.min(year + 3, …)` (`projection.ts:607`) | **Killed** — 1 failed / 146 passed, AC20 |
| N2 | Inner scan skips the qualifying year: `let t = year + 1` (`projection.ts:607`) | **Killed** — 8 failed / 139 passed, AC20 and AC21 among them |

N2 is the interesting one: skipping the candidate year itself makes `crossoverYear` 5 instead of 6
on fixture V and, on fixture W, lets a never-crossing series report a crossover. Eight tests catch
it, so the suite constrains this loop from several directions, not just one.

**Gates, run independently in a clean detached worktree at `5676f36`** (removed afterwards; the
main tree is untouched apart from the two pre-existing lean-spec orchestration files):

```
$ pnpm lint          → ✔ No ESLint warnings or errors           (exit 0)
$ pnpm exec tsc --noEmit → (no output)                          (exit 0)
$ pnpm test          → Test Files 4 passed (4) · Tests 147 passed (147)
$ pnpm build         → ✓ Compiled successfully · ✓ 7/7 static pages
```

All four match the orchestrator's measurement, including the 147 count.

**Constitution and rules.** `findIncomeCrossover` (`projection.ts:572-635`) still does no deflator
arithmetic of its own — it echoes `real.inflationRate` (`:628`) and reads already-deflated rows, per
§2 and C3. Net is `gross − totalTaxNzd` with no fee term (`:588`), which is the correct NZ reading:
WHT never reaches the investor and the FIF bill is compulsory cash on a deemed return, while fees
are already taken out of the share count (`projection.ts:340`). Comments explain *why* only. No
`any`, no non-null assertion, no new dependency.

**Test honesty.** The new tests are not weakened versions of anything — they pin values that did not
exist in the suite before, and each carries a comment saying plainly it cannot RED because the
shipped code is already right, with the mutation named as its evidence. That is the honest framing
for a pin-the-behaviour test and it matches what I reproduced.

### Non-blocking observations

1. **AC20 dies to a 2- or 3-year lookahead but survives a 4-year one.** On fixture V a 4-year
   window happens to see the year-5 dip from year 1 and returns 6 by luck. The spec only claims 2-
   and 3-year coverage (`spec.md:132`), so this is honest, not overclaimed — but the fixture does
   not fully pin "scan to N" against every fixed window. Not worth a cycle; noted for the record.
2. **Working tree carries `features/crossover-target-income/workflow.json` (modified) and an
   untracked `.lean-spec/auto.json`.** Both are lean-spec orchestration state and predate my run;
   neither is code. Worth a glance before `close` commits.
