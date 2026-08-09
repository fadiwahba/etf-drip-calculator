# Review — sourced-dividend-growth

## Verdict

verdict: APPROVE

All ten ACs verified independently, not read. Four gates re-run in a throwaway worktree at
`9f05efa` (detached, `node_modules` symlinked, removed afterwards):

```
pnpm lint            ✔ No ESLint warnings or errors                    exit 0
pnpm exec tsc --noEmit                                                 exit 0
pnpm test            Test Files 4 passed (4) · Tests 224 passed (224)  exit 0
pnpm build           ✓ Compiled successfully · 7/7 static pages        exit 0
```

`HEAD~1` gives `Tests 205 passed (205)` — +19 tests, zero pre-existing tests edited, removed or
loosened (the only `-` lines in the test diff are one import line and the `makeForm` insertion
context). Worktree removed; `git worktree list` shows only the main checkout; `git status` shows
only the orchestrator's own `workflow.json`.

## Spec Compliance

**AC1–AC3 (seed).** `seedAssumptionsFromFund(getFund("SCHD"))` returns
`dividendGrowthPercent: 9.120000000000001`, the identical float as `sharePriceGrowthPercent` —
assigned from one local, not re-derived (`components/projectionInputs.ts:369-371`), so `===` holds
exactly. `VYMI` returns `ok:false` with `dividendGrowthPercent: ""` (`:356`). `fund.dividendGrowth`
is never read; my mutation R1 (prefer `fund.dividendGrowth` when non-null) is killed by SDG-AC3.

**AC4–AC6 (the linking rule) — exercised, not read.** I drove the real reducer through the full
sequence:

```
start                            spg 9.12  dg 9.12  linked true
applyFieldChange(spg, "7.5")     spg 7.5   dg 7.5   linked true    <- tracks
applyFieldChange(dg,  "0")       spg 7.5   dg 0     linked false   <- flag flips on a typed 0
applyFieldChange(spg, "12")      spg 12    dg 0     linked false   <- NOT overwritten
buildProjectionInput             dividendGrowth 0 · sharePriceGrowth 0.12 · flag absent
```

The failure mode the spec fears — a later price-growth edit silently overwriting the user's number
— does not occur. A user-entered `"0"` is a real edit, breaks the link (`:406-408`), survives, and
reaches the engine as `0`, not as empty. A cleared field (`""`) still errors
(`"Dividend growth (%) is required"`), so `Number('')` never becomes a silent zero. While linked an
invalid price-growth string copies verbatim and raises on **both** fields — the guardrail's stated
intent. `applyFieldChange` returns a new object and does not mutate the input (mutation R2 killed).
Unrelated fields pass through untouched.

**AC7 (helper text).** The two strings match the spec byte-for-byte and genuinely differ by state
(`:418-421`); mutation R4 (ignore the flag) is killed. The old *"No fund publishes a multi-year
per-share dividend CAGR"* sentence is gone from all rendered output — the only surviving occurrences
are a code comment and the regression test that asserts its absence. Both replacements state a
**convention**, neither claims a source.

**AC8.** `"dividendGrowthLinked" in value === false` on the built input, confirmed live.

**AC9/AC10 (the numbers) — recomputed by me through `runProjection`, not copied:**

| figure (real) | `dg = "0"` | `dg = "9.12"` | spec |
|---|---|---|---|
| `rows[30].grossDividendsNzd` | 2204.163 | 39241.199 | 2204 / 39241 ✔ |
| `totalDividendsDrawnNzd` | 38989.258 | 366579.489 | 38989 / 366579 ✔ |
| `crossover.finalYearNetIncomeNzd` | −11858.599 | +20983.817 | −11859 / +20984 ✔ |
| `crossover.crossoverYear` | `null` | `null` | `null` ✔ |
| raw final-year ratio (real) | 0.00237002 | 0.03249999999999998 | ✔ |
| raw final-year ratio (nominal) | 0.00237002 | 0.03249999999999999 | identical string ✔ |

The headline claim holds: under constant yield the effective yield returns to the entered
3.25% to within 2e-17, and collapses to 0.24% when the rates diverge. The crossover is genuinely
`null` in both columns — verified, not assumed. `rows.length` is 31 (year 0 + 30 compounded years),
consistent with invariant 1.

