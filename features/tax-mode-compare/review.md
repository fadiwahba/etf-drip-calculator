# tax-mode-compare — review

## Verdict

verdict: NEEDS_FIXES

Three concrete, small fixes. The engine itself is correct: the comparison is fair, ranking is on
value, the PIR cap and de minimis are pinned, and ACs 19/20 are genuinely discriminating (all
verified by my own mutation runs below). What blocks APPROVE is one silently loosened tolerance
that contradicts the spec's stated precision rule, one test comment that claims a guarantee the
assertion does not provide, and a commit message that records the exact domain error the spec was
refined to correct.

**Fix list**

1. `lib/__tests__/projection.test.ts:1773` — `expect(y2.differenceNzd).toBeCloseTo(-414.36690909091, 4)`.
   Spec AC7 states an explicit `toBeCloseTo(x, 2)` for years 3–4 only; year 2 therefore falls under
   the spec preamble "Money: `toBeCloseTo(x, 6)` unless stated" (spec.md:70). Precision was loosened
   to 4 with no disclosure in `notes.md`. I re-ran the assertion at precision 6 in a clean worktree:
   **it passes** (`Tests 68 passed (68)`). Change `4` → `6`. Nothing else needed — this is a
   loosening that bought nothing.
2. `lib/__tests__/projection.test.ts:1663-1668` — the comment claims the identity
   `direct − pie === −differenceNzd` is "pinned as an identity so the 'swap the two runs' mutation is
   caught without a second fixture". It is not: `differenceNzd` is *defined* as `pie − direct`
   (`lib/projection.ts:678`), so the assertion is algebraically true under the swap mutation too. The
   swap is actually caught by the per-year literals on lines 1659-1660. Either delete the tautology
   or correct the comment. As written it is a false claim about test strength in a file whose comments
   are load-bearing evidence.
3. Commit `af95899` message body states "**US withholding applies to the direct path only**". That is
   the domain error the spec refinement (`a26eadd`, D3 / AC19) exists to kill: a NZ PIE holding US
   equities *does* bear US WHT at fund level, `.claude/rules/nz-tax.md` carries no PIE exemption, and
   the shipped code correctly passes `usWithholdingRate` to both legs. The branch is unpushed (41
   commits ahead of origin), so amend the message — or, if history is not to be touched, add an
   explicit correction line to `notes.md` naming the wrong claim. Leaving it is a durable wrong tax
   statement in the record of the slice that fixed it.

Nothing here is a blocker on the maths. No `BLOCKED` condition found: the spec's AC8 literals were
already corrected upstream and the shipped test matches the corrected spec exactly.

## Spec Compliance

**Gates (AC18)** — clean detached worktree at `e9e464c`, `pnpm install --frozen-lockfile`, all four
run independently:

```
pnpm lint              ✔ No ESLint warnings or errors           exit 0
pnpm exec tsc --noEmit  (no output)                             exit 0
pnpm test               Test Files 4 passed (4) / Tests 176 passed (176)   exit 0
pnpm build              ✓ Compiled successfully / ✓ 7/7 static pages       exit 0
```

Matches the orchestrator's measurement (lint 0, tsc 0, 176 tests, build 0). Worktree removed after.
Note: an unrelated pre-existing worktree `/private/tmp/gatecheck` is still registered at `e9e464c`
(not mine — `git worktree list`); prune it if it was a temp checkout.

**PRIORITY 1 — is the comparison fair?** Yes.
`lib/projection.ts:673-674` is the whole contract:
`const pie = project({ ...input, wrapper: "pie" }); const direct = project({ ...input, wrapper: "direct" });`
Two `project()` calls, same `input` object spread twice, only `wrapper` overridden — every other
field (capital, term, growth, yield, fees, FX, `usWithholdingRate`, phases, `pir`, `marginalRate`,
`fifThresholdNzd`) is identical by construction, and `input` is never mutated. Grep of the appended
region (lines 631-738) finds **no** `computeAnnualTax`, no `Math.min`, no `PIR_CAP`, no deflator and
no rate arithmetic — tax is read off the two already-validated `ProjectionResult`s (`totalTaxNzd` at
`lib/projection.ts:734-735`). AC10 (`:1832-1852`) pins `toEqual` against direct `project()` calls,
input non-mutation, and `input.wrapper` being ignored.

