# NZ tax regime — the domain rules this calculator must obey

> **This file is the authority on New Zealand investment tax for this project.** It exists because
> NZ's regime is genuinely unusual and every wrong assumption here produces a plausible-looking
> number that is wrong by a factor of 2–100×. An audit on 2026-08-06 found four components
> implementing four mutually inconsistent tax models, none of them correct.
>
> **Never state a tax rate from memory. Verify against ird.govt.nz and cite it.**

## The one thing to understand first

**New Zealand does not tax you on the dividends you actually receive from most foreign ETFs.** It
taxes you on a *deemed* return. Any code that computes `tax = dividends × rate` for a foreign
holding above the threshold is wrong by construction, no matter what rate it uses.

## FIF (Foreign Investment Fund) — the dominant rule

Applies to overseas shares/ETFs (including all US-domiciled ETFs — VOO, SCHD, QQQ, VTI…).

| Condition | Treatment |
|---|---|
| Total **cost** of foreign holdings ≤ **NZ$50,000** (de minimis) | FIF does **not** apply — tax actual dividends at your marginal rate |
| Above the threshold | FIF applies — tax a **deemed** return, ignore actual dividends |

**Fair Dividend Rate (FDR):** deemed income = **5% of opening market value** each year.
**Comparative Value (CV):** deemed income = actual economic gain over the year.
**An individual may use the LOWER of FDR and CV each year** — which means **tax is $0 in a losing
year**. A flat 5%-always model overstates tax in down years and is not what an informed investor pays.

Effective annual drag on portfolio value = `5% × your rate`:

| Your rate | Effective FDR drag |
|---|---|
| 28% (PIE, PIR-capped) | **1.40%** |
| 33% (direct, $78,101–$180,000) | **1.65%** |
| 39% (direct, over $180,000) | **1.95%** |

⚠️ **The number 1.4% is a percentage of PORTFOLIO VALUE, not of dividends.** Applying it to a
dividend stream understates tax by roughly 100×. This exact bug was live in
`InvestmentProjectionCalculator`.

**Threshold crossing matters.** A projection starting under $50k and growing past it must switch
regimes mid-projection. The threshold tests **cost**, not market value.

**Proposed change — treat as UNCONFIRMED:** Budget 2026 signalled raising the de minimis to
NZ$100,000 from the 2026–27 year. Do not hardcode it as fact; make the threshold a parameter with
$50,000 as the default and a documented note.

## PIE vs direct holding — decides the rate

- **PIE (Portfolio Investment Entity)** — NZ-domiciled funds (Smartshares, Kernel, InvestNow
  wrappers). Taxed at your **Prescribed Investor Rate (PIR): 10.5% / 17.5% / 28%**, capped at 28%.
  This cap is why a high earner is often better off in a PIE wrapper than holding the US ETF directly.
- **Direct foreign holding** (Hatch/Sharesies/IBKR buying US-listed ETFs) — FIF income is taxed at
  your **marginal rate**: 10.5 / 17.5 / 30 / 33 / 39%.

The same investor holding "the same" S&P 500 exposure pays **1.40%** via a PIE and **1.95%** directly
at the top rate. The wrapper is a first-class modelling input, not a detail.

## Withholding tax

- **US-domiciled ETFs:** 15% US withholding on dividends **with a W-8BEN** on file (NZ–US DTA),
  **30% without**. Most retail platforms file it automatically — confirm per platform.
- That US WHT is **creditable against the NZ FIF liability, capped at that liability.** Modelling
  both in full, uncredited, double-taxes the investor.

## What NZ does *not* tax

- **No general capital gains tax** for a long-term investor. **Never deduct CGT.** (The "trader"
  intent test can apply to someone trading frequently — out of scope for this calculator, but do
  not silently assume it away either.)

## Other regimes to keep straight

- **ASX-listed Australian shares** may be **exempt from FIF** and taxed on actual dividends instead.
- **Imputation credits** (NZ shares) and **franking credits** (AU) reduce tax payable — not currently
  modelled anywhere.
- **RWT/NRWT** applies to NZ-sourced dividends.

## Tax on reinvested dividends

**Reinvesting is not deferral.** Under DRIP, the investor still owes tax in the year the income
arises even though no cash was received. Any model that only taxes withdrawn cash is wrong.

## Non-negotiables for code

1. **One engine.** All tax logic lives in a single shared module. Four components must never each
   carry their own model — that is precisely how the audit found four different answers.
2. **Rates are inputs, not constants.** No hardcoded `netCAGR = 15` with tax baked in invisibly.
3. **Cite the source.** Any rate or threshold in code carries a comment naming the IRD page it came
   from and the date checked.
4. **State the assumption in the UI.** A user must be able to see which regime (PIE vs direct, above
   vs below threshold, FDR vs CV) produced their number.

## Sources (verified 2026-08-06)

- [IRD — FIF rules and exemptions](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-income/foreign-investment-funds-fifs/foreign-investment-fund-rules-exemptions)
- [IRD tax policy — FIF changes information sheet (2026)](https://www.taxpolicy.ird.govt.nz/-/media/project/ir/tp/publications/2026/is-foreign-investment-fund.pdf)
- [IRD — Multi-rate PIEs and prescribed investor rates](https://www.ird.govt.nz/roles/portfolio-investment-entities/multi-rate-pies-and-prescribed-investor-rates)
- [IRD — ASX-listed share exemption tool](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-income/foreign-investment-funds-fifs/foreign-investment-fund-rules-exemptions/foreign-investment-fund-australian-listed-share-exemption-tool)
- [PwC — NZ withholding taxes](https://taxsummaries.pwc.com/new-zealand/corporate/withholding-taxes)
