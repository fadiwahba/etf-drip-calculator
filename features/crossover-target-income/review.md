# crossover-target-income — review

## Verdict

verdict: NEEDS_FIXES

The headline number is **correct**. I re-derived fixture T from first principles and the
implementation, the engine and the spec's own closed form all agree. Priorities 1–4 all pass.
Two of my own mutations **survived**, and both pin sentences the spec states explicitly, so the
suite does not yet defend the C2 "never clamp" rule or the C5 "sustained to the end" definition.
Plus `spec.md` still carries the wrong AC4 literals, so the contract and the code disagree on paper.
All are fixable in one cycle; none needs an owner decision, so this is not `BLOCKED`.

---

## Spec Compliance

### PRIORITY 1 — the AC4 fixture deviation: **the coder is right**

I derived fixture T by hand, independently of the coder's note.

Year 1: value 100,000; divPerShare `0.5 × 1.1 = 0.55`; gross `10,000 × 0.55 = 5,500`; WHT 825;
FDR `5% × 100,000 = 5,000` at 33% = 1,650, less the 825 credit = 825 payable. Net = **3,850**.
Reinvested `5,500 − 825 = 4,675` at price 11 buys 425 shares; the 825 NZ bill sells 75 shares.
Closing shares **10,350** — a **1.035** share factor, so opening value grows at `1.1 × 1.035 =
1.1385`/yr, exactly the spec's own stated factor.

| t | openingValue(t) | `0.0385 × openingValue(t)` (hand) | engine | spec.md AC4 literal |
|---|---|---|---|---|
| 3 | 129,618.225 | **4,990.3016625** | 4,990.3016625 | 4,990.1284125 |
| 4 | 147,570.3491625 | **5,681.45844275625** | 5,681.45844275625 | 5,681.26119763125 |
| 5 | 168,008.84252150627 | **6,468.34043707799** | 6,468.34043707799 | 6,468.115873503178 |

Engine `openingValueNzd` printed from an unmodified checkout: `[100000, 100000, 113850,
129618.22500000002, 147570.3491625, 168008.84252150627]` — matching my hand figures.

**Two agree, one disagrees:** the spec's closed form and the engine (and my hand derivation) agree;
`spec.md:87`'s literal array is the outlier. `lib/__tests__/projection.test.ts:1380` uses the
correct values. **No wrong headline number ships.**

**Was resolving-in-place legitimate?** Plainly: **no, not by the letter of the contract.** Coder
Guardrails (`spec.md:171`) say "likewise if any expected value above disagrees with your arithmetic
— **stop and raise a blocker**". The coder documented it well (`notes.md:28-57`) and picked the
right number, but it substituted its own adjudication for the escalation the spec demanded. Three
earlier slices blocked on exactly this and were upheld; the rule should not weaken because the
coder happened to be right this time. The practical harm is real and durable: **`spec.md:87` still
carries 4990.1284125**, so the contract now permanently contradicts the code it governs, and the
next auditor must redo this derivation to know which side is wrong.

- **Fix 1 (owner/spec):** amend `spec.md:87` AC4's `i = 0` array to
  `[0, 3850, 4383.225, 4990.3016625, 5681.45844275625, 6468.34043707799]`. `spec.md` is outside the
  coder's touch list, so this needs an explicit spec amendment, not a silent edit.

### PRIORITY 2 — net dividends definition: **correct, no fee leak**

`lib/projection.ts:588` — `real.rows.map((row) => row.grossDividendsNzd - row.totalTaxNzd)`.
`lib/nzTax.ts:176` defines `totalTaxNzd = nzTaxPayableNzd + usWithholdingPaidNzd`, so this is
identically `gross − WHT − NZ tax payable` (C2). Verified numerically: the engine's
`gross − usWithholdingNzd − nzTaxPayableNzd` series equals the produced series to float64.
`totalFeesNzd` appears **nowhere** in `findIncomeCrossover` (lines 562-635). AC3 confirms behaviour
under a live 1% platform fee. Mutations M1/M2/M3/M4 all die (below).

### PRIORITY 3 — real vs nominal: **correct, real-vs-real**

`toRealTerms` divides `grossDividendsNzd`, `usWithholdingNzd`, `nzTaxPayableNzd` and `totalTaxNzd`
all by the same `closingDeflator = (1+i)^t` (`lib/projection.ts:465, 481-491`), so the net figure
inherits exponent `t` uniformly — one deflator, no mixing with the `t−1` `openingDeflator`.
`findIncomeCrossover` contains zero `(1+i)` arithmetic (C3) and echoes `real.inflationRate`
(line 628). `runProjection` returns `crossover: undefined` whenever `real` is undefined
(`components/projectionInputs.ts:392, 430`), so the nominal view cannot answer a real question.