**Out of Scope respected.** `git diff HEAD~1 HEAD -- lib/ data/ package.json` is empty. All six
rows in `data/funds.json` still carry `"dividendGrowth": null`. No fabricated CAGR anywhere: a grep
for `0.1118`/`11.18`/`6.70` across `lib/ data/ components/` returns nothing. Only the three
sanctioned files plus `notes.md` changed. No new dependency, no restyling (the new tile reuses the
existing `flex-wrap` summary row and the same two-`<p>` tile markup).

## Code Quality

**Mutation testing — 17 mutants, my own R1–R11 plus the coder's six re-run.** Killed: seed reverts
to `0`; linked edit stops tracking; link guard removed so a price edit always overwrites; typed
`"0"` treated as empty; flag never flips; seed prefers `fund.dividendGrowth`; reducer mutates its
input; yield reads the first row instead of the last; helper text ignores the flag; `*100` dropped;
both yield guards dropped; unlink also on a share-price edit; `runProjection` stops returning
`real`. Every kill was a real assertion failure under the default reporter (`--reporter=basic` not
used).

**Survivors — judged, not waved through.**

1. *The coder's disclosed one*, `closingSharePriceNzd === 0` at `:700`. I built the case: with
   `closingSharePriceNzd = 0` and a positive `dividendPerShareNzd` the ratio is `+Infinity`; with
   both zero it is `NaN`; with `-0` it is `-Infinity`. All three are caught by
   `!Number.isFinite(ratio)` at `:704`, and the user sees `"—"` on every path. **Genuinely redundant
   defensive code, not a coverage gap** — the behaviour under test is identical with or without it,
   and invariant 13 is satisfied either way. Keeping the explicit guard is the right call and the
   write-up is honest.
2. *The dual*, dropping only `!Number.isFinite(ratio)`, also survives. The one input that
   distinguishes it is a non-finite `dividendPerShareNzd`, which is outside AC9(d)'s stated cases and
   unreachable from a validated `ProjectionInput`. Worth knowing, not worth a cycle: the two guards
   are mutually redundant across every tested case but jointly cover one untested one, so the code is
   strictly safer than the tests prove.
3. `.tsx`-only mutants survive by design — reverting `dividendGrowthPercent` to `"0"` at
   `InvestmentProjectionCalculator.tsx:43`, starting unlinked at `:44`, or restoring the deleted
   helper sentence at `:236` all keep 224/224 green. Rendering tests are explicitly Out of Scope, so
   this is spec-sanctioned; I verified all three by reading the diff instead. Flagging it as the
   slice's residual risk, not as a defect: the user-visible half of this feature has no automated
   guard.

**Correctness of the new code.** `applyFieldChange` (`:385-411`) is the single place the link is
applied or broken, and `handleFieldChange` (`.tsx:85-90`) is a true one-line delegate — every one of
the 16 text inputs routes through it; `handleTaxModeChange` and the real-terms toggle keep their own
setters and are correctly excluded from the field type. No `as`, no `!` in either file; the
`dividendGrowthLinked` no-op branch is the honest way to satisfy the guardrail's literal `Exclude`
type. `formatFinalEffectiveYield` does the one division the spec allows and nothing else, and is
typed `Pick<ProjectionResult, "rows">` so nominal and real both fit. The tile carries no
`headingSuffix`, which is right — the ratio is deflator-invariant, so a "today's dollars" tag would
be a false claim.

**TDD evidence.** The RED runs in `notes.md` are per-AC and show the specific wrong value each time
(`expected +0 to be 9.120000000000001`, `expected "9.12" to be "5"`, `expected '' to be 'Tracks
share price growth…'`), not a generic import failure. AC8's second half was proved non-vacuous by a
temporary injected leak, reverted — I confirmed the committed file has no such line. AC10 is
correctly described as a characterization test rather than claimed as RED-first. Nothing looks
retrofitted.

**Two nits, neither worth a fix cycle.** (a) `components/projectionInputs.ts:676-693`:
`formatFinalEffectiveYield` was inserted *between* `formatRegimeCell`'s long explanatory comment and
`formatRegimeCell` itself, so the pie-de-minimis paragraph now reads as if it documents the new
function. (b) Several new tests use `if (!run.ok || !run.real) return;` as a type narrowing escape
hatch; a mutant that stops populating `real` would slip past them, though pre-existing tests kill
that mutant today (3 failures). Both are pre-existing house style, not regressions introduced here.

Nothing found that would put a wrong number in front of a user. Safe to merge.
