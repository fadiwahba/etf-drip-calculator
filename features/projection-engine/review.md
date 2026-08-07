# review — projection-engine (cycle 1 re-review)

## Verdict

verdict: APPROVE

All four cycle-0 findings are genuinely closed. Both mutations that survived last pass now fail a
test. Three new mutations aimed at the cycle-1 changes all die. No AC was dropped or weakened, the
test diff is additive, and the single source change is 7 lines with no behavioural effect. Four
gates green.

Arithmetic already re-derived and confirmed in cycle 0 (AC1, AC4, AC6, AC8–AC16 including the
two-year AC16 golden) was not re-litigated.

### Gates — real output

```
$ pnpm test
 Test Files  3 passed (3)
      Tests  58 passed (58)      # 21 in projection.test.ts

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
 ✓ Generating static pages (7/7)
Route (app): / 4.01 kB · /_not-found 977 B · /etf-comparison 68.6 kB · /retirement 11 kB

$ pnpm exec tsc --noEmit
(no output, exit 0)
```

## Spec Compliance

**F1 — AC13 vacuous. CLOSED.** Re-ran the exact cycle-0 mutation: `purchasesNzd: purchases` →
`purchasesNzd: contributionsInvested` at `lib/projection.ts:281` (the `computeAnnualTax` call only,
`costBasis += purchases` untouched).

```
 × AC13b — omitting the DRIP from the CV base would flip FDR/CV here
      Tests  1 failed | 57 passed (58)
```

Killed. Note precisely *what* killed it: **AC13b**, not the new `purchasesNzd` row field. See Code
Quality note 1.

**AC13b arithmetic — re-derived by hand, correct.** 10,000 sh @ 10, cost 100,000, g −0.01 →
closing price 9.90. dps 0.55 → gross 5,500, WHT 825, DRIP 4,675 → +472.2222 sh → 10,472.2222 sh ×
9.90 = **103,675** (= 99,000 + 4,675). purchases **4,675**, cost basis **104,675** (> 50,000, FIF
applies). FDR = 5% × 100,000 = 5,000. CV = 103,675 + 5,500 + 0 − (100,000 + 4,675) = **4,500** <
5,000 → `"cv"`, taxable **4,500**. Gross 4,500 × 0.33 = 1,485, WHT credit 825 → payable **660**,
total **1,485**. Drop the DRIP from purchases and CV rises to 9,175 > 5,000 → flips to `"fdr"`.
The committed test (`lib/__tests__/projection.test.ts:407-427`) asserts exactly these seven values.

**F2 — fee base unpinned. CLOSED.** Re-ran `valueBeforeFees = shares * closingPrice` →
`= openingValue` at `lib/projection.ts:262`.

```
 × AC8b — fee base is the post-DRIP closing value, not opening value
      Tests  1 failed | 57 passed (58)
```

**AC8b arithmetic — correct and genuinely discriminating.** 1,000 sh @ 10, g 0.10 → closing price
11, opening value 10,000. dps 0.5 → gross 500, no WHT → +45.4545 sh → 1,045.4545 sh × 11 =
**11,500**. expenseFee 1% × 11,500 = **115**; platformFee 0.2% × 11,500 = **23**
(`projection.test.ts:275-276`). The fixture separates three candidate bases cleanly: opening 10,000
→ 100/20; pre-DRIP closing 11,000 → 110/22; post-DRIP 11,500 → 115/23. I confirmed the middle one
too as a new mutation (M4 below) — it also dies.

**F3 — AC19 ran 3 of 16 fixtures. CLOSED.** `projection.test.ts:589-720` now runs 15 explicit
fixtures plus AC5's `projectFund` path: AC1/2, AC3, AC4, AC6, AC7, AC8, AC8b, AC9, AC10,
AC11/12/13, AC13b, AC14, AC15, AC16, degenerate, AC5. That is every AC producing a
`ProjectionResult`; AC17/AC18 are throw-path tests with no result, correctly excluded. Each entry
matches its named AC's input.

`assertAllFinite` (`projection.test.ts:46-60`) walks `Object.entries` of the summary and of every
row, so it covers all numeric fields including newly added ones. Verified by mutation, not by
reading: setting the year-0 row's `purchasesNzd` to `NaN` makes AC19 fail — the old hardcoded list
would have missed it. It cannot pass on an empty list: the fixtures array is a 15-entry literal and
every row/summary carries numeric fields. (One residual blind spot — Code Quality note 3.)