Divergence scenario, run live on fixture T at target 3,800: **real answer year 4, nominal answer
year 1 — 3 years apart** in a 5-year fixture. AC5 (`projection.test.ts:1393`) pins both.

### PRIORITY 4 — AC6b genuinely discriminates: **verified**

The engine's year-3 real income is `3749.2875000000003638`; the spec's literal `3749.2875` sits
`4.55e-13` **below** it, so under a `>` mutation year 3 still passes and AC6 is vacuous for the
operator — the coder's report is accurate. I re-ran it:

- `>=` → `>` (and the sustained `<` → `<=`), full suite: **1 failed | 144 passed**, and the single
  failure is `AC6b — >= not > at the bit-exact boundary`.
- Same mutation with the AC6b **test body deleted**: **144 passed (144)** — the mutation survives.

So AC6b is the sole killer and is a real, not vacuous, boundary test. `projection.test.ts:1427`.

### Remaining ACs

AC1 additive (verified below) · AC2, AC3 (fees), AC5, AC7 (year 0 is `0`, length 6), AC8
(all-`accumulate` still crosses at 4; `contributionsStopYear: 0` draws 4,675 and still nets 3,500),
AC9 (`toBeNull` on all three, not falsy — confirmed live: `[null, null, null, 4016.33]`; never `0`,
`-1` or `5`), AC10 (de minimis dip: first 1, sustained 3), AC11, AC12 — all present and passing.

AC13–16 mapper: blank/whitespace ⇒ `undefined`, `"0"` ⇒ `0` (the `Number('')` trap is closed at
`components/projectionInputs.ts:193` by a `.trim() === ""` guard **before** any numeric parse),
`targetAnnualIncomeNzd` never enters `ProjectionInput`, toggle-off ⇒ `undefined`, one `project()`
call (`projectionInputs.ts:386` is the only call site; `toRealTerms` at 414, `findIncomeCrossover`
at 430 — three distinct one-shot calls).

AC17 UI: field, tile, all four message states, the reinvestment note, and a last-position
"Net dividend income" column gated on `crossover` being defined. No restyle of any existing
element — the new card copies the shape of the pre-existing card at line 421 and reuses the
`emerald-700`/`emerald-600` header/cell classes already in the file.

AC18 before/after table: I reproduced the UI-default row from an actual run. `crossoverYear`
**null** both ways; final-year net income **−1,568.51** real and **−2,443.69** nominal — matching
`notes.md:140` to the cent. The 3-year Δ is stated explicitly for row 1, and `1.03^30 ≈ 2.4273`
is present.

AC19 gates, clean worktree at `b116a08`:

```
pnpm lint              ✔ No ESLint warnings or errors
pnpm exec tsc --noEmit  tsc exit=0
pnpm test               Test Files 4 passed (4) · Tests 145 passed (145)
pnpm build              exit 0 · 4 routes prerendered
```

Untouched, confirmed by `git diff HEAD~1 HEAD --stat` returning empty for `lib/nzTax.ts`,
`lib/funds.ts`, `data/`, `package.json`, `types.ts`, `app/`, `vitest.config.mts`. No new dependency.

---

## Code Quality

### Pure append — confirmed

`git diff HEAD~1 HEAD --numstat -- lib/projection.ts` = **79 insertions, 0 deletions**, one hunk
`@@ -554,3 +554,82 @@`. `project()`, `projectFund()`, `toRealTerms()`, `validateInput`,
`resolvePhase`, `buildYearZeroRow` and the five interfaces are byte-identical. Both test files are
**purely additive** — `grep -E "^-[^-]"` on their diffs returns nothing; the only in-place change
is the new `targetAnnualIncome: "80000"` key in `makeForm()`, which the spec allows and
`notes.md`/the test comment disclose.

### Mutation testing — coder's nine re-run, all killed

Default reporter (no `--reporter=basic`), file restored between runs, full 145-test suite:

| # | Mutation | Result |
|---|---|---|
| M1 | drop WHT term | killed — 9 failed |
| M2 | drop `nzTaxPayableNzd` term | killed — 9 failed |
| M3 | subtract `totalFeesNzd` | killed — 1 failed |
| M4 | use `dividendsDrawnNzd` | killed — 10 failed |
| M5 | `crossoverYear = firstYearAboveTarget` | killed — 1 failed |
| M6 | `≥` → `>` | killed — 1 failed (AC6b, verified sole killer) |
| M7 | scan starts at index 0 | killed — 1 failed |
| M9 | return `0` instead of `null` | killed — 2 failed |
| M10 | drop target validation | killed — 1 failed |

M8 ("scan `rows` not real rows") is correctly reported as type-prevented — `RealProjectionResult`
carries `inflationRate`/`purchasingPowerLostNzd`, so a nominal result cannot be passed.

### My own eight mutations — six killed, **two survived**

