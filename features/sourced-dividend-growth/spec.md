# sourced-dividend-growth — constant-yield dividend-growth default

## Scope

Replace the shipped `dividendGrowthPercent: "0"` default with **constant yield**: dividend growth
defaults to whatever share price growth is, labelled in the UI as a stated modelling convention,
not a measurement.

The slug predates the decision. `docs/PRD.md` → Constraints → *"Dividend growth defaults to
constant yield (decided 2026-08-09, superseding 2026-08-08)"* is binding. A per-fund sourced CAGR
was tried and dropped: two primary-quality sources over the identical 8-year window disagree by
4.5pp (Schwab's own split-adjusted distribution table 11.18%, stockanalysis.com 6.70%) — roughly a
3× difference in 30-year dividend income. **Do not re-open this.** Neither figure ships.

Three changes, all in the mapper plus one component:

1. `seedAssumptionsFromFund` also returns `dividendGrowthPercent`, equal to `sharePriceGrowthPercent`.
2. A `dividendGrowthLinked` flag on `ProjectionFormState` and one pure `applyFieldChange` reducer:
   while linked, editing share price growth carries dividend growth with it; the first edit of the
   dividend-growth field breaks the link for good.
3. Helper text for both states, plus a **final-year effective yield** readout, so any divergence
   between the two rates is visible instead of silent (the audit's core lesson).

The engine is correct and is not touched.

## Acceptance Criteria

1. **The seed carries constant yield.** `seedAssumptionsFromFund(getFund("SCHD"))` returns
   `ok: true` with a numeric `dividendGrowthPercent` that is strictly `===` its own
   `sharePriceGrowthPercent`, and `dividendGrowthPercent.toFixed(2) === "9.12"` (SCHD:
   0.1237 − 0.0325 = 0.0912). Assert through `toFixed(2)` and field-to-field equality, never
   `=== 9.12` (float). Also assert it is not `0`.
2. **Unsourceable stays blank, never 0.** `seedAssumptionsFromFund(getFund("VYMI"))` (its
   `dividendYield` is `null`) returns `ok: false` with `dividendGrowthPercent: ""` beside the
   existing `sharePriceGrowthPercent: ""` — `UnavailableAssumption` gains that field.
   `Object.is(result.dividendGrowthPercent, 0)` is `false`.
3. **The seed ignores `fund.dividendGrowth`.** Given a `Fund` literal (type exported from
   `lib/funds.ts`; do **not** add a row to `data/funds.json`) with `sharePriceGrowth: 0.07`,
   `dividendYield: 0.02` and `dividendGrowth: 0.05`, the seed returns
   `dividendGrowthPercent.toFixed(2) === "7.00"`. The convention derives from price growth, never
   from the fund datum.
4. **A linked edit carries.** `applyFieldChange(form, "sharePriceGrowthPercent", "5")` on a form
   with `sharePriceGrowthPercent "9.12"`, `dividendGrowthPercent "9.12"`, `dividendGrowthLinked
   true` returns `sharePriceGrowthPercent "5"`, `dividendGrowthPercent "5"`, `dividendGrowthLinked`
   still `true`. It returns a new object and does not mutate the input form.
5. **The first dividend-growth edit breaks the link permanently, and a typed `0` survives.** From
   that same linked form:
   (a) `applyFieldChange(form, "dividendGrowthPercent", "0")` → `dividendGrowthPercent "0"`,
   `dividendGrowthLinked false`;
   (b) feeding that result into `applyFieldChange(_, "sharePriceGrowthPercent", "5")` leaves
   `dividendGrowthPercent === "0"` — not `"5"`, not `"9.12"`, not `""`;
   (c) `buildProjectionInput` of (b)'s form gives `dividendGrowth: 0` and `sharePriceGrowth: 0.05`
   — a user-entered zero reaches the engine as zero.
6. **Unrelated edits touch nothing else.** On a linked form,
   `applyFieldChange(form, "initialCapital", "250000")` changes only `initialCapital`;
   `dividendGrowthPercent`, `sharePriceGrowthPercent` and `dividendGrowthLinked` are unchanged.
7. **The label names the convention, per state.** `dividendGrowthHelperText(form)` returns exactly:
   - linked — `Tracks share price growth — constant yield. A stated modelling convention, not a sourced figure. Edit it to set your own.`
   - unlinked — `Your own figure — no longer tracking share price growth, so the constant-yield convention no longer holds.`

   Neither string claims a source. The component renders this function's output; the current
   sentence beginning *"No fund publishes a multi-year per-share dividend CAGR"* is deleted.
8. **Blank still errors; the flag never reaches the engine.**
   `buildProjectionInput(makeForm({ dividendGrowthPercent: "" }))` returns `ok: false` with
   `errors.dividendGrowthPercent` naming `Dividend growth (%)` (invariant 14 — empty is not 0), and
   for a valid form `"dividendGrowthLinked" in value === false`.
9. **Final-year effective yield is on screen.** New `formatFinalEffectiveYield` in
   `projectionInputs.ts` reads the last row's `dividendPerShareNzd / closingSharePriceNzd` and does
   no other arithmetic. Trigger scenario — 100000 initial · 30y · 1000/mo · 9.12% growth · 3.25%
   yield · direct · 33% marginal · 15% WHT · stop 15 · draw 16 · 3% inflation · real terms on ·
   target 60000:
   (a) with `dividendGrowthPercent "9.12"` → `"3.25%"`, and the raw ratio equals `0.0325` within
   1e-12 (equal rates mean the yield is constant by construction);
   (b) with `dividendGrowthPercent "0"` → `"0.24%"` (0.0325 ÷ 1.0912³⁰ = 0.0325 ÷ 13.713 = 0.2370%);
   (c) the string is identical for `run.value` and `run.real` — both deflators cancel in the ratio;
   (d) an empty `rows`, or a final row whose closing price is `0` or non-finite, returns `"—"`,
   never `NaN%` (invariant 13).
   The component shows it beside the dividend figures, labelled `Final-year effective yield`.
10. **Before/after on the audit's trigger scenario.** Same inputs as AC9, through `runProjection`,
    asserted from the engine's own output rather than copied constants (±$1 tolerance):

    | figure (real) | `dividendGrowthPercent "0"` | `"9.12"` |
    |---|---|---|
    | `real.rows[30].grossDividendsNzd` | 2204 | 39241 |
    | `real.totalDividendsDrawnNzd` | 38989 | 366579 |
    | `crossover.finalYearNetIncomeNzd` | −11859 | +20984 |

    `crossover.crossoverYear` stays `null` in both — fixing the default makes the numbers coherent,
    it does not reach the $60k target. Record both columns and AC9's two yields in `notes.md`.

## Out of Scope

- **Any per-fund sourced dividend CAGR**, in data or in code. Superseded; do not compute one.
- **`data/funds.json`** — `dividendGrowth` stays `null` on all six rows. The **fund datum** is a
  measurement nobody has verified (Constitution §8; PRD "unverifiable fields are `null`, never
  `0`"); the **default** is a convention derived at seed time from the user's own price-growth
  input. A convention must never be written into the data file as if it were measured.
  `lib/funds.ts` keeps treating the field as nullable and notes-exempt.
- `lib/projection.ts`, `lib/nzTax.ts`, `lib/funds.ts`. `divPerShare_t = divPerShare_0 × (1+g)^t` is
  correct.
- Warnings, blocks or refusals when dividend growth diverges from price growth. AC9's visible yield
  is the entire mechanism this slice ships.
- Re-linking after an unlink (no reset control), preset switching, restyling, chart changes, and the
  other open audit findings (compare-card units, income-convention labels, cost defaults).
- Rendering tests, jsdom, testing-library.

## Coder Guardrails

- **Files you may change:** `components/projectionInputs.ts`,
  `components/__tests__/projectionInputs.test.ts`, `components/InvestmentProjectionCalculator.tsx`.
  Nothing else. AC9 needs no `lib/` addition — `dividendPerShareNzd` and `closingSharePriceNzd` are
  already fields on `ProjectionRow`. Type `formatFinalEffectiveYield`'s parameter structurally with
  `Pick<...>`, the way `formatRegimeCell` already does, so it accepts a nominal or a real result.
- **RED first, mandatory, one AC at a time** — observe each new test fail on its own before
  implementing. Rendering is exempt (Vitest runs `environment: "node"`).
- Run `pnpm test` / `pnpm exec vitest run`. **Do not use `--reporter=basic`** — on Vitest 4 it exits
  non-zero whatever the result.
- **Mutation resistance.** The reviewer mutation-tests every slice and has found vacuous tests six
  times. Fixtures must discriminate: the default silently reverting to `0`; the default not tracking
  `sharePriceGrowth` (use `"5"`, never a value that happens to equal 9.12); a user entry overwritten
  by a later price-growth edit; a user-entered `"0"` treated as empty. Any test that still passes
  when `dividendGrowthPercent` is hardcoded to `"0"` is vacuous.
- `makeForm` gains `dividendGrowthLinked: true`, mirroring the already-disclosed `showRealTerms` /
  `targetAnnualIncome` additions. Its existing `dividendGrowthPercent: "0"` stays, so no pre-existing
  AC changes behaviour — state that in `notes.md`.
- **All linking logic lives in `applyFieldChange` in `projectionInputs.ts`**; `handleFieldChange` in
  the `.tsx` becomes a one-line delegate. Per-component logic is banned (Constitution §2).
  `handleTaxModeChange` is untouched. Type the field parameter as
  `Exclude<keyof ProjectionFormState, "taxMode" | "showRealTerms">`; no `as`, no `!` anywhere.
- While linked, the share-price string is copied **verbatim**, including an invalid one — one typo
  then raises an error on both fields. That is intended: while linked the two fields are one claim.
- No new dependency. No restyling (visual design is a later `/impeccable` pass). No `NaN`/`Infinity`
  on screen. Comments explain *why*, not *what* (Constitution §9).
- **A spec value you cannot reproduce is a blocker.** Leave the test asserting this spec's number and
  failing, write it up in `notes.md`, and stop. Never reconcile a figure in place, even when you are
  sure the spec is wrong.
- Quality bars, on a clean checkout of the commit: `pnpm lint` (zero warnings), `pnpm build`,
  `pnpm test`, `pnpm exec tsc --noEmit`.
