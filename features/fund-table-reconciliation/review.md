# Review — fund-table-reconciliation

Commit reviewed: `8dc213a` on `feat/nz-tax-engine`.

## Verdict

verdict: APPROVE

All 16 ACs are met. Every number in `data/funds.json` was checked digit by digit against
`docs/fund-data-2026-08-07.md` § *FINAL — all six, primary source, 2026-08-07*, and every
subtraction was re-done by hand. No mismatch. The three gates were run by me and are green.
The findings below are advisory only; none of them block `close`.

### Gates (run by the reviewer, real output)

```
$ pnpm test
 Test Files  2 passed (2)
      Tests  37 passed (37)
   Duration  364ms

$ pnpm lint
✔ No ESLint warnings or errors

$ pnpm build
 ✓ Compiled successfully
   Linting and checking validity of types ...
 ✓ Generating static pages (6/6)
Route (app)              Size     First Load JS
┌ ○ /                    11 kB           123 kB
├ ○ /_not-found          977 B           106 kB
└ ○ /etf-comparison      68.6 kB         181 kB

$ npx tsc --noEmit          # exit 0
$ npx tsc --noEmit --listFiles | grep -c funds.test.ts   # 1
```

The last two matter for AC5: `lib/__tests__/funds.test.ts` **is** inside the `tsconfig` program
(`tsconfig.json:29` — `include: ["**/*.ts", ...]`), and `tsc` exits 0, which means the
`@ts-expect-error` at `lib/__tests__/funds.test.ts:152` is *consuming a real error*. Widen
`sharePriceGrowth` to `number` and it becomes TS2578 and the build fails. The guard is live, not
decorative.

## Spec Compliance

### The data — every cell verified against the FINAL section

Source rows: `docs/fund-data-2026-08-07.md:211-216` (inputs), `:229-234` (derived), `:218-223`
(source URLs).

| Ticker | FINAL total / stored | FINAL yield / stored | FINAL ER / stored | asOf | window | source URL | domicile |
|---|---|---|---|---|---|---|---|
| SCHD | 12.37 → `0.1237` (`data/funds.json:10`) | 3.25 → `0.0325` (`:12`) | 0.06 → `0.0006` (`:9`) | 2026-06-30 ✓ (`:7`) | 10 ✓ | schwabassetmanagement.com/products/schd ✓ (`:8`) | US ✓ |
| DGRO | 13.38 → `0.1338` (`:24`) | 1.98 → `0.0198` (`:26`) | 0.08 → `0.0008` (`:23`) | 2026-06-30 ✓ (`:21`) | 10 ✓ | ishares.com/us/products/264623/… ✓ (`:22`) | US ✓ |
| VIG | 12.99 → `0.1299` (`:38`) | 1.44 → `0.0144` (`:40`) | 0.04 → `0.0004` (`:37`) | 2026-07-31 ✓ (`:35`) | 10 ✓ | investor.vanguard.com/…/vig ✓ (`:36`) | US ✓ |
| EUFN | 14.36 → `0.1436` (`:52`) | 3.05 → `0.0305` (`:54`) | 0.49 → `0.0049` (`:51`) | 2026-06-30 ✓ (`:49`) | 10 ✓ | ishares.com/us/products/239645/… ✓ (`:50`) | US ✓ |
| VYMI | 10.98 → `0.1098` (`:66`) | `null` → `null` ✓ (`:68`) | 0.07 → `0.0007` (`:65`) | 2026-07-31 ✓ (`:63`) | 10 ✓ | investor.vanguard.com/…/vymi ✓ (`:64`) | US ✓ |
| FDVV | `null` → `null` ✓ (`:80`) | 2.59 → `0.0259` (`:82`) | `—` → `null` ✓ (`:79`) | 2026-06-30 ✓ (`:77`) | `null` ✓ (`:81`) | institutional.fidelity.com/…/fidelity-etfs ✓ (`:78`) | US ✓ |

EUFN's URL is product **239645** (MSCI Europe Financials), not the TUR redirect flagged at
`docs/fund-data-2026-08-07.md:196`. The superseded tables above line 205 were **not** used: no
figure in `funds.json` matches an earlier-pass value where the FINAL value differs.

Subtractions re-done by hand, decimals matching the FINAL derived table (`:229-234`):

- SCHD `0.1237 − 0.0325 = 0.0912` → 9.12 ✓
- DGRO `0.1338 − 0.0198 = 0.1140` → 11.40 ✓
- VIG `0.1299 − 0.0144 = 0.1155` → 11.55 ✓
- EUFN `0.1436 − 0.0305 = 0.1131` → 11.31 ✓
- VYMI yield `null` → growth `null` ✓ · FDVV total `null` → growth `null` ✓

