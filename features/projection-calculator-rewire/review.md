# Review — projection-calculator-rewire (cycle 2)

## Verdict

verdict: APPROVE

The cycle-1 blocker is gone. I re-ran all four gates myself in a **detached clean
worktree at HEAD `c5573af`** (`git worktree add`, fresh `pnpm install
--frozen-lockfile`, no dirty files) — not in the working tree. All four pass, and
`pnpm lint` prints zero warnings as well as zero errors:

```
$ git -C <worktree> status --porcelain     # (empty)
$ git -C <worktree> log --oneline -1
c5573af chore: delete RetirementAnalysis copy.tsx (unused duplicate, zero importers)

$ pnpm lint
> next lint
✔ No ESLint warnings or errors
LINT_EXIT=0

$ pnpm exec tsc --noEmit
TSC_EXIT=0

$ pnpm test
> vitest run
 Test Files  4 passed (4)
      Tests  85 passed (85)
TEST_EXIT=0

$ pnpm build
> next build
 ✓ Compiled successfully
 ✓ Generating static pages (7/7)
BUILD_EXIT=0
```

The 6 ESLint errors in `components/RetirementAnalysis.tsx` and the warnings in
`app/etf-comparison/page.tsx` that failed the clean checkout of `f6b3f90` are
resolved by `f4fc70d` and `c5573af`. Grep for `warn|error` in the build log
returns 0 lines. AC17 is met at HEAD.

Findings 1–5 below are all **non-blocking**. None is a wrong number, none reaches
the UI, and none is in shipped code paths that affect a projection result.

## Spec Compliance

Everything I verified in cycle 1 still holds and is not re-litigated here: the
before/after figures reproduce exactly ($950 / $13.30 / $1,332,681.39 old;
$3,250 / $1,162.50 / $382,720.89 direct; $912.50 / $396,056.92 PIE), no maths is
left in the component, the tax-rate field is gone, no yield is added on top of a
price-only growth, `null` growth shows unavailable rather than 0, all three error
classes surface, `formatNzd` guards every displayed number, and styling is
unchanged. All 17 ACs are met.

**Scope was respected by the slice.** `f6b3f90` touches exactly the four allowed
paths (`components/InvestmentProjectionCalculator.tsx`,
`components/projectionInputs.ts`, `components/__tests__/projectionInputs.test.ts`,
`features/projection-calculator-rewire/notes.md`). `lib/`, `data/`, `app/`,
`types.ts`, `package.json` and `vitest.config.mts` are untouched by it. The two
chore commits that touch `app/etf-comparison/page.tsx` and
`components/RetirementAnalysis.tsx` are Fady's, landed after the slice, and are
lint-only (unused-var removal, `&apos;` escape, `useCallback` memoisation). They
are outside this slice's scope and do not count against it. One observation, not
a finding: `f4fc70d` widens a `useEffect` dep array in `RetirementAnalysis.tsx`
to include `netCAGR`, `propGrowthRate`, `purchaseYear`, so that effect now re-runs
on changes it previously ignored. That is a behaviour correction in a component
this slice does not own — worth knowing before the next `/retirement` slice.

### Finding 1 (should fix, non-blocking) — `notes.md:216` misweights the cause

Carrying my cycle-1 decomposition forward so it is not lost with the old
`review.md`. For the default scenario (100k, 15y, no contributions), the year-15
move from $1,332,681.39 to $382,720.89 decomposes as:

| Change | Year-15 effect | Share of the $949,961 drop |
|---|---|---|
| Growth assumption 18% → 9.12% (price-only) | −$921,691 | **97%** |
| Tax model fix (1.4%-on-dividends → FIF/FDR) | **+$2,239** | ~0.2%, and it moves the number *up* |
| Remainder (yield-on-top removal, non-compounding expense ratio, DRIP interaction) | ≈ −$30,509 | ~3% |

The `Why` cell at `notes.md:216` reads "three errors that all inflated growth".
The dominant driver is not an error — it is a **changed assumption**: an unsourced
18% default replaced by SCHD's 9.12% 10-year price growth (Schwab, asOf
2026-06-30). Fady has since been shown this decomposition and has explicitly
settled 9.12% as the shipped default, so the number itself is not in question.
What remains is that a future reader of `notes.md` would conclude the old $1.33M
was inflated by bugs. It was mostly inflated by an optimistic input.

Why this does not block: the artifact is an internal engineering record, not
shipped output. The user-facing notice at
`components/InvestmentProjectionCalculator.tsx:96-101` is accurate — it names the
three removed fields and describes the FIF/FDR change, and makes no causal claim
about the size of the move. The growth field is seeded, labelled with `asOf` and
`source`, and editable, so a user wanting 18% can type it. Constitution "before/
after comparison" is satisfied in substance; only the weighting is missing.

**Fix in the next slice:** add one sentence to the `notes.md:216` `Why` cell —
that ~97% of the drop is the 18% → 9.12% assumption change, and the tax fix alone
moves year-15 by about +$2,239.

### Finding 2 (trivial) — spec self-contradiction on RED-first coverage

`spec.md:60` says "Each of **1–8** is a RED-first test"; `spec.md:153` says "ACs
**1–9** are still RED-first". The coder followed the wider reading and wrote
RED-first tests for AC9 too (`projectionInputs.test.ts:209+`), which is the
correct call. No action needed on the code; correct the spec if it is ever reused
as a template.

## Code Quality

Tests are real and map to the ACs. TDD evidence in `notes.md` is genuine
per-test, not a single retro-fitted run. **8/8 mutations killed** in cycle 1 — no
test was weakened to pass. No constitution violation: no per-component tax or
projection maths, no yield subtracted from a total return, provenance carried on
every seeded figure, `NaN`/`Infinity` cannot print. No new dependency; `Select`
dates to `init`.

### Finding 3 (trivial) — redundant cast

`components/InvestmentProjectionCalculator.tsx:76`:

```ts
if (value === "pie" || value === "direct") {
  setForm((prev) => ({ ...prev, wrapper: value as Wrapper }));
}
```

The guard on line 75 already narrows `value` to `"pie" | "direct"`, so
`as Wrapper` is a no-op. It is not the guardrail-banned kind of cast — it silences
nothing and hides no missing field — but it reads as if the narrowing were
insufficient. Drop `as Wrapper`; `tsc` stays clean without it.

### Finding 4 (trivial) — test name promises a spy it does not have

`components/__tests__/projectionInputs.test.ts:201`:
`"runProjection on a form with a blank/invalid growth field returns ok:false and
never calls project()"`. The body asserts only `result.ok === false` and
`errors.length > 0`. There is no spy on `project`, so the "never calls
`project()`" half of the name is unverified. The claim is true by construction —
`runProjection` returns before the engine call when `buildProjectionInput` fails —
and the other AC8 cases cover the unavailable-seed path. Either rename the test to
what it asserts, or add a `vi.spyOn` and assert `not.toHaveBeenCalled()`.

### Finding 5 (cosmetic) — off-by-one in a prose count

`notes.md:16` says "the new 9-column table" and then lists **ten** columns (Year ·
Start Balance · Contributions · Gross Dividends · US WHT · Fees · Regime · Taxable
Income · NZ Tax · End Balance). The component renders ten `<th>` elements
(`InvestmentProjectionCalculator.tsx:390-403`), matching AC11 exactly. The table
is right; the sentence is wrong. Change "9-column" to "10-column".