**F4 — false git-history claim. CLOSED.** `notes.md` now states the stub was written locally, run
once, excerpted, then overwritten without being committed. I verified this independently:
`git log --all --oneline -- lib/projection.ts` returns exactly two commits (`878c393`
implementation, `ae02123` this fix) and `git stash list` is empty — so no stub exists in history
and the corrected sentence is accurate. The diff shows only that one sentence replaced; every RED
excerpt below it is untouched. No evidence removed.

**No regression.** All 19 ACs still present and asserted (`AC1…AC19`, 21 `it()` blocks with AC8b
and AC13b). The test-file diff is additive apart from two rewrites, both of which strictly widen
coverage: `assertAllFinite`'s field derivation and AC19's fixture list. AC13 keeps all three of its
original assertions (cost-basis delta, `taxMethod`, `taxableIncomeNzd`) and gains one. No
`toBeCloseTo` precision was loosened and no assertion was deleted.

## Code Quality

**New mutations run this pass** (all applied to `lib/projection.ts`, all reverted; `git status`
shows `lib/` clean, only the pre-existing unrelated modifications to `app/etf-comparison/page.tsx`,
`components/RetirementAnalysis*.tsx` and `workflow.json` remain):

| # | Mutation | Result |
|---|---|---|
| M3 | `const purchases = contributionsInvested + dividendsReinvested` → `= contributionsInvested` (line 274 — drops DRIP from row field *and* tax arg) | **killed** — AC11, AC13, AC13b fail |
| M4 | `valueBeforeFees = shares * closingPrice` → `= openingShares * closingPrice` (pre-contribution, pre-DRIP base) | **killed** — AC8b fails |
| M5 | year-0 row `purchasesNzd: 0` → `NaN` (line 193 — the field the old hardcoded AC19 list would have missed) | **killed** — AC19 fails |

**1. `purchasesNzd` is a value witness, not an argument witness (non-blocking).** The F1 mutation
mutates the `computeAnnualTax` argument at `lib/projection.ts:281`, while the row field is
populated separately at line 318 from the same `purchases` local. So `expect(row.purchasesNzd)` at
`projection.test.ts:395` and `:422` did *not* fail under that mutation — only AC13b's
`taxMethod`/`taxableIncomeNzd` assertions did. The two lines can drift apart without a test
noticing. A `vi.spyOn` on `computeAnnualTax` asserting the argument object would be the tighter
pin. Not blocking: AC13b kills the defect class through observable output, which is the stronger
kind of test anyway, and M3 confirms a change at the shared source (line 274) is caught three ways.

**2. Is the `purchasesNzd` row field scope creep? No — accept, with one spec note.** Spec AC13
(`spec.md:136`) says "assert `purchasesNzd` explicitly" and AC11 (`spec.md:128`) names
`purchasesNzd` as a checked quantity, so exposing it is a defensible reading of the contract. It
is 7 lines, pure widening, no behaviour change, no consumer, and carries a *why* comment
(`lib/projection.ts:51-54`) as the guardrails require. Confirmed the only source change: three
hunks adding the field to the interface, the year-0 row, and the loop row. Minor spec mismatch
worth recording for the next spec author: `purchasesNzd` is **not** in the row field list at
`spec.md:69-75`, so the spec contradicts itself slightly here. The test-only alternative (the spy
in note 1) would have avoided touching source; given the value was already computed and the spec
names it, exposing it is the simpler and more honest choice.

**3. AC19's runtime derivation traded one blind spot for another (non-blocking).** `typeof value
=== "number"` skips any field that is *not* a number — including `undefined`. Verified by mutation
M6: setting the year-0 `purchasesNzd` to `undefined as unknown as number` passes all 58 tests,
where the old hardcoded list would have gone RED because `Number.isFinite(undefined)` is `false`.
Consequence: the comment at `projection.test.ts:45` — "Deriving it also means a stub with missing
rows/fields goes RED" — is **factually wrong**; a missing field is now silently skipped. In
practice TypeScript strict makes a missing field a compile error, so the risk is low and this does
not block. If the coder wants both properties, assert the row's key set against a small expected
list *and* run the runtime finiteness walk. At minimum, correct the comment — a wrong claim in a
comment about test coverage is exactly the class of thing that made F4 a finding.

**Constitution / guardrails.** `lib/projection.ts` still contains no rate, threshold, lower-of
comparison or de minimis logic — every tax figure comes from `computeAnnualTax` (lines 277-289) and
`taxMethod`/`aboveThreshold` are read from its result. Fee drag is share-count only (line 267), not
folded into the rate. No `any`, no non-null assertion, no React/Next import, no `Date.now()`, no
module state. Only the two permitted files were touched. Notes' claimed gate output matches what I
re-ran.