Inception dates are not a field in the spec's row shape, so none is stored. FDVV's `notes`
(`data/funds.json:84`) does carry `2016-09-12`, matching FINAL, and gives the "~2026-09" eligibility
date. No invented figure anywhere: FDVV's expense ratio is `—` in FINAL and is `null` in the data,
not back-filled from a superseded table or from `etfs.json`.

### The null contract — it holds

- `null` is never `0` and never defaulted. `parseFunds` has no `?? 0`, no `|| 0`, no `Number(x)`,
  no default parameter, no `!`, no `as number`, no `any` — grep over `lib/funds.ts` returns
  nothing for all of those.
- VYMI and FDVV load, validate and stay selectable: neither is filtered nor throws
  (`lib/funds.ts:254-263` maps every row, drops none), and `isProjectable` (`:278-280`) returns
  `false` without throwing.
- `requirePriceGrowth` (`lib/funds.ts:282-289`) throws `MissingAssumptionError` naming both the
  ticker and `sharePriceGrowth`. `MissingAssumptionError` (`:57-62`) does **not** extend
  `FundDataError` — the file is valid, the use is not, exactly as AC7 requires.
- The type forces the caller to handle `null`: `Fund.sharePriceGrowth: number | null`
  (`lib/funds.ts:47`), enforced at build time by the `@ts-expect-error` described above.
- **Derived in exactly one place:** `lib/funds.ts:256-261`, inside `parseFunds`, with a `why`
  comment citing Constitution §6 / invariant 5. It is not stored in JSON (verified by reading the
  raw file at `lib/__tests__/funds.test.ts:316-322`), and the returned object is rebuilt from
  explicit fields (`lib/funds.ts:232-245`), so a stray stored `sharePriceGrowth` key could not leak
  through even if someone added one.

### AC-by-AC

AC1–AC16 all satisfied. Spot notes on the ones that are easy to fake and were checked closely:

- **AC8** — the "explain your nulls" rule is enforced on `expenseRatio`, `totalReturnAnnualised`
  and `dividendYield`, with `dividendGrowth` exempt (`lib/funds.ts:225-230`), matching the AC's
  carve-out. Both real notes strings are substantive and cite the check date.
- **AC9** — `requirePresent` (`:72-79`) distinguishes *absent key* / `undefined` from an explicit
  `null`. This is the subtle one and it is done right.
- **AC10** — window pinned to 10 when a return exists, plus the both-or-neither pairing check
  (`:212-221`). A life-of-fund figure cannot be swapped in.
- **AC11** — `FUND_DATA_AS_OF` is computed from the parsed rows (`:291-297`), not typed in, and
  resolves to `2026-06-30`.
- **AC16** — `data/dividend_portfolio.json` is gone. I grepped the whole tree independently: the
  only remaining hits are in `docs/` (`PRD.md`, `PRODUCT-NOTES.md`, `AUDIT-2026-08-06.md`,
  `fund-data-2026-08-07.md`), `features/`, and the absence-assertions in the test file
  (`lib/__tests__/funds.test.ts:397,404,407,412`). **Zero real importers.** `data/etfs.json` is
  byte-identical (absent from the commit, clean in `git status`) and its only importer is still
  `app/etf-comparison/page.tsx:5`, which builds.

### One environment note, not a coder fault

`git diff app/etf-comparison/page.tsx` is **not** clean in this working tree — there is an
uncommitted `useCallback` change. It is **pre-existing dirt, not from this slice**: the file's
mtime is `17 Aug 2025`, the commit is `2026-08-07`, and the file is absent from `8dc213a`. Same for
`components/RetirementAnalysis*.tsx`. AC16's literal `git diff --exit-code` wording cannot pass in
this working tree for reasons that predate the feature. Worth clearing separately, since it means
the lint/build gates are currently being run against a tree that differs from `HEAD`.

## Code Quality

### Tests are real and map to the ACs

One `it` per AC, named for it, and the assertions test the spec's numbers rather than the code's
output. Nothing looks reverse-engineered from an implementation: AC2 pins each issuer figure to 6
decimal places, and AC3 asserts both the constant **and** the identity
`sharePriceGrowth === total − yield` (`lib/__tests__/funds.test.ts:116-122`), so a hardcoded
constant and a broken derivation cannot both pass. AC4 uses `Object.is(x, 0) === false` plus
`x !== 0` plus `x === null` (`:132-142`), which is what makes a future `?? 0` fail loudly.

### The AC16 self-correction was legitimate, not a weakened assertion

