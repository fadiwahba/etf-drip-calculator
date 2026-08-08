# blend-composition — review

## Verdict

verdict: NEEDS_FIXES

The **code is correct**. Every acceptance criterion is met, all four gates are green on a clean
worktree at `d1c1a73`, the arithmetic was re-derived independently and matches, and 26 of 27
mutations (12 of the coder's + 15 of mine) were killed. Two **documentation** guardrail items were
missed, and one of them puts a factually wrong claim in the durable record. Both are cheap to fix.

### Fix list

1. **`features/blend-composition/notes.md:37-39` states a falsehood.** It says *"This repo is not a
   git repository (`Is directory a git repo: No`), so a literal `git diff` is not available."* It
   **is** a git repo, on branch `feat/nz-tax-engine`, and `git diff HEAD~1 HEAD -- lib/funds.ts`
   works. The Coder Guardrails require *"Put the `git diff` of `lib/funds.ts` in `notes.md`"* — that
   evidence is absent and replaced by a wrong justification. Replace lines 33-45 with the real
   diff (or at minimum the real `--numstat`, `261  0  lib/funds.ts`).
2. **Invariant 7 is not restated in the blend comment block.** The guardrails ask for it explicitly:
   *"Note invariant 7 — the blended total return is already net of fees, so a projection must not
   charge `expenseRatio` again."* `grep -n "invariant 7" lib/funds.ts` returns only line 20, the
   **pre-existing** module header written for the per-fund table. The blend block
   (`lib/funds.ts:299-341`) is where the trap is now live: it exposes a blended `expenseRatio`
   sitting directly beside a blended, already-net-of-fees `totalReturnAnnualised`, and the next
   slice's projection wiring is the consumer that would double-charge. Add the note to the D3
   paragraph.

Recommended, not required (the spec is silent, so this is not a gap against the contract):

3. `requested[]` weights are never asserted for an **unequal** allocation. See the surviving mutant
   under Code Quality.

## Spec Compliance

All 15 ACs verified. Independent checks, not a re-read of `notes.md`:

- **AC1 — pure append.** `git diff HEAD~1 HEAD --numstat` → `261  0  lib/funds.ts`,
  `352  0  lib/__tests__/funds.test.ts`, `221  0  notes.md`. Zero deleted lines anywhere;
  `grep -c '^-[^-]'` on the `lib/funds.ts` diff returns **0**. The diff is a single tail hunk
  (`@@ -295,3 +295,264 @@`), so all ten pre-existing exports are byte-identical and sit at their
  original line numbers. `DIVIDEND_BLEND_TICKERS` (`lib/funds.ts:362-369`) is the exact six in
  order. Test-file changes are additive: new imports and one new `describe`; no pre-existing
  assertion touched. Only three files in the commit — `data/*`, `lib/projection.ts`, `lib/nzTax.ts`,
  `types.ts`, `package.json`, `vitest.config.mts` and every component are untouched. No new
  dependency. No UI.
- **AC2/AC3 — strict is `null`, not zero.** `lib/funds.ts:495-505`: when any requested member fails
  `isProjectable`, `contributing` is set to `[]`, so all four figures and `asOf` come back `null`
  via `blendField`/`oldestContributingAsOf` (`:423-445`). `excluded` carries each fund's **own**
  `notes` (`:501`), and the test asserts `reason === getFund(ticker).notes` per ticker — a generic
  string dies (mutation R3). `requireBlendPriceGrowth` (`:548`) throws `MissingAssumptionError`
  naming FDVV and VYMI, never returns `0`.
- **AC4/AC7 — exclusion and renormalisation.** `:513-522` divides each survivor's weight by
  `survivorWeightSum`. I re-derived every figure by hand from `data/funds.json`, with
  `sharePriceGrowth = TR − yield` per fund (SCHD 0.0912, DGRO 0.1140, VIG 0.1155, EUFN 0.1131):

  | Fixture | growth | yield | ER | total return |
  |---|---|---|---|---|
  | B (4 × 0.25) | 0.4338/4 = **0.10845** | 0.0972/4 = **0.0243** | 0.0067/4 = **0.001675** | 0.531/4 = **0.13275** |
  | C (0.5/0.3/0.2) | **0.1029** | **0.02507** | **0.00062** | **0.12797** |
  | D (4/7, 2/7, 1/7) | 0.07083/0.7 = **0.1011857142857143** | 0.0184/0.7 = **0.026285714285714286** | 0.00044/0.7 = **0.0006285714285714286** | 0.08923/0.7 = **0.1274714285714286** |

  Every number matches the spec and the code's output. `isComplete` is `false` for B (`:534`,
  `excluded.length === 0`), `sources` keeps all six requested members, `asOf` is `2026-06-30`.