| # | Mutation | Result |
|---|---|---|
| R1 | `firstYearAboveTarget = year + 1` | killed — 2 failed |
| R2 | `crossoverYear = year + 1` (off-by-one) | killed — 6 failed |
| R3 | `incomeAtCrossoverNzd` reads `[crossoverYear - 1]` | killed — 3 failed |
| R5 | `finalYearNetIncomeNzd` reads `length - 2` | killed — 2 failed |
| R6 | `inflationRate: 0` instead of `real.inflationRate` | killed — 2 failed |
| R7 | validation drops the non-negative half | killed — 1 failed |
| **R4** | **sustained window shortened to 2 years lookahead** | **SURVIVED — 145 passed** |
| **R8** | **`Math.max(0, gross − totalTax)` clamp** | **SURVIVED — 145 passed** |

**R4 — the C5 headline definition is not fully pinned.** Replacing
`for (let t = year; t < netIncomeByYearNzd.length; t++)` (`lib/projection.ts:607`) with
`t < Math.min(year + 2, netIncomeByYearNzd.length)` passes the whole suite. The code is correct;
the suite is not. Every fixture's dip (fixture U, year 2) lands immediately after the qualifying
year, so a 2-year lookahead is indistinguishable from "every t in [y, N]". This is precisely the
"first vs sustained" distinction the spec calls the C5 headline.

- **Fix 2:** add a fixture where a qualifying year is followed by a shortfall **two or more years
  later** (e.g. a de minimis crossing pushed out by a smaller `initialShares`, or a fixture with a
  later regime switch), and assert `crossoverYear` is the later year. Then re-run R4 and confirm
  it dies.

**R8 — "never clamp" is asserted nowhere.** `spec.md:39` states "Net income may be **negative**;
never clamp it", yet wrapping line 588 in `Math.max(0, …)` passes all 145 tests. This is not
theoretical: I reproduced the notes' own UI-default scenario and the real net-income series turns
negative at year 9 and ends at **−1,568.51** — `[0, 1553, 1386, 1208, 1019, 821, 614, 399, 176,
−54, −291, −534, −784, −1039, −1301, −1569]`. A clamp would silently erase the single most
important finding in the before/after table and would flip a target-of-0 answer from "never" to
"year 1" for the app's own default inputs.

- **Fix 3:** add a test on the UI-default-shaped fixture (or any fixture where FDR tax overtakes
  the dividend) asserting `netIncomeByYearNzd` contains negative entries and
  `finalYearNetIncomeNzd < 0`, plus `crossoverYear === null` for a target of `0`. Then re-run R8.

### Tests not weakened

Every assertion in the new blocks is a real value comparison, not a shape check. `toBeNull` is used
where the spec demands it rather than a falsy check (AC9). AC11 asserts both the error class and
that the message names `targetAnnualIncomeNzd`. AC12's finiteness helper enumerates fields at
runtime rather than hardcoding a list. No pre-existing assertion was edited or removed.

### TDD evidence

`notes.md:87-119` records per-AC individual failures. ACs 2–10 and 12 RED with
`TypeError: findIncomeCrossover is not a function` — that is a genuine missing-symbol failure
inside the test, not a suite-level import error, and the coder confirms the surrounding
pre-existing tests stayed green in the same run. AC11 RED with a real assertion message. ACs 13–15
RED on the mapper. The coder **honestly discloses two non-RED cases** — AC1 (a regression pin that
invokes no new code) and AC15's toggle-off/blank + AC16 (which pass vacuously against an absent
`crossover` field reading as `undefined`) — rather than claiming blanket RED-first compliance.
That disclosure is the right call and I accept both exceptions.

### Constitution and rules

§1: invalid targets throw `ProjectionInputError` via the file's own `assertFiniteNonNegative`
(`lib/projection.ts:579`) rather than a hand-rolled check; blank ≠ `0` at the mapper; no
`NaN`/`Infinity` escapes. §2: all crossover logic is in `findIncomeCrossover` — the `.tsx` holds
only `formatCrossoverHeadline`, which does string formatting and one `length - 1`, no money
arithmetic; `projectionInputs.ts` only parses and decides whether to call. §5: NZ tax is subtracted
because it is a compulsory cash bill on a deemed return, fees are not because the engine already
nets them from the share count — the comments at lines 581-587 explain *why*, not *what*. No `any`,
no non-null assertions, no `as` silencing a missing field.

---

## Summary of required fixes

1. Amend `spec.md:87` (AC4, `i = 0`) to the engine/closed-form values — needs an owner-authorised
   spec edit, since `spec.md` is outside the coder's touch list. Note in `notes.md` that the
   in-place resolution should have been a blocker per `spec.md:171`.
2. Add a fixture whose shortfall lands ≥2 years after a qualifying year; confirm mutation R4 dies.
3. Add a negative-net-income test on a fixture that actually goes negative; confirm mutation R8
   dies.

Working tree left clean; temp worktree removed (`git worktree list` shows only the repo).
