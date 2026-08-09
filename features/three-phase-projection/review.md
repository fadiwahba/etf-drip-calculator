# three-phase-projection — review

Reviewed commit `b242db9` (`feat(three-phase-projection)`) against `spec.md` (as corrected by
`e901d22`). All gates and probes were run in a **detached clean worktree at `b242db9`**, removed
afterwards; the repo tree is unchanged.

## Verdict

verdict: APPROVE

Every AC is met. The additive guarantee holds byte-for-byte on 500 random inputs plus the real
UI-default scenario. Tax is phase-independent. No share is ever sold to fund income. 15 mutations
run independently, 14 killed. Two non-blocking findings (F1, F2) are recorded below for a later
slice — neither changes a shipped number.

## Spec Compliance

**Gates (clean worktree at `b242db9`, real output):**

```
pnpm lint             ✔ No ESLint warnings or errors      LINT_EXIT=0
pnpm exec tsc --noEmit                                    TSC_EXIT=0
pnpm test             Test Files 4 passed (4) · Tests 98 passed (98)
pnpm build            ✓ Compiled successfully · 7/7 static pages   BUILD_EXIT=0
```

**AC1/AC2 — the additive guarantee (the whole risk of this slice).** Confirmed independently, not
by "tests pass". I extracted `git show a65b52e:lib/projection.ts` into the worktree and diffed the
two engines' output over **500 pseudorandom inputs** (both wrappers, all five marginal rates, gain
and loss years, gross and net basis, both timings, fees on and off), comparing every summary and
row field with `Object.is` (so `-0` and drift both fail) and asserting identical key sets and
identical thrown error strings. **Zero differences**; every row `phase "accumulate"`,
`dividendsDrawnNzd 0`, `totalDividendsDrawnNzd 0`. Repeated on the UI-default scenario
(100k / 15y / SCHD seed / direct 33% / WHT 15%): all 16 rows identical field-by-field.

**Pre-existing ACs intact.** `git diff a65b52e b242db9 -- lib/__tests__/projection.test.ts` is a
**single append hunk (`@@ -755,3 +755,286 @@`), zero deleted lines**; 21 `it(` blocks before, 30
after (21 + 9 new). `components/__tests__/projectionInputs.test.ts`: zero deleted lines; the only
non-append change is two blank-default fields in the shared `makeForm()` helper, disclosed in
`notes.md:239`. The three sanctioned AC3/AC4/AC5 corrections are the ones the spec now states
(`drawdownStartYear: 4` at `lib/__tests__/projection.test.ts:1000`/`1012`, `closingShares`
`1_129.977225` at `:1024`). No fixture was bent to fit the code.

**AC3–AC7, phase semantics** — `lib/projection.ts:221-225` is the single `resolvePhase` helper,
`??` on both fields, reused for year 0 (`:254`) and each loop year (`:289`). Boundaries verified
by my own fixtures: `contributionsStopYear: 0` → every row incl. year 0 `"draw"`,
`totalContributionsNzd 0`; `stop === draw` → no coast year; `drawdownStartYear` beyond the term →
coasts to the end, `totalDividendsDrawnNzd 0`; stop beyond term → inert. Off-by-one: year `stop`
is the first non-contributing year, and with `contributionsPerYear: 4` under **both** timings the
gate is all-or-nothing — `contributionsInvestedNzd`, `brokerageFeeNzd` and `fxSpreadCostNzd` are
all exactly 0 in the boundary year, no per-event leakage.

**Tax is phase-independent (priority 2).** Same scenario in Coast and in Draw, 400 random inputs,
comparing the **first** year the two runs differ. With fees zero the tax figures are **exactly
identical** (`taxRegime`, `taxMethod`, `aboveThreshold`, `taxableIncomeNzd`, `nzTaxPayableNzd`,
`totalTaxNzd`) across all three regime/method combinations actually exercised —
`dividend/actual-dividends`, `fif/fdr`, `fif/cv`. The `computeAnnualTax` call and its argument
construction (`lib/projection.ts:350-362`) are untouched by the diff.