- **AC5 — §6 identity.** Holds for B, C, D and E to 10 places, as it must: all three fields are
  linear in the same weights over one membership.
- **AC6 — weighted, not plain.** Fixture C uses **0.5 / 0.3 / 0.2** and fixture D renormalises to
  **4/7, 2/7, 1/7** — both genuinely unequal, so the plain-mean mutation is not vacuous. Confirmed:
  see mutation C1 below.
- **AC8 — a `null` field nulls the field, not the member.** `blendField` (`:423-435`) returns `null`
  on the first `null` it meets and never falls through to `0` or to a `continue`. Fixture E's
  `expenseRatio` is `null` while growth/yield/TR are numbers over the same two members.
- **AC9 — provenance.** `oldestContributingAsOf` (`:437-445`) reduces to the minimum ISO date over
  **contributing** members only; `sources` (`:482-486`) is built from `resolved`, so excluded funds
  keep their `asOf` and `source`. `["VIG","SCHD"] → 2026-06-30`, `["VIG"] → 2026-07-31` (so it is
  computed, not pinned to `FUND_DATA_AS_OF`), E → `2026-04-30`.
- **AC10 — tolerance.** `BLEND_WEIGHT_SUM_TOLERANCE = 1e-9` (`:379`) with `Math.abs(sum - 1)`;
  `0.5 + 0.5000001` and a Σ of 0.9 throw, `0.5 + (0.5 + 1e-12)` is accepted, six copies of `1/6`
  pass.
- **AC11 — rejects.** Empty membership, `equalWeights([])`, unknown ticker, duplicate ticker, and
  weights of `NaN`, `Infinity`, `-Infinity`, `-0.1`, `0` and `"0.5"` all throw `FundDataError`
  naming the ticker or field. `"loose" as BlendPolicy` throws too — `policy` is validated at
  runtime (`:387-394`), not only in the type.
- **AC12 — `policy` genuinely has no default.** I re-ran the mutation on **both** functions, per the
  brief. Both die, twice over — see below. `tsc --noEmit --listFiles` confirms
  `lib/__tests__/funds.test.ts` **is** in the tsc program, so the `@ts-expect-error` directives
  really bite.
- **AC13 — pure and finite.** No mutation of either argument; every non-null figure is finite;
  `Σ members.weight` within `1e-12` of 1. I also ran the degenerate case the ACs do not cover —
  `buildBlend(equalWeights(["VYMI","FDVV"]), "excludeUnprojectable")`, where every member is
  excluded. The `survivorWeightSum > 0` guard (`:515`) holds: all four figures and `asOf` are
  `null`, `members` is `[]`, no `NaN` from a 0/0 division.
