# Review — tax-mode-compare (fix cycle 2)

## Verdict
verdict: APPROVE

All three cycle-1 findings are closed. Nothing regressed. Gates re-run
independently in a clean detached worktree at HEAD `3e4d9ef`.

## Spec Compliance

Cycle 2 changed **only** the test file (8 lines) plus `notes.md`. No production
code moved, so the AC coverage verified in cycle 1 stands unchanged.

**F3 — the wrong commit body (closed).** Commit `0227591` (`docs: correct the
tax-mode-compare commit body`) exists and states the right thing: a NZ PIE
holding US equities *does* bear US withholding at fund level, `lib/nzTax.ts` is
wrapper-agnostic on `usWithholdingPaidNzd`, and AC19 pins WHT on **both** legs.
It is an empty (record-only) commit — correct choice, since the code was always
right and only the message was wrong.

**Production code byte-identical across cycle 2.** `git diff HEAD~1 HEAD` is
empty for all three:
- `lib/projection.ts`
- `components/projectionInputs.ts`
- `components/InvestmentProjectionCalculator.tsx`

**Gates, clean worktree at HEAD** (real output):
```
pnpm lint             ✔ No ESLint warnings or errors        exit 0
pnpm exec tsc --noEmit                                      exit 0
pnpm test             Test Files 4 passed (4)
                      Tests  176 passed (176)
pnpm build            ✓ Generating static pages (7/7)       exit 0
```
Matches the orchestrator's numbers exactly (0 / 0 / 176 / 0). Temp worktree
removed; repo tree left as found.

## Code Quality

**F1 — precision restored to 6 (closed, and it earns its keep).**
`lib/__tests__/projection.test.ts:1775` (was :1773; the line moved down 2 because
the F2 comment grew) now reads `toBeCloseTo(-414.36690909091, 6)` and passes.

I checked the coder's audit claim by listing every `toBeCloseTo` added across the
whole slice (`af95899~1..HEAD`). The claim holds: **only two** sit below
precision 6, and both are pinned by the spec verbatim —
- `:1777` and `:1781` — AC7 years 3–4 at precision 2; `spec.md:97` states
  "Years 3–4 (both `"fif"`): **−184.40** then **+91.26**" (2 dp).
- `:1859`/`:1860` — AC8 real values at precision 3; `spec.md:101-102` says
  "at `toBeCloseTo(x, 3)`".

Everything else added in the slice is precision 6.

I also confirmed the tightening is not cosmetic. I ran a fine-grained mutation
(round `differenceNzd` to 5 dp in `lib/projection.ts:678`, error ≤ 5e-6):
- at precision **6** → dies: `expected -414.36691 to be close to
  -414.36690909091, received difference is 9.0909e-7, but expected 5e-7`
  at `projection.test.ts:1775`;
- at the old precision **4** → **survives** (AC7: 5 passed).

So the loosening had real kill-power cost, and restoring it bought that back.
A tightened tolerance can only shrink the passing set, so it cannot mask
anything; the full 176 still pass.

**F2 — the comment is now accurate, and does not overclaim the other way
(closed).** `lib/__tests__/projection.test.ts:1663-1666`. The assertion itself is
untouched. The new comment makes three claims and all three check out:
1. *"`differenceNzd` is defined as pie − direct"* — true, `lib/projection.ts:678`
   (and the field comment at `:647`).
2. *"unaffected by a swap the two runs mutation"* — true. Under a swap
   `difference' = direct − pie`, and the assertion `direct' − pie' ≈
   −difference'` still holds identically.
3. *"the swap mutation is actually caught by the per-year literals above"* —
   confirmed empirically. With the two `project()` calls swapped, the first
   failure inside that loop is `projection.test.ts:1659`
   (`pieClosingValueAfterTaxNzd` vs `pieExpected`), i.e. the literals, not the
   identity.

**Mutations re-run at the tighter precision** — I re-ran the 3 nearest the
changed lines against the restored tree; all three still die:
| Mutation | Site | Result |
|---|---|---|
| Swap the two `project()` legs | `lib/projection.ts:673-674` | Killed — 9 failed |
| Sign flip `differenceNzd` (direct − pie) | `lib/projection.ts:678` | Killed — 7 failed |
| Round `differenceNzd` to 5 dp (new, tests the tightening) | `lib/projection.ts:678` | Killed — 4 failed |
Baseline restored after each: 68/68 in the file, 176/176 overall.

**No test weakened.** The HEAD diff on the test file is 5 lines added / 3 removed
— 4 comment lines, one comment line pair replaced, and the single precision
`4 → 6` tightening. No assertion deleted, no literal relaxed, no `it` skipped.

### Non-blocking notes
- The identity assertion at `:1669-1672` is fully redundant in this test: a sign
  flip aborts earlier at `:1661` (`row.differenceNzd` vs `diffExpected`), so the
  identity never gets to fire. The comment is honest about it now, so it is a
  harmless belt-and-braces line, not a misleading one. Leave it.
- A stray git worktree at `/private/tmp/gc2` (detached at `3e4d9ef`) is
  registered on this repo. Not created by this review — mine was removed. Worth
  pruning when nothing is running in it.