*Observation, not a defect:* with **non-zero** fees two second-order differences appear, both
caused by the DRIP purchase genuinely not happening rather than by any tax-logic change — (a) the
de minimis tests **cost**, so a Coast run's extra DRIP purchase can cross NZ$50,000 in a year the
Draw run does not; (b) CV income is lower in Coast by `dividend × feeRate`, because the fee is
charged on the reinvested amount. Both follow from the pre-existing engine and from the spec's own
`purchasesNzd = 0` rule. Worth knowing before someone reads "tax does not change" too literally.

**Principal is never touched (priority 3).** Over 300 random decumulator runs (~2,900 draw years),
every Draw row satisfies `closingShares == openingShares − totalFees/closingPrice −
nzTaxPayableNzd/closingPrice` and `closingValueNzd == openingShares × closingPrice − totalFees`
to 1e-9 relative, with `purchasesNzd 0`, `dividendsReinvestedNzd 0` and a monotonically
non-decreasing `costBasisNzd`. The share reduction is only the pre-existing fee drag
(`lib/projection.ts:340`) and the pre-existing tax settlement (`:367`) — no new drawdown path.

**AC8 / error handling (priority 5).** `lib/projection.ts:194-215`. I tested each case
independently: non-integer `2.5`, `-1`, `NaN`, `+Infinity` **and `-Infinity`** on both fields all
throw `ProjectionInputError` naming the field; `{stop: 3, draw: 2}` and `{draw: 5}` alone both name
**both** fields; `{stop: 0}` and `{stop: 0, draw: 0}` do not throw. Nothing coerced to 0.

**AC9–AC13, UI (AC14).** `parseOptionalPhaseYearField` (`components/projectionInputs.ts:127`) is
the one place blank/zero is decided — `""` and whitespace → `undefined`, `"0"` → `0`,
`"abc"/"-1"/"2.5"/"60"/"1e3"/"NaN"/"Infinity"` all rejected with a named field error and no
coercion. `drawdownStartYear` alone builds fine at field level and surfaces verbatim from the
engine: `["ProjectionInputError: drawdownStartYear requires contributionsStopYear to also be
set"]`. `formatPhase` (`:314`) is the only phase→label mapping; the `.tsx` holds no phase logic,
no `"draw"` comparison and no arithmetic. Table: Phase after Year, Income Drawn after US WHT, all
other columns unchanged in order; header and body cell counts match. Total Income Drawn tile plus
the one static line. No restyling — the summary container is the pre-existing
`flex flex-wrap justify-between`, so the fifth tile wraps; no existing class was edited.
`NaN`/`Infinity` cannot print (`formatNzd` guard re-verified).

**AC15 — `notes.md` before/after table is real.** I recomputed all five metrics against the
pre-slice engine: year-1 tax `1162.5` / `1162.5` / `1162.5`; year-10 phase `accumulate` / `draw`;
year-10 drawn `0` / `2926.0622161231213`; year-15 final `382720.88733874005` (Before) =
`382720.88733874005` (After-blank) vs `361593.6905442671` (After-set); `totalDividendsDrawnNzd`
`0` / `16983.048694691126`. Every digit matches the table, and the "default path is identical"
claim holds field-by-field, not just on these five metrics.

**Scope.** The impl commit touches exactly the six permitted files. `lib/nzTax.ts`, `lib/funds.ts`,
`data/*`, `app/*`, `types.ts`, `vitest.config.mts`, `package.json` and `pnpm-lock.yaml` are
untouched; no new dependency.

## Code Quality

**Mutation testing (priority 4) — mine, not the coder's.** 15 mutations applied to
`lib/projection.ts` in the clean worktree, each run against the committed suite only, file restored
and verified identical after every run (`git diff` clean). *Note:* the coder's own harness would
have been unreliable — `vitest --reporter=basic` exits non-zero on Vitest 4 regardless of results,
so a batch using it reports everything "killed". I re-ran without it.

