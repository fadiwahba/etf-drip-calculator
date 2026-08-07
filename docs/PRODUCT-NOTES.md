# Product notes — requirements and design analysis (2026-08-06)

Captured from Fady's direction, with the design consequences worked through. **This document feeds
`/lean-spec:plan`** — it is input to the PRD interview, not the PRD itself.

---

## 1. Two tax modes: NZ-domiciled vs US-domiciled

### Why this is more than a toggle

A NZ tax resident's tax bill depends on **where the fund is domiciled**, not where the underlying
companies are. The same S&P 500 exposure is taxed two completely different ways:

| | **NZ PIE fund** (Smartshares, Kernel) | **US-domiciled ETF** (VOO, SCHD) held directly |
|---|---|---|
| Who pays FIF tax | **The fund does**, internally, at fund level | **You do**, personally |
| Your rate | **PIR — capped at 28%** | **Marginal rate — up to 39%** |
| NZ$50k de minimis | **Doesn't apply to you** (a NZ PIE isn't a foreign holding) | **Applies** — under it, FIF is off and you're taxed on actual dividends |
| US withholding | Suffered inside the fund | 15% with W-8BEN, 30% without — **creditable** against your FIF liability |
| Currency | NZD native | NZD→USD conversion + **FX spread each way** |
| Effective drag | **1.40%** of value (5% × 28%) | **1.65%** (33%) or **1.95%** (39%) |

### The insight the calculator should surface

The better wrapper **flips depending on portfolio size and income**:

- **Below NZ$50k** — direct US ETFs usually win. No FIF at all; you're taxed only on the ~1.3%
  dividend yield, not on 5% of the balance.
- **Above NZ$50k on a high marginal rate** — the PIE's 28% cap usually wins. 1.40% beats 1.95%,
  a 0.55%/yr difference that compounds hard over 30 years.

A calculator that just picks one mode hides the single most valuable decision the user faces.

### Proposed UX

**A three-way segmented control, not a binary switch:**

```
┌─────────────────┬──────────────────────┬───────────────┐
│  NZ PIE funds   │  US ETFs (direct)    │  Compare both │
└─────────────────┴──────────────────────┴───────────────┘
```

- **NZ PIE funds** → reveals a **PIR selector** (10.5 / 17.5 / 28%) with a one-line "how to find
  yours" hint.
- **US ETFs (direct)** → reveals **marginal rate** (10.5 / 17.5 / 30 / 33 / 39%), a **W-8BEN filed?**
  toggle (15% vs 30% withholding), and **FX spread %**.
- **Compare both** → runs the projection twice and plots both lines, with a callout naming the
  **crossover year** where the cheaper wrapper changes. This is the recommended default for a new
  user, and it is the feature that justifies the whole two-mode design.

**Always-visible tax explainer.** A single live line under the control, e.g.
*"Above the NZ$50,000 threshold → FIF applies. Tax = 5% of opening value × 33% = 1.65%/yr,
less US withholding credit."* It must be possible to see **which regime produced the number** without
opening documentation.

**Threshold crossing must be modelled.** A projection starting at $30k and growing past $50k switches
regime mid-run. The threshold tests **cost**, not market value — so it's cumulative contributions plus
initial capital, not the balance.

---

## 2. Two user scenarios, one model

### The personas

- **Accumulator (young).** Contributing monthly, wants to see the balance and annual dividends grow,
  and to know *when* dividends could replace their income.
- **Decumulator (established).** Large existing capital, no contributions, wants to know what passive
  income it throws off now and in N years.

### Fady's proposal, and the refinement

The proposal — default to contributions, add a "stop contributing at year N" field — is right, and it
unifies both personas into **one model with a parameter**. Setting the stop year to 0 gives the
decumulator for free; no second calculator, no divergent maths. That directly avoids the failure that
produced four inconsistent tax models.

**But "stop contributing" and "start living off dividends" are two different events**, and collapsing
them loses a phase most people actually have:

| Phase | Contributions | Dividends |
|---|---|---|
| **1. Accumulate** | Yes | Reinvested (DRIP) |
| **2. Coast** | No | Still reinvested — balance keeps compounding |
| **3. Draw** | No | Taken as income — compounding stops |

Someone who stops contributing at 50 but doesn't retire until 65 spends 15 years in **Coast**, and
that phase is where a lot of the growth happens. So: **two inputs**, `contributionsStopYear` and
`drawdownStartYear`, with drawdown defaulting to the contribution-stop year so the simple case stays
one field.

