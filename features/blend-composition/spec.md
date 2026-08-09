# blend-composition

## Scope

A pure weighted-blend function appended to `lib/funds.ts`, returning a blend's **price growth**,
**dividend yield**, **expense ratio** and **total return** over a caller-chosen membership. **No UI.**

**D1 — the null-member policy, the decision this slice exists for. CHOSEN: fail loudly by default,
exclude only on explicit opt-in.** `PRODUCT-NOTES §8` names `Dividend Blend` = SCHD, FDVV, VYMI,
DGRO, EUFN, VIG, and VYMI and FDVV have `sharePriceGrowth: null`
(`docs/fund-data-2026-08-07.md` § *FINAL*: no scrapable SEC yield for VYMI; 9.8 years, not 10, for
FDVV). So `policy` is a **required** argument with no default:

- `"strict"` — the honest six-fund answer: every blended figure is `null` and `excluded` names the
  two and why. `requireBlendPriceGrowth` then throws, as `requirePriceGrowth` does per fund.
- `"excludeUnprojectable"` — drops them, **renormalises the survivors to sum 1**, returns a
  non-empty `excluded`, `isComplete: false` and a `members` list of **four**. No caller can build a
  six-fund label from `members`, or reach a number without typing this word.

Alternatives, for `equalWeights(DIVIDEND_BLEND_TICKERS)`:

| Policy | growth | yield | ER | verdict |
|---|---|---|---|---|
| `"strict"` | `null` | `null` | `null` | chosen default; preset unusable until FDVV reaches 10y (~2026-09) |
| `"excludeUnprojectable"` | 0.10845 | 0.0243 | 0.001675 | chosen opt-in; 4 of 6, exclusions carried |
| null-as-`0`, **banned** (§8) | 0.0723 | 0.0205166̅ | 0.0012333̅ | wrong number, 3.615pp low; = dropping without renormalising |

**D2 — weights.** `PRODUCT-NOTES §8` records membership, **no allocation**. Inventing one breaches
Constitution §3, so the default is **equal weight**, exposed as `equalWeights(tickers)` (weight
`1/n`), not an optional argument, so it cannot be picked up by accident. Any allocation may be
supplied. Weights are fractions of **capital (NZD market value), never of units**
(`PRODUCT-NOTES §7.3`).

**D3 — how each field blends.** All four are weighted arithmetic means, `Σ wᵢ·xᵢ`, over the same
`members`.

- **Expense ratio** and **dividend yield**: exact. Both are charged or paid as a percentage of each
  holding's value, so `total ÷ portfolio value` *is* the capital-weighted mean.
- **Price growth**: a weighted arithmetic mean of CAGRs is **not** a blend's CAGR in general. It is
  exact under this project's model — each fund at one constant annual rate, weights held by **annual
  rebalancing**. Buy-and-hold needs `(Σ wᵢ(1+gᵢ)¹⁰)^(1/10) − 1` and drifts weight toward the winner:
  50/50 of 20% and 0% gives **10.00%** rebalanced, **≈13.65%** buy-and-hold. Accepted as the
  simplification `PRODUCT-NOTES §7.5` allows: rebalancing is what the engine models. Realised
  returns also vary yearly; that residual is stated, not hidden.
- Blending `totalReturnAnnualised` keeps §6 checkable: `growth = TR − yield` holds for the blend
  because all three are linear in the same weights (AC5).

**D4 — provenance (§8) and per-field nulls.** `asOf` is the **oldest** among **contributing**
members — no blend is fresher than its stalest input — and `null` (never `""`, never invented) when
nothing contributes. `sources` carries `{ticker, asOf, source}` for **every requested** member,
excluded included. Membership is decided **once**, by `isProjectable`; a contributing member with a
`null` in another field nulls **that whole blended field**, never a per-field re-exclusion, never
`0`. So every non-null figure covers one identical membership.

```ts
export type BlendPolicy = "strict" | "excludeUnprojectable";
export interface BlendWeight { ticker: string; weight: number }   // effective, Σ = 1
export interface BlendExclusion { ticker: string; requestedWeight: number; reason: string }
export interface BlendProvenance { ticker: string; asOf: string; source: string }
export interface Blend {
  policy: BlendPolicy; requested: BlendWeight[]; members: BlendWeight[];
  excluded: BlendExclusion[]; isComplete: boolean;
  sharePriceGrowth: number | null; dividendYield: number | null;
  expenseRatio: number | null; totalReturnAnnualised: number | null;
  asOf: string | null; sources: BlendProvenance[];
}
export const DIVIDEND_BLEND_TICKERS: readonly string[];
export function equalWeights(tickers: readonly string[]): BlendWeight[];
export function blendFunds(funds: Fund[], members: BlendWeight[], policy: BlendPolicy): Blend;
export function buildBlend(members: BlendWeight[], policy: BlendPolicy): Blend;
export function requireBlendPriceGrowth(blend: Blend): number;
```

`blendFunds`/`buildBlend` mirror `parseFunds`/`loadFunds`. An invalid **request** throws
`FundDataError` — `getFund("VOO")` already throws it for a bad caller ticker, so no new error class.
`MissingAssumptionError` comes only from `requireBlendPriceGrowth`. All three arrays preserve
requested order.