| Mutation | Result |
|---|---|
| `y < draw` → `y <= draw` | KILLED (3PP-AC4, AC5, AC6, AC7) |
| `isDraw = phase === "draw"` → `phase !== "accumulate"` | KILLED (3PP-AC3, AC5) |
| drop the tax settlement `shares -= tax/price` | KILLED (AC12, AC14–AC16, 3PP-AC1) |
| `y < stop` → `y <= stop` | KILLED |
| `draw = drawdownStartYear ?? Infinity` (coast forever) | KILLED |
| `??` → `\|\|` on `contributionsStopYear` | KILLED |
| year-0 phase hardcoded `"accumulate"` | KILLED |
| drawn cash gross of US WHT | KILLED |
| contributions continue through Coast | KILLED |
| `totalDividendsDrawnNzd` hardcoded 0 | KILLED |
| cross-field `<` → `<=` | KILLED |
| drop the negative-year check | KILLED |
| exclude the DRIP from `purchasesNzd` in Coast | KILLED |
| gate contributions on `phase !== "draw"` | KILLED |
| **platform fee skipped in a Draw year** (`lib/projection.ts:338`) | **SURVIVED** |

The three the coder reported are genuinely killed, by the tests they claimed.

**F1 (non-blocking, follow-up) — fee-drag phase-invariance is not pinned.** Making the platform fee
(or expense fee) conditional on `phase === "draw"` at `lib/projection.ts:338` leaves all 98 tests
green. Fixtures P, Q and R all run with zero fees, so no test observes a fee in a Coast or Draw
year, even though `spec.md:38-40` states the fee drag is byte-identical in all three phases. The
shipped code **is** correct — this is a coverage hole, not a wrong number. Suggested fix in a later
slice: one AC re-running fixture R with `platformFeeAnnualRate > 0` and asserting
`totalFeesNzd`/`closingShares` in a Draw year.

**F2 (non-blocking, cosmetic) — 3PP-AC9's fixture list drifted from the spec.**
`lib/__tests__/projection.test.ts:1034-1035` runs `makeFixtureP({contributionsStopYear: 2})` and
`makeFixtureP({stop: 2, draw: 2})`; because Coast is empty by default these are the *same* Draw
scenario, so the spec's named AC3 (Coast) fixture is never finiteness-checked. I ran a full
recursive finiteness walk over Coast, Draw, decumulator and beyond-term runs — everything finite,
so nothing is broken; the assertion just does not cover what the spec listed.

**Tests are real, not weakened.** New assertions use concrete hand-computed values at 6 dp, not
recomputations of the engine. The two `toEqual` vacuity traps the spec warned about are both
defused by an explicit `phase` assertion placed first (`:986`, `:1019`). AC7's `||`-discriminating
figures and AC3's stated counter-values (15,776.89 for an inclusive boundary, 13,880.94 for a
dropped DRIP) are exactly what my `y <= stop` and `isDraw` mutations produced.

**TDD evidence.** `notes.md:77-116` records one genuine per-AC assertion failure per AC (values, not
import errors) — I confirmed Vitest's esbuild transform does not type-check, so a missing field
fails only its own test. The one honest exception is disclosed rather than hidden: 3PP-AC9 passed
pre-implementation because `assertAllFinite` enumerates fields at runtime and absent fields are not
`NaN`. That is a structural limit of that helper, documented in its own comment, and the assertion
is a real guard now that the fields exist.

**Constitution.** §1 fail loudly — every malformed phase year throws, nothing is clamped. §2 one
engine — the phase decision exists once (`resolvePhase`), year 0 included; the mapper only parses
and passes through; `formatPhase` is the sole label mapping; the tax call's arguments are
untouched. §5 deemed return — the Draw branch changes only reinvestment, never the tax base.
Comments explain *why* (boundary semantics, `0` is not "unset", tax invariance, the settlement
inside the share count). TypeScript strict throughout: no `any`, no non-null assertion, no `as`
silencing a missing field (the only `as` are test-local error narrowings).