### The output that answers the actual question

Add a **target annual income** input and report a **crossover year** — the first year net annual
dividends exceed the target. That is the number both personas actually came for: *"when can I live
off this?"*

### ⚠️ Inflation is not optional here

**This is the single biggest risk in the whole feature.** "Can I live off $80,000/yr of dividends in
30 years?" is meaningless in nominal dollars. At the RBNZ 2% target midpoint, $1 today is worth about
**$0.55 in 30 years** — so a nominal projection makes the answer look roughly **twice as good as it
is**.

Requirements:
- An **inflation rate** input (default 2%, the RBNZ target midpoint).
- Every headline figure shown in **today's dollars**, with nominal available as a toggle — not the
  other way round.
- The crossover year computed against a **real** (inflation-adjusted) target income.

Shipping the crossover feature without this would produce a confidently wrong retirement date. Given
the audit already found this project overstating results in four separate ways, adding a fifth is not
acceptable.

### Second-order questions to settle in the interview

- **Does the drawdown phase deplete capital, or is it dividends-only?** Dividends-only (never touching
  principal) is the conservative, simpler model and matches "live off dividends". A full drawdown model
  is a separate, larger feature.
- **Are dividends taxed differently once drawn?** Under FIF, no — the deemed-income tax is on the
  balance regardless of whether you reinvest or spend. Worth stating explicitly in the UI, because it
  surprises people.
- **Does the balance keep growing during drawdown?** Yes, via price growth — dividends leaving does
  not stop capital appreciation.

---

## 3. Testing

Vitest is installed and green (`pnpm test`). `rules.toml` has `tdd = true`, so every slice needs a
failing test first. The audit's remediation order already assumed this: **tests land before fixes**,
so each defect is proven rather than asserted.

For the maths, a test is a hand-computed 2–3 year fixture. For the tax engine, each regime gets a
worked example with the IRD rule it implements cited in the test name.

---

## 4. Suggested slice order for `/lean-spec:plan`

Each is independently shippable and independently verifiable:

1. **`lib/nzTax.ts` + tests** — the shared engine. FIF/FDR/CV, PIE vs direct, thresholds, WHT credit.
   Subsumes three CRITICAL audit findings.
2. **Fix the four arithmetic defects** — off-by-one, contribution frequency, dividend-growth
   double-compound, non-compounding fees. Small, surgical, each with a fixture.
3. **Tax-mode segmented control + compare view** — the UX above, on top of (1).
4. **Phase model** — `contributionsStopYear`, `drawdownStartYear`, target income, crossover year.
5. **Inflation / real-dollar reporting** — arguably belongs *with* (4) rather than after it, since (4)
   is misleading without it.
6. Hygiene: FX and brokerage fees, input validation, dead-code removal.

---

## 5. Inflation (decided 2026-08-06)

- **Input**, default **3%** (above the RBNZ 2% midpoint — deliberately conservative for a
  30-year projection).