**Fixtures.** **A** = `equalWeights(DIVIDEND_BLEND_TICKERS)` + `"strict"`. **B** = same +
`"excludeUnprojectable"`. **C** = `[SCHD 0.5, DGRO 0.3, VIG 0.2]` + `"strict"`. **D** =
`[SCHD 0.4, VYMI 0.3, DGRO 0.2, VIG 0.1]` + `"excludeUnprojectable"`. **E** =
`blendFunds(parseFunds([P, Q]), equalWeights(["P1","Q1"]), "strict")`; P = `row()` with
`ticker "P1"`, `asOf "2026-05-31"` (TR `0.1`, yield `0.02`, ER `0.001`); Q = same but `"Q1"`,
`"2026-04-30"`, TR `0.2`, yield `0.04`, `expenseRatio: null`, `notes` non-empty.

## Acceptance Criteria

One RED test per AC, run alone, appended to `lib/__tests__/funds.test.ts` in a new `describe`.
`toBeCloseTo(x, 10)` for rates, `toBeNull()` — not falsy — for nulls.

1. **Pure append.** `git diff lib/funds.ts` shows appended lines only — zero edited lines in the ten
   existing exports. ACs 1–16 pass unmodified. `DIVIDEND_BLEND_TICKERS` equals
   `["SCHD","FDVV","VYMI","DGRO","EUFN","VIG"]`, that order.
2. **Strict is `null`, not zero (A).** The four figures and `asOf` are each `null`; assert
   `Object.is(x, 0) === false` on the figures. `members` `[]`, `isComplete false`, `sources` length
   **6**, `requested` length 6 with every `weight === 1 / 6`. `excluded` is `[FDVV, VYMI]`, that
   order, each `requestedWeight === 1 / 6` and `reason === getFund(t).notes`, non-empty.
3. **Strict blocks a projection.** `requireBlendPriceGrowth(A)` throws `MissingAssumptionError`, not
   `FundDataError`, naming both `FDVV` and `VYMI`. It never returns `0`.
4. **Exclude renormalises (B).** `members` `[SCHD, DGRO, EUFN, VIG]`, each `weight === 0.25`;
   `excluded` `[FDVV, VYMI]`; `isComplete false`; `sources` length **6** (dropped funds keep
   provenance); `asOf === "2026-06-30"`. `sharePriceGrowth` **0.10845**, `dividendYield` **0.0243**,
   `expenseRatio` **0.001675**, `totalReturnAnnualised` **0.13275**. Assert
   `sharePriceGrowth !== 0.0723` — the null-as-`0` *and* no-renormalisation answer.
   `requireBlendPriceGrowth(B) === 0.10845`.
5. **§6 identity.** For B, C, D and E: `sharePriceGrowth === totalReturnAnnualised − dividendYield`
   to 10 places.
6. **Weighted, not plain, mean (C).** `sharePriceGrowth` **0.1029**, `dividendYield` **0.02507**,
   `expenseRatio` **0.00062**, `totalReturnAnnualised` **0.12797**; `isComplete true`, `excluded`
   `[]`, weights unchanged `[0.5, 0.3, 0.2]`. Assert each figure differs from its unweighted mean —
   **0.1069**, **0.0222333̅**, **0.0006** — so a plain mean fails three ways.
7. **Non-uniform renormalisation (D).** `members` weights `4/7`, `2/7`, `1/7`
   (`0.5714285714285714`, `0.2857142857142857`, `0.14285714285714285`), Σ within `1e-12` of 1.
   `sharePriceGrowth` **0.1011857142857143**, `dividendYield` **0.026285714285714286**,
   `expenseRatio` **0.0006285714285714286**, `totalReturnAnnualised` **0.1274714285714286**.
   `excluded` `[VYMI]` with `requestedWeight === 0.3`. Assert growth is neither **0.07083** (no
   renormalisation, equally VYMI counted as `0`) nor **0.1069** (renormalised by member count).
8. **A `null` field nulls the field, not the member (E).** `expenseRatio` is `null` — not `0.001`
   (per-field re-exclusion), not `0.0005` (null-as-`0`). `sharePriceGrowth` **0.12**,
   `dividendYield` **0.03**, `totalReturnAnnualised` **0.15**, `members` length **2**, `excluded`
   `[]`, `isComplete true`.
9. **Oldest contributing `asOf`.** `buildBlend(equalWeights(["VIG","SCHD"]), "strict").asOf ===
   "2026-06-30"` — not `"2026-07-31"`, so neither newest nor first-listed.
   `buildBlend(equalWeights(["VIG"]), "strict").asOf === "2026-07-31"`, proving it is computed, not
   pinned to `FUND_DATA_AS_OF`. E's `asOf === "2026-04-30"`. Every `sources` entry equals its
   `getFund(ticker)` `asOf` and `source`.