- **AC14 — before/after table.** Present in `notes.md:53-70` with every required figure, delta,
  the EUFN 73% attribution, the crossover-later trade-off line, and the D1 table. The restatement
  is numerically identical but not literally verbatim (`0.02051666̅` vs the spec's `0.0205166̅`) —
  same value, no action needed.
- **AC15 — gates.** All four green on a **clean worktree** at `d1c1a73` (temp worktree, now
  removed; `git worktree list` shows only the main tree, `git status` is clean apart from the
  pre-existing lean-spec bookkeeping files):

```
pnpm lint                → ✔ No ESLint warnings or errors
pnpm exec tsc --noEmit   → tsc exit=0
pnpm test                → Test Files 4 passed (4) · Tests 189 passed (189)
pnpm build               → ✓ Generating static pages (7/7), 4 routes
```

Independently confirms the orchestrator's numbers: lint 0, tsc 0, **189** tests, build 0.

## Code Quality

**Mutation testing — 27 run, 26 killed.** Default reporter only, real pass/fail counts read; the
file was restored from a golden copy between every run. The coder's 12 all reproduce as reported.

| # | Mutation | Result |
|---|---|---|
| C1 | weighted → plain mean in `blendField` | **Killed** — AC6, AC7 |
| C2 | skip renormalisation (keep sub-1 weights) | **Killed** — AC4, AC7, AC13 |
| C3 | renormalise by member count (`1/n`) | **Killed** — AC7 |
| C4 | `null` field coerced to `0` (`value ?? 0`) | **Killed** — AC8 |
| C5 | per-field re-exclusion (`continue` on `null`) | **Killed** — AC8 |
| C6 | `asOf` = newest contributing | **Killed** — AC4, AC9 |
| C7 | `asOf` = first-listed, no comparison | **Killed** — AC9 |
| C8 | `sources` drops excluded funds | **Killed** — AC2, AC4 |
| C9a | `policy` defaulted on **`blendFunds`** | **Killed twice** — `tsc` `TS2578: Unused '@ts-expect-error'` at `funds.test.ts:708`, **and** AC12's `blendFunds.length === 3` |
| C9b | `policy` defaulted on **`buildBlend`** | **Killed twice** — `tsc` `TS2578` at `funds.test.ts:706`, **and** AC12's `buildBlend.length === 2` |
| C10 | `requireBlendPriceGrowth` returns `0` | **Killed** — AC3 |
| C11 | exact `=== 1` weight sum | **Killed** — 8 tests |
| C12 | drop the `weight <= 0` check | **Killed** — AC11 |
| R1 | `isComplete` hardcoded `true` | **Killed** — AC2, AC4 |
| R2 | strict leaks a number (blends survivors anyway) | **Killed** — AC2, AC3 |
| R3 | `excluded.reason` = generic string | **Killed** — AC2 |
| R4 | `sources.asOf` flattened to `FUND_DATA_AS_OF` | **Killed** — AC9 |
| R5 | duplicate-ticker check removed | **Killed** — AC11 |
| R6 | weight tolerance loosened `1e-9` → `1e-3` | **Killed** — AC10 |
| R7 | `weight <= 0` relaxed to `weight < 0` | **Killed** — AC11 |
| R8 | unknown ticker silently dropped | **Killed** — AC11 |
| R9 | `equalWeights([])` returns `[]` | **Killed** — AC11 |
| R10 | `excluded.requestedWeight` zeroed | **Killed** — AC7 |
| R11 | `Number.isFinite` weight guard removed | **Killed** — AC11 |
| R12 | `requested[]` reports `1/n` instead of the caller's weight | **SURVIVED (189 passed)** |
| R13 | `members[]` order reversed | **Killed** — AC4, AC6, AC7 |
| R14 | `blendFunds` sorts the caller's `members` array in place | **Killed** — AC4, AC6, AC7, AC13 |

The two mutations the brief singled out both die hard. **C4 (null → 0) is killed by AC8**, and C2
plus C3 close the two other routes to the banned 0.0723 figure. **C9a and C9b are each killed by
two independent mechanisms** — the arity check catches a default even when tsc is not run, and tsc
catches it even if the arity check were deleted. The `@ts-expect-error` strengthening the coder
describes is real and effective.

**The one survivor, R12,** is a test-coverage gap, not a defect: the implementation
(`lib/funds.ts:478-481`) correctly echoes the caller's requested weights, but no test would notice
if it stopped. Every fixture that asserts `requested` (A, via AC2) uses `equalWeights`, where
`1/n` and the requested weight are the same value, so the mutant is invisible. The spec only asks
for `requested` length 6 with `weight === 1/6` (AC2), so this is **not** an AC failure — but the
next slice renders editable weights off this array, so one assertion on fixture C or D that
`requested.map(r => r.weight)` equals `[0.5, 0.3, 0.2]` would close it cheaply.

**Tests are not weakened.** Every positive rate assertion uses `toBeCloseTo(x, 10)`, exactly the
spec's precision; weight sums use `1e-12`; nulls use `toBeNull()`, not falsy. The lower precisions
in AC6 and AC7 (`not.toBeCloseTo(0.1069, 3)`, `not.toBeCloseTo(0.0006, 5)`) sit on **negative**
assertions, where a lower precision is a **stronger** claim — it demands the gap be at least
`0.0005` rather than `5e-11`. That is a tightening, not a loosening. No tolerance was relaxed below
the spec anywhere.

**TDD evidence — genuine RED, but the order was inverted.** `notes.md:99-172` records a real
per-AC RED pass with distinct, value-level assertion messages against a stub (`expected [] to
deeply equal [ 'SCHD', 'DGRO', 'EUFN', 'VIG' ]`, `expected null to be close to 0.12`, and so on) —
not a suite-level import error, which the guardrails correctly reject. AC1 and AC12 passing on the
stub is disclosed and expected: they assert a constant and a type. But the guardrail says *"Write
each AC's test, run it alone, record the assertion message, then implement"*, and the coder wrote
the implementation first, then stubbed the bodies to manufacture RED. The evidence is honest and
disclosed, and it demonstrably discriminates (27 mutations prove the suite bites), so I am not
failing the slice on it. Flagging it so it does not become the house pattern: writing the code
first is how expected values get quietly reconciled to whatever the code produces. It did not
happen here — I re-derived all four fixtures independently and the spec's numbers are right — but
the safeguard was bypassed.

**Constitution adherence.** §8 is honoured: unavailable is `null`, never `0`, never `""`, and every
blended field carries provenance through `sources`. One thing I checked rather than assumed —
`reason: member.fund.notes ?? ""` (`:501`, `:511`) looks like it could emit an empty string, which
§8 bans. It cannot: `parseRow` (`lib/funds.ts:225-230`) already refuses to load any row with a
`null` `totalReturnAnnualised` or `dividendYield` and no non-empty `notes`, and those are exactly
the rows `isProjectable` rejects. The `?? ""` is unreachable defensive code, not a hole. §1 and
invariant 14 hold: invalid requests throw naming the ticker or field, nothing is coerced to `0`,
`NaN`/`Infinity` never returned. §2 holds: all arithmetic is in `blendFunds`, `buildBlend`
(`:544-546`) only supplies `loadFunds()`. §3 holds: no allocation is invented — `equalWeights` is
the only weight source, and it is not an optional argument. The module stays pure: no React/Next,
no I/O, no `Date.now()`, no mutable module state, no `any`, no `!`, no silencing `as`.

**On the CAGR approximation.** The code does what the spec says — plain weighted arithmetic means
throughout — and the limitation is documented at the API, not glossed. The D3 paragraph
(`lib/funds.ts:322-331`) states that a weighted arithmetic mean of CAGRs is not the blend's CAGR in
general, that it is exact only under annual rebalancing, gives the buy-and-hold formula it is not
using, and quantifies the gap with a worked example (50/50 of 20%/0% → 10.00% rebalanced vs ≈13.65%
buy-and-hold). I checked that figure: `(0.5 × 1.2^10 + 0.5)^(1/10) − 1 = 13.65%`. Correct. The one
thing missing from that same block is the invariant 7 note — fix item 2 above.
