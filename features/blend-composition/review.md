# blend-composition — review (fix cycle 1)

## Verdict

verdict: APPROVE

All three findings from cycle 0 are closed. Nothing regressed. Four gates green in a clean
worktree at `16b5ae5`.

## Spec Compliance

Cycle 0 already verified every AC against the spec: all four fixtures re-derived by hand
(Fixture B = 0.10845 / 0.0243 / 0.001675 / 0.13275), the null policy (`blendField` returns
`null` on the first null, no `?? 0`), the required `policy` parameter with no default,
provenance across all requested members, the invalid-request rejects, and the pure-append
diff (261 insertions / 0 deletions). That verification stands — this cycle changed no
behaviour.

**F1 — false `git` claim removed, replaced with real evidence. Closed.**
The "not a git repository" passage is gone from the evidence section, not softened. The only
surviving mention is at `features/blend-composition/notes.md:235`, where the Cycle 1 section
names the old claim as false — that is a changelog entry, not a claim. The replacement
evidence at `notes.md:31-51` is accurate; I reproduced both commands independently:

```
$ git diff c2277ab d1c1a73 --numstat -- lib/funds.ts
261     0       lib/funds.ts

$ git diff c2277ab d1c1a73 -- lib/funds.ts | head -5
@@ -295,3 +295,264 @@ function computeAsOfFloor(funds: Fund[]): string {
```

261/0 and the single tail hunk at line 295 both match. `c2277ab` is the spec commit and
`d1c1a73` the feat commit, as claimed.

**F2 — invariant 7 restated in the blend block. Closed.**
`lib/funds.ts:328-333`, inside the blend design-note block, directly after the D3 paragraph
and before D4. It is accurate and it explains *why*: the blended `totalReturnAnnualised` is a
weighted mean of per-fund NAV total returns that are already net of each fund's own expense
ratio, so a caller must use `totalReturnAnnualised` / `sharePriceGrowth` as-is and must not
subtract the blended `expenseRatio` on top, "or the fee is charged twice". It cites
`calculator-invariants.md` by name, matches the pre-existing per-fund note at
`lib/funds.ts:20-22` that it points back to ("see the per-fund comment above"), and makes no
new claim beyond invariant 7. No overclaim in a new direction.

**F3 — R12 now dies. Closed.** See Code Quality.

## Code Quality

**F2 is comment-only — confirmed independently.** `git diff HEAD~1 HEAD -- lib/funds.ts` is
7 insertions, 0 deletions. All 7 inserted lines begin with `//` (6 prose lines plus one `//`
separator). No statement, no expression, no signature touched. Whole-commit numstat:

```
153     10      features/blend-composition/notes.md
4       0       lib/__tests__/funds.test.ts
7       0       lib/funds.ts
```

**Test change is additive and not weakened.** `lib/__tests__/funds.test.ts` gained 4 lines
and lost 0: three comment lines plus one assertion inside `Blend AC6` —
`expect(c.requested.map((r) => r.weight)).toEqual([0.5, 0.3, 0.2])`. Fixture C's weights are
genuinely unequal against `1/n` (0.5/0.3/0.2 vs 0.333…), so the assertion is not vacuous. No
existing test was edited, no `toBeCloseTo` precision loosened (AC6 still asserts at 10
digits), no assertion deleted.

**R12 now dies.** I re-ran my own cycle-0 surviving mutation in the clean worktree —
`lib/funds.ts:485-488`, `weight: member.weight` → `weight: 1 / members.length`:

```
× Blend AC6 — weighted, not plain, mean (Fixture C)
AssertionError: expected [ 0.3333333333333333, …(2) ] to deeply equal [ 0.5, 0.3, 0.2 ]
 Tests  1 failed | 188 passed (189)
```

Killed. That closes the last hole; the mutation score for this slice is now **27/27**.

**Three re-run mutations nearest the changed lines — all still die.** File restored from a
golden copy and re-diffed clean after each.

| Mutation | Site | Result |
|---|---|---|
| Weighted mean → plain mean (`sum += value / contributing.length`) — the exact field the new invariant-7 comment describes | `lib/funds.ts:439` | **Killed** — 2 failed / 187 passed |
| Null field coerced to 0 (`{ sum += 0; continue; }`) — Constitution §8 | `lib/funds.ts:438` | **Killed** — 1 failed / 188 passed (`expected 0.0005 to be null`) |
| `sources` built only from projectable members — adjacent to the `requested[]` line F3 touched | `lib/funds.ts:489` | **Killed** — 2 failed / 187 passed (`expected … length of 6 but got 4`) |

**Gates — clean detached worktree at `16b5ae5`, real output.**

```
$ pnpm lint
✔ No ESLint warnings or errors          (exit 0, zero warnings)

$ pnpm exec tsc --noEmit
(no output, exit 0)

$ pnpm test
 Test Files  4 passed (4)
      Tests  189 passed (189)
   Duration  384ms                       (exit 0)

$ pnpm build
 ✓ Generating static pages (7/7)
 Route (app): / · /_not-found · /etf-comparison · /retirement    (exit 0)
```

189/189, same count as cycle 0 — no test dropped or skipped. The temp worktree was removed;
`git worktree list` shows only the main checkout and `git status` shows no source changes
(only `features/blend-composition/workflow.json` and the untracked `.lean-spec/auto.json`,
both lean-spec bookkeeping).

**Non-blocking, recorded only:**

1. The RED evidence for this slice is still implementation-first-then-stub rather than
   test-first. The coder acknowledged this at `notes.md:326-331` as the pattern to change on
   the next slice. Not re-litigated — accepted as genuine in cycle 0.
2. `notes.md` now carries two mutation tables (the original 12-row and the 13-row Cycle 1
   re-run). Harmless duplication in a working note; no action.
3. The invariant-7 comment uses `--` where the surrounding block uses `--` too, so it matches
   local style. No issue.