- **Toggle, default ON.** Real (today's-dollar) figures are the default view; nominal is opt-in.
- **A dedicated table column showing inflation's bite.** Correct label: **"Purchasing power lost"**
  or **"Real value adjustment"** — *not* "expense". Inflation is not a cash outflow like a fee; no
  money leaves the account. It is the gap between the nominal balance and what that balance can buy.
  Calling it an expense in the same column group as fees and tax would be a category error, and the
  fee/tax columns are real deductions that must stay distinguishable from it.

Suggested column set per year: `Nominal balance` · `Real balance (today's $)` · `Purchasing power
lost` · `Dividends (nominal)` · `Dividends (real)`.

## 6. Currency: NZD is the reporting currency (decided 2026-08-06)

**Report in NZD. Quote assets in their native currency. Do not redenominate to USD "for
universality."**

The reason is not preference — it is that **the tax rules are New Zealand's**. The FIF de minimis is
a statutory **NZ$50,000**; the PIR bands, marginal rates and the ASX exemption are all NZD constructs.
Expressing the threshold in USD would make it drift with the exchange rate and stop matching the law.

So:
- **Reporting/base currency: NZD.** The user earns, spends, retires and is taxed in NZD. The "can I
  live off this?" answer is only meaningful in the currency of their expenses.
- **Asset quote currency: native** (USD for VOO/SCHD, NZD for Smartshares/Kernel), converted at an
  explicit **FX rate input** plus a **spread** on each conversion.
- **Universality is a different product.** Supporting a second jurisdiction means a second tax
  regime, not a currency dropdown. Out of scope; revisit only if there's a real second user.

## 7. What the default numbers are — SOLVED

Fady couldn't remember what the DripCalculator defaults were modelled on. **They are pure SCHD**, and
the match is exact:

| Field | `DripCalculator.tsx:78-84` | `data/dividend_portfolio.json[0]` |
|---|---|---|
| `sharePriceGrowth` | 7.5 | **7.5** |
| `dividendYield` | 3.6 | **3.6** |
| `dividendGrowth` | 11 | **11** |
| `expenseRatio` | 0.06 | **0.06** |

`portfolioName: "SCHD"`. The `currentSharePrice: 26` default is consistent (`etfs.json` carries SCHD
at 27.44). So the calculator has always been a **single-fund SCHD model** with the parameters
hardcoded from that file's first row.

### The blend feature was already half-built

`data/dividend_portfolio.json` is exactly the "blend of dividend ETFs" Fady is now asking for — it
holds 11 entries (SCHD, FDVV, VYMI, DGRO, EUFN, VIG…), of which **4 are populated and 7 are zero
placeholders**, and **nothing in the codebase imports it**. It is an abandoned first attempt at
weighted-portfolio support.

**Recommendation:** revive it rather than start over.

1. **Populate the 7 zero rows** (or drop the tickers that were speculative). A zero-yield row silently
   drags a weighted average toward zero — worse than absent.
2. **Add a `weight` field** per holding, validated to sum to 100%.
3. **Compute the blend as a weighted average** of `sharePriceGrowth`, `dividendYield`,
   `dividendGrowth` and `expenseRatio`. ⚠️ Weight the **yield by market value**, not equally — a naive
   mean of yields is wrong unless the holdings are equal-weighted.
4. **UI: a "Single fund / Blended portfolio" mode**, plus a **SCHD-vs-blend comparison** — the same
   compare pattern as the tax-mode control in §1, and the direct answer to Fady's question.
5. Note the correlation caveat: a weighted average of CAGRs is **not** the CAGR of the blend
   (rebalancing and covariance matter). Acceptable as a documented simplification — but it must be
   documented, not implied.

### Data caveat carried over from the audit

`etfs.json` lists **0.0% dividend yield for VOO / VOOG / VGT / SCHG** (actual ≈ 1.2 / 0.7 / 0.5 /
0.4%) and SCHD at 3.0% while `dividend_portfolio.json` says 3.6%. **The two files disagree about
SCHD.** Both need reconciling against a live source before any blend maths is trusted, and there
should be **one** authoritative fund table, not two.

## 8. Portfolio presets (decided 2026-08-06)

**Presets AND custom — not either/or.**

```
Portfolio preset:  [ SCHD ▾ ]
                     SCHD  (single fund)
                     Dividend Blend  (SCHD, FDVV, VYMI, DGRO, EUFN, VIG)
                     ──────────────
                     Custom
```

- Selecting a preset **populates the input fields**; it never locks them. The numbers driving the
  projection stay visible and editable — they are the whole answer, so hiding them is not an option.
- Editing any field flips the label to **"Custom (modified from SCHD)"**.
- **Custom is first-class**, not a fallback: a real user's holdings rarely match a preset exactly.
- Ship the **SCHD-vs-Blend comparison view** alongside it (same pattern as the tax-mode compare in
  §1). A dropdown alone forces the user to run the model twice and hold both results in their head.

**`asOf` presentation — decided:** show the preset's data date as an **unobtrusive note in a header
or footer line**, not as a badge or inline chip next to the control. Muted/secondary text, small,
e.g. *"Preset data as of 6 Aug 2026"*. It must be **present and findable** (presets go stale — that
is why the data was refreshed) but must not compete with the inputs for attention.

## Still needs Fady's answer

Unchanged from `AUDIT-2026-08-06.md`, and now more load-bearing given the two-mode design:

1. **Which platform?** (Sharesies / Hatch / IBKR / InvestNow / Tiger)
2. **Your marginal rate and PIR** — sets the defaults for both modes
3. **Is your foreign-holdings cost already over NZ$50k?**
4. **Are `etfs.json`'s `avgReturn` figures price-only or total return?**
5. **Is `RetirementAnalysis copy.tsx` deletable?**