10. **Weight-sum tolerance.** `buildBlend(equalWeights(DIVIDEND_BLEND_TICKERS), "strict")` must not
    throw — six copies of `1/6` need a tolerance; `=== 1` rejects them.
    `[{SCHD, 0.5}, {DGRO, 0.5000001}]` and a Σ of `0.9` throw `FundDataError`;
    `[{SCHD, 0.5}, {DGRO, 0.5 + 1e-12}]` is accepted (`|Σ − 1| ≤ 1e-9`).
11. **Every invalid request throws `FundDataError`.** Empty `members`; `equalWeights([])`; unknown
    ticker `VOO`; duplicate `SCHD`; `weight` of `NaN`, `Infinity`, `-Infinity`, `-0.1`, `0`, or a
    string. Each message names the ticker or field (invariant 14).
    `buildBlend(equalWeights(["SCHD"]), "loose" as BlendPolicy)` throws too — `policy` is validated
    at runtime, not only in the type.
12. **Types force the decision.** Both compile-fail under `// @ts-expect-error`, so
    `pnpm exec tsc --noEmit` fails if either is relaxed: `const g: number =
    buildBlend(equalWeights(["SCHD"]), "strict").sharePriceGrowth;`, and a `buildBlend` call with
    `policy` **omitted**. Reference the bindings so lint stays clean.
13. **Pure and finite.** `blendFunds` mutates neither argument — the `members` array and the
    `Fund[]` `toEqual` clones taken before the call. For B, C, D and E every non-null figure is
    `Number.isFinite` and `Σ members.weight` is within `1e-12` of 1 (invariant 13).
14. **Before/after table in `notes.md`** — *Figure · SCHD alone · Blend (4 of 6, equal) · Δ*: growth
    9.12% → **10.845%** (**+1.725pp**); yield 3.25% → **2.43%** (**−0.82pp**); ER 0.06% →
    **0.1675%** (**+0.1075pp**, ≈2.8×, EUFN alone 0.001225 of it — 73%); total return 12.37% →
    **13.275%** (**+0.905pp**). One line on the trade: the blend grows faster but pays **less
    income**, pushing the crossover year **later** while the ending balance rises. Restate the D1
    table verbatim.
15. `pnpm lint` (zero warnings) · `pnpm build` · `pnpm test` · `pnpm exec tsc --noEmit` — all four
    green on a **clean checkout of the commit**.

## Out of Scope

- **All UI** — the preset dropdown (`SCHD` / `Dividend Blend` / `Custom`), the SCHD-vs-blend compare
  view, the `asOf` footer note, any editable weight field. **Next slice.**
- Wiring a blend into `lib/projection.ts` or a component; blended `dividendGrowth` (`null` on all
  six); prices, FX, tax, fees, rebalancing cost, correlation, volatility.
- A buy-and-hold formula (D3), per-field membership (D4), a growth override for an unprojectable
  fund, sourcing VYMI's yield or FDVV's 10-year return.
- Editing `data/*` (including a `weight` field in `funds.json`), `lib/nzTax.ts`, `types.ts`, any
  component, `vitest.config.mts`, `package.json`. **No new dependency.**

## Coder Guardrails

- **Touch only** `lib/funds.ts`, `lib/__tests__/funds.test.ts` and this slice's `notes.md`.
- **Pure append (AC1).** Put the `git diff` of `lib/funds.ts` in `notes.md`. Modify no existing
  assertion or export. A failing pre-existing test is a regression — **stop and raise a blocker**.
- **A number you cannot reproduce is a blocker, not a fix.** If an expected value here disagrees with
  your own arithmetic, **stop and raise a blocker**; leave the test asserting **this spec's** number
  and failing, so the disagreement shows in the suite. Never reconcile in place, even when you are
  right. Twice now.
- **TDD, RED-first, mandatory.** Write each AC's test, run it **alone** (`pnpm test -t "<name>"`),
  record the assertion message, then implement. A suite-level import or type error is **not** RED.
- **Mutation check in `notes.md`** — mutate your own code, report what died. At least: plain mean for
  weighted; skip renormalisation; renormalise by member count; a `null` field as `0`; per-field
  instead of whole-member exclusion; newest or first-listed `asOf`; drop excluded members from
  `sources`; default the `policy`; return `0` for `null`; exact `=== 1` weight sum; allow a negative
  weight. **Default reporter only — `vitest --reporter=basic` exits non-zero on Vitest 4 whatever
  the result, so it proves nothing.** Restore the file between runs.
- **§1 / invariant 14:** invalid requests throw naming the ticker or field; nothing is coerced to
  `0`; `NaN`/`Infinity` never returned. **§8:** unavailable is `null`, never `0` or `""`. **§2:** all
  blend arithmetic in `blendFunds`; `buildBlend` only supplies `loadFunds()`.
- Decimals 0–1, no percent conversion. The module stays pure: no React/Next, no I/O beyond the
  existing import, no `Date.now()`, no mutable module state. Strict TS — no `any`, no non-null
  assertion, no silencing `as`.
- Comments explain **why** only (§9): record D1 with the alternatives' figures, D2, D3 and D4, citing
  `PRODUCT-NOTES §8` and `docs/fund-data-2026-08-07.md` § *FINAL*. Note invariant 7 — the blended
  total return is already net of fees, so a projection must not charge `expenseRatio` again.