The coder narrowed AC16 from "no occurrence of the string `etfs.json`" to "no actual
import/require path" (`lib/__tests__/funds.test.ts:399-408`). I judge this **legitimate**:

- The spec is self-contradictory as literally written. Coder Guardrail (d) *requires* a comment in
  `lib/funds.ts` naming `data/etfs.json` as frozen legacy (`spec.md:191`), so a bare string match
  can never pass. The narrowed reading is the only one that satisfies both clauses.
- It matches the spec's own stated intent elsewhere: "`lib/funds.ts` must never **import** it"
  (`spec.md:26`).
- No expected value moved. The strict string match is *still* applied to `data/funds.json`
  (`:410-412`), where it belongs, because JSON has no comments.

Two caveats on the record-keeping rather than the code:

1. The narrowed regexes only match static `from "…"` and `require("…")`. A dynamic
   `import("@/data/etfs.json")` would slip past. Low risk (the module is 300 lines and reviewed),
   but the test is weaker than its name suggests.
2. `notes.md:184` says the correction happened "before the code was ever run against it". The
   timestamps say otherwise: `lib/funds.ts` was created 19:21:11 and the test file's birth/mtime is
   19:21:41, and the failure being described can only appear *after* the guardrail comment exists in
   `funds.ts`. TDD order itself is intact — the RED run at 19:20:15 predates both `data/funds.json`
   (19:20:34) and `lib/funds.ts` (19:21:11) — but that one sentence in the notes is inaccurate.

### RED evidence is a real captured run, but weaker than "one RED per AC"

The RED block (`notes.md:109-137`) is genuine console output, and its timestamp is consistent with
the filesystem. However it is a **suite-level import failure** — `(0 test)`, `Cannot find package
'@/lib/funds'` — so not one of the 16 assertions was ever observed failing on its own merits. In
particular, no test was ever seen to go red because a *number was wrong*. For a brand-new module
this is the normal shape of RED and I am not treating it as a violation, but for the next slice
(where `lib/funds.ts` already exists) the RED must be per-AC assertion failures, not an import
error.

### Constitution and invariants

- §1 / invariant 14 — every validation path throws naming ticker and field
  (`lib/funds.ts:74-78, 84, 101, 105, 109, 112, 133, 137, 174, 182, 187, 192, 197, 214, 219, 228`).
  Nothing is coerced, no row is silently dropped.
- §3 / §8 — provenance per row, `null` where unverifiable, module header records the *why* for
  every null (`lib/funds.ts:1-25`).
- §6 / invariant 5 — one derivation site, cited.
- §9 — comments say *why* throughout; the header even carries invariant 7 (NAV returns are already
  net of fees, so a projection must not charge `expenseRatio` again) which is the exact trap the
  next slice will walk into. Good call.
- Percent-vs-decimal — stated once (`lib/funds.ts:89-91`) and enforced by the `>= 1` ceiling on
  every rate. It matches `lib/nzTax.ts:19-20,80`, and there is **no** conversion in
  `lib/funds.ts`; nothing crosses conventions. No dependency added; validator is hand-written.

### Minor findings (non-blocking, for a later slice)

1. `lib/funds.ts:292` — `computeAsOfFloor` reads `funds[0].asOf`. `parseFunds([])` succeeds and
   returns `[]`, so an emptied `data/funds.json` would crash at module load with a raw `TypeError`
   instead of a `FundDataError`. It still fails loudly, so §1 is satisfied, but the error would not
   name the problem. A "must be non-empty" check in `parseFunds` would close it.
2. `lib/funds.ts:271` — `getFund` calls `loadFunds()`, which re-parses the whole file on every
   call; `FUND_DATA_AS_OF` (`:297`) triggers a third parse at import. Pure and correct, just
   wasteful. Fine at six rows.
3. `lib/funds.ts:206` — `dividendGrowth` has no lower bound, so `-5` would validate. The spec only
   asks for `< 1` here, so this is compliant; it is `null` on all six rows today.
4. `lib/__tests__/funds.test.ts:118-119, 209, 211` — `as number` / `as string` casts. They sit
   immediately after explicit `not.toBeNull()` assertions and are test-only, so the production path
   stays clean, but they are the same silencing move the guardrails ban. `expect(f).toEqual(...)`
   or a local narrowing `if` would avoid the pattern entirely.
5. The validator permits `0` for `expenseRatio` and `dividendYield` (`min: 0`, `lib/funds.ts:200,
   203`). That is what AC15 asks for, and AC4's data-level test (`:144-148`) is what actually keeps
   a `0` out of the file. Worth remembering that the *type* does not stop a future `0` — only the
   test does.