My mutation **X1** — make a non-wrapper input differ between the legs
(`project({ ...input, wrapper: "direct", sharePriceGrowth: input.sharePriceGrowth + 0.0001 })`) —
**killed, 11/176 failed**. The fairness guarantee is genuinely tested, not just asserted in a comment.

**PRIORITY 2 — "cheaper" ranks value, not tax.** Correct. `lib/projection.ts:677-684` computes
`differenceNzd = pieRow.closingValueAfterTaxNzd − directRow.closingValueAfterTaxNzd` and derives
`cheaperWrapper` from it alone. `pieTotalTaxNzd`/`directTotalTaxNzd` (`:734-735`) are reported and
never read by any ranking path. Faithful mutation (rank `cheaperWrapper` on per-year
`row.totalTaxNzd`, leave `differenceNzd` alone): **killed, exactly 1/176 — `AC7 — a real flip
(Fixture F)`**. Fixture F is the fixture where the two measures genuinely disagree, which is what
the spec claims, and it is the only thing standing between D1 and a silent regression.

**PRIORITY 3 — PIR cap and de minimis.** Both pinned.
- Cap: I mutated `lib/nzTax.ts:138` `Math.min(resolvePir(input), PIR_CAP)` → `resolvePir(input)`
  (removing the cap at source, not via `compareWrappers`): **killed, 3/176**. AC3 (`:1678-1683`,
  Fixture C `pir` 0.39) is what makes 0.39 collapse back to P's 1,936.1645875. The coder's own M3
  (pass `marginalRate` as the PIE's `pir`) also re-killed at **6/176**.
- De minimis: AC6 (`:1718-1748`, Fixture R) pins years 1–2 **identical** in both wrappers
  (`differenceNzd` asserted with `toBe(0)`, not `toBeCloseTo`) with `taxRegime "dividend"`, then the
  year-3 divergence at `costBasisNzd` 52,000. `firstDecisiveYear` is **3** and `flipYear` is
  **`null`** — not `0`, not the last year. Mutation M7 (`null` → `0`) **killed, 7/176**.

**PRIORITY 4 — are ACs 19/20 vacuous?** No. Both discriminate; I verified the spec's own claim
independently.
- **AC19** (`:1888-1921`) uses `pir: 0.105` as required (`:1893`). Zero-WHT-on-PIE mutation:
  **killed, 2/176**. I then probed the counter-claim directly with a scratch fixture (deleted after):
  at `pir` **0.105** baseline vs mutant give `pieAfterTax=114675 / pieWHT=825` vs
  `pieAfterTax=114975 / pieWHT=0` — discriminating on value. At `pir` **0.28** both give
  `pieAfterTax=114100` and `pieTotalTaxNzd=1400` identically, differing only in `usWithholdingNzd`
  (825 vs 0). The spec's reason for AC19 existing at 0.105 is exactly right, and the test additionally
  pins `usWithholdingNzd` on both legs (`:1903-1904`), so it would kill the mutant either way.
- **AC20** is pinned by value, not substring. Lib half (`:1927-1931`): `pie.rows[1].nzTaxPayableNzd`
  1,400 (28%) vs `direct.rows[1].nzTaxPayableNzd` 875 (17.5%) — each leg's own rate, so a swap moves
  both. Swap mutation: **killed, 12/176**, AC20 among them. Explainer half (`:710-737` in
  `components/__tests__/projectionInputs.test.ts`) asserts the full substring
  `` `NZ PIE leads by ${formatNzd(1_936.1645875)}` `` / `` `US ETFs (direct) leads by ${formatNzd(1_866.5430328125)}` ``.
  The "leads by" ternary swap (`components/projectionInputs.ts:583`): **killed, both mirrored cases
  fail, 2/176**. The N2 flip-label ternary swap (`:578-580`): **killed, 1/176**.

**Full mutation ledger I ran (default reporter, real counts, source restored between each; final
`git status --porcelain` empty in the worktree):**

| Mutation | Result |
|---|---|
| X1 — non-wrapper input differs between legs (mine) | Killed 11/176 |
| X2 — PIR cap removed in `lib/nzTax.ts:138` (mine) | Killed 3/176 |
| X3 — `WRAPPER_TIE_EPSILON_NZD` 1e-6 → 1e6 (mine) | Killed 5/176 |
| X4 — `flipYear = years[i].year + 1` off-by-one (mine) | Killed 1/176 |
| M1 — swap the two runs | Killed 12/176 |
| M2 — zero `usWithholdingRate` on the PIE leg | Killed 2/176 |
| M3 — pass `marginalRate` as the PIE's `pir` | Killed 6/176 |
| M5 — report the last flip (drop `break`) | Killed 1/176 |
| M6 — shift the decisive scan to start at year 2 | Killed 1/176 |
| M7 — return `0` for `null` | Killed 7/176 |
| M8 — treat a tie as a flip | Killed 1/176 |
| M9 — rank `cheaperWrapper` on `totalTaxNzd` | Killed 1/176 (AC7 only) |
| N1 — `"compare"` stops parsing `pir` | Killed 6/176 |
| N2 — flip-label ternary swap | Killed 1/176 |
| N3 — `value = comparison.pie` | Killed 1/176 |
| N4 — "leads by" ternary swap | Killed 2/176 |

16/16 killed. No survivor found.

**Per-AC** — AC1 pure append ✅ (105/0 numstat, the only `-` line in the diff is the `--- a/` header;
`project()`, `projectFund()`, `toRealTerms()`, `findIncomeCrossover()` untouched). AC2 ✅. AC3 ✅.
AC4 ✅ (`flipYear` null, `cheaperWrapper "direct"` every year). AC5 ✅ (`toBe(0)`, all four fields
`toBeNull()`). AC6 ✅. **AC7 ⚠️** — every value and the flip year are correct, but the year-2
tolerance is 4 where the spec says 6 (fix 1). AC8 ✅ — the test carries `117,213.545195` /
`115,441.680321`, matching the refined spec's corrected literals, and also asserts the winner/flip
invariance generically. AC9 ✅ (`TaxInputError`, not `ProjectionInputError`, `/pir is required/` —
proves the PIE leg is never skipped). AC10 ✅. AC11 ✅ (all five fixtures, every numeric field of
`years` and both results). AC12 ✅ (`"taxMode" in value === false`; `"compare"` → `wrapper "direct"`
with `pir` still parsed). AC13 ✅. AC14 ✅. AC15 ✅. AC16 ✅ by inspection — `Tabs`/`TabsList`/
`TabsTrigger` from the pre-existing `components/ui/tabs.tsx` (last touched in `964bdab`, zero diff in
this slice), PIR shown for `pie`/`compare`, marginal for `direct`/`compare`, one-line explainer, a
compare-only block with both finals, the difference and `"Never"` for a null flip. No restyling; the
old `Select` import is the only removal. AC17 ✅ — I re-ran the UI-default row through the real
mapper: `pie=396056.91716811026 direct=382720.88733874005 diff=13336.029829370207 flip=null`,
matching `notes.md` to 6dp. The table covers marginal 39/33 (above the cap) and 17.5 (below), so the
cap's ceiling-not-discount effect is visible. AC18 ✅. AC19 ✅. AC20 ✅.

**Out of Scope respected** — `git diff --name-only 2bb62a1 e9e464c` touches only the six sanctioned
paths plus `spec.md`. `package.json`, `pnpm-lock.yaml`, `lib/nzTax.ts`, `lib/funds.ts`, `data/*`,
`app/*`, `types.ts`, `vitest.config.mts` and `components/ui/*` are all zero-diff. **No new
dependency.**

## Code Quality

**Tests not weakened, with one exception.** `lib/__tests__/projection.test.ts` is 374 insertions /
**0 deletions**. `components/__tests__/projectionInputs.test.ts` has exactly 5 deletions, and I read
all five: they are the mechanical `wrapper:` → `taxMode:` rename in `makeForm` and its 4 override
sites (lines 27, 154, 168, 173, 231 in the old file). No assertion text, value or tolerance was
touched — AC1's "no assertion changed" clause is satisfied. All 147 prior lib tests and 55 prior
mapper tests still pass. The one exception is fix 1 above (AC7 year-2 tolerance 6 → 4, undisclosed).

**Cycle 1 is test-only, verified.** `git diff af95899 e9e464c -- lib/projection.ts
components/projectionInputs.ts components/InvestmentProjectionCalculator.tsx` is **empty**. The
commit's numstat is `34/0`, `110/0`, `50/0` across two test files and `notes.md`. Nothing was
reconciled in source to make the new ACs pass — they pin behaviour that already shipped.

**Constitution adherence.**
- §2 (one engine per concern): `compareWrappers` does no tax, fee, growth or deflator arithmetic.
  `PIR_CAP` and `DEFAULT_FIF_DE_MINIMIS_NZD` are imported from `lib/nzTax` in
  `components/projectionInputs.ts:21` and used at `:514` and `:564` — never restated as literals, so
  the explainer's "capped at 28%" and "$50,000" both follow the engine if it changes.
- §1 / invariant 14 (fail loudly, never coerce): `parsePir` returns `undefined` for a blank PIR under
  `"pie"`/`"compare"` and deliberately does **not** invent a mapper-level message, so
  `computeAnnualTax`'s own `TaxInputError: pir is required when wrapper is "pie"` surfaces verbatim
  through `runProjection` (`components/projectionInputs.ts:406-410`, pinned by AC13). AC9 pins the
  same at the lib boundary, unwrapped.
- Invariant 13 (`NaN`/`Infinity` never render): `formatNzd` returns `"—"` for a non-finite value
  (`:479-485`); AC11 sweeps every numeric field of `years`, both `ProjectionResult`s and the
  comparison summary across five fixtures; AC15 asserts the explainer never contains
  `NaN|Infinity|undefined`.
- Invariant 15 (float64 is fine): `WRAPPER_TIE_EPSILON_NZD = 1e-6` is documented as drift-absorbing
  only, and Fixture E's ties come out exactly `0` (`toBe(0)`), so the epsilon is not doing hidden
  work.
- TypeScript strict: no `any`, no `!`, no `as` in the appended block or in `projectionInputs.ts`'s new
  code — the `mustParse*` helpers re-check at runtime instead. `tsc --noEmit` clean.
- Comments explain *why* (D-number citations, the reason tax is reported but not ranked on, the
  reason `pir` is parsed in compare mode). Fix 2 is the one comment that explains something untrue.

**Correctness of the flip logic.** `firstDecisiveYear` scans `[1, N]`, skipping year 0 (the shared
pre-growth snapshot); `flipYear` requires a *non-tie* winner different from `firstDecisiveWrapper`
and `break`s on the first one, so Fixture F's year-4 reversal back to `"pie"` is correctly not
reported. Off-by-one (X4), last-flip (M5), scan-shift (M6), tie-as-flip (M8) and `0`-for-`null` (M7)
all die. `flipYear` is guarded on `firstDecisiveWrapper !== null`, so an all-tied comparison returns
all four fields `null` (AC5).

**The explainer says something real**, not a generic label: it names the regime word (`FIF`/
`Dividend`), the method (`FDR`/`CV`/`actual dividends`), the above/below position against
`formatNzd(DEFAULT_FIF_DE_MINIMIS_NZD)`, the applied rate with the cap suffix, the withholding rate,
and the first year `taxRegime` changes — all read off already-computed rows.

**TDD evidence.** `notes.md` records per-AC individual RED runs for ACs 2–15 with real assertion
messages and per-run pass/skip counts, and discloses two structurally-unavoidable exceptions: AC1
(a regression pin that invokes no new code, so it cannot RED) and AC13's `"'pie'/'direct' →
comparison undefined"` case (the absent field already reads `undefined`). Both match the disclosed
pattern from `crossover-target-income`. ACs 19/20 were not RED-first — spec.md:184 lists them as
mandatory, but they pin behaviour that shipped in Cycle 0, so a RED would have required breaking
source. The coder substituted mutation evidence, and I re-ran every one of those mutations myself
above: they all die. I am satisfied the tests are real and not vacuous, so I am not asking for a
retro-RED; flagging it only so the process deviation is on the record.
