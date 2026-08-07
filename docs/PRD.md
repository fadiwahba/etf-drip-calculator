# PRD — ETF Investment Calculator (NZ)

## Problem & Users

A New Zealand investor cannot easily answer the question that actually matters: **"when can I live
off my dividends, and how much will that income really be worth?"**

Generic calculators get NZ badly wrong. NZ does not tax most foreign ETF dividends at all — it taxes
a **deemed** return under the FIF regime — and the effective rate swings between **1.40%** and
**1.95%** of portfolio value depending on whether the fund is a NZ PIE or a directly-held US ETF.
Nothing off the shelf models that, and getting it wrong misstates a 30-year outcome badly.

**Primary user (confirmed 2026-08-06):** Fady — NZ tax resident, invests via **Sharesies**, marginal
rate **33%**, PIR **28%**, foreign-holdings cost currently **under NZ$50,000 but projected to cross
during the projection window**. That crossing case is the demanding one and is the default the model
must handle correctly.

**Two scenarios, one model:**

- **Accumulator** — contributing regularly, wants to see balance and dividends grow, and to know when
  dividends could replace income.
- **Decumulator** — existing capital, no contributions, wants to know the passive income it throws
  off now and in N years.

These are not two calculators. They are one model with a contribution-stop parameter; setting it to
zero yields the decumulator. Building them separately is how the codebase ended up with four
inconsistent tax models.

## Features

1. **A single shared tax engine (`lib/nzTax.ts`)** — FIF with the NZ$50,000 de minimis (parameterised;
   NZ$100,000 proposed from 2026–27, unconfirmed), FDR at 5% of opening value, Comparative Value as
   the alternative with **lower-of** selection per year, PIR (capped 28%) for PIE vs marginal rate for
   direct holdings, US withholding credited against the FIF liability and capped at it, ordinary
   dividend taxation below the threshold, and **mid-projection threshold crossing**.
2. **Tax-mode segmented control** — `NZ PIE funds` / `US ETFs (direct)` / **`Compare both`**, with the
   compare view plotting both and naming the crossover year where the cheaper wrapper changes.
   Mode-specific inputs appear conditionally (PIR; or marginal rate + W-8BEN toggle + FX spread).
   A live one-line explainer states which regime produced the number.
3. **Three-phase projection** — Accumulate (contribute + reinvest) → Coast (no contributions, still
   reinvesting) → Draw (dividends taken as income). Driven by `contributionsStopYear` and
   `drawdownStartYear`, the latter defaulting to the former.
4. **Crossover reporting** — a target annual income input, and the first year net dividends exceed it
   **in real terms**.
5. **Inflation modelling** — rate input defaulting to **3%**, toggle **default ON**, real (today's
   dollars) as the default view with nominal opt-in, and a per-year **"Purchasing power lost"** column
   kept visually distinct from fees and tax (inflation is not a cash outflow).
6. **Portfolio presets** — `SCHD` / `Dividend Blend` / `Custom`. Presets populate fields without
   locking them; editing any field flips the label to "Custom (modified from …)". Preset data date
   shown as an unobtrusive header/footer note. Includes a **SCHD-vs-Blend comparison**.
7. **Corrected fee and cost modelling** — compounding fee drag, brokerage/platform fees, and FX spread
   on each conversion.

## Constraints

- **NZD is the reporting currency.** The FIF threshold is a statutory **NZ$50,000**; expressing it in
  USD would make it drift with the exchange rate and stop matching the law. Assets are quoted in their
  native currency and converted at an explicit rate plus spread. Multi-jurisdiction support is a
  different product, not a currency dropdown.
- **`.claude/rules/nz-tax.md` is the tax authority.** No rate or threshold may be stated from memory;
  each is cited to IRD with the date checked.
- **`.claude/rules/calculator-invariants.md` is binding** — 16 rules, each written because the
  2026-08-06 audit found it violated.
- **Return-basis decomposition (decided 2026-08-06):** no issuer publishes price-only returns. Follow
  the industry-standard decomposition — **price return = total return − dividend yield** — performed
  in exactly one place and documented at the call site. Never add a yield on top of a total return.
- **Preset growth assumptions use the 10-year CAGR**, never trailing 1-year. A refresh on 2026-08-06
  briefly introduced 1-year total returns (SCHD at 24.08%) as long-run defaults; that is rejected.
- **One authoritative fund table.** `etfs.json` and `dividend_portfolio.json` currently disagree about
  SCHD and must be reconciled. Every row carries `asOf`, `source`, `domicile` and `expenseRatio`.
  Unverifiable fields are `null`, never `0` — zero-as-unknown is the bug being fixed.
- Existing stack is fixed: Next.js 15 App Router, React 19, TypeScript strict, Tailwind + shadcn/ui,
  pnpm. Vitest is the test runner.

## Quality Bar

- **The failure mode is a wrong number, not a crash.** A projection always returns something
  plausible. Silence is the dangerous outcome — prefer failing loudly over coercing bad input to zero.
- **TDD is mandatory for `lib/`** (the calculation and tax layer): RED before GREEN, every slice.
  **Relaxed for UI-only slices**, which may use `bin/lean-spec advance --no-tdd` with a logged reason.
  Tests for money maths use hand-computed fixtures, and each tax test names the IRD rule it encodes.
- `pnpm lint` clean (zero warnings), `pnpm build` succeeds, `pnpm test` green before any close.
- Every fix lands as its own slice with a **before/after comparison**, because each one changes numbers
  that may already have been planned around.
- Reviewer verdict `APPROVE` required to close. The agent that writes code never reviews it.

## Non-Goals

- **Not tax advice.** A planning tool. It must not present output as a filing position.
- **No second jurisdiction.** NZ tax residents only.
- **No capital drawdown model** in the first pass — "live off dividends" means never touching
  principal. Full decumulation is a separate, larger feature.
- **No live market data feed.** Fund figures are periodically refreshed static data with visible
  `asOf` provenance.
- **No account linking, portfolio import, or brokerage integration.**
- **No trader-intent CGT modelling.** NZ has no general CGT for long-term investors; the trader test is
  out of scope.
- **Not rebuilding the app.** Fix the calculation layer and add the features above on the existing
  Next.js codebase.
