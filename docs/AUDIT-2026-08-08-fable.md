# Audit — 2026-08-08 (independent, adversarial)

Scope: the numbers the Portfolio Projection Calculator showed Fady on 2026-08-08, the engine code
behind them, the tests, the PRD, and the shipped defaults. Method: I re-implemented the whole
engine (projection + tax + real terms + crossover) from scratch in a standalone script, ran it
against Fady's exact inputs, and compared it to the live app at localhost:3000 (driven via
Playwright). I did not reuse any project code in the check.

**Every number was verified two ways: my independent reimplementation, and the live app. They
agree with each other and with Fady's screenshot to the dollar.**

---

## Verdict

**Only with caveats — and one caveat is disqualifying today.**

The engine's arithmetic is correct. All seven figures Fady saw reproduce exactly from the stated
model, the app matches the engine, the 189 tests pass, degenerate inputs fail loudly, and the
nominal/real/compare views are internally consistent. This is a well-built engine.

But the numbers Fady saw are still **not numbers to act on**, because the shipped default
`dividendGrowth = 0` makes the projection model a fund that does not exist: one whose price
compounds at 9.12%/yr while its per-share payout never rises. That single default drives the
headline answer ("when can I live off my dividends?") to a confidently wrong "never, and your
dividend income is negative". The engine is right; the default is wrong.

Two smaller real defects also exist: the PIE tax leg wrongly gets the $50k FIF de minimis, and
the Compare card mixes nominal and real dollars on one screen.

---

## Critical findings (wrong numbers a user would act on)

### 1. All of Fady's figures reproduce exactly — the engine did what it was told

My independent script, given Fady's inputs (100k initial · 30y · 1,000/mo · stop 15 · draw 16 ·
9.12% growth · 3.25% yield · 0% dividend growth · 33% marginal · 15% WHT · 3% inflation, real ON,
target 60k):

| Figure | App / Fady | My reimplementation |
|---|---|---|
| Final portfolio (real) | $916,285 | $916,285 |
| Final-year gross dividends (real) | $2,204 | $2,204 |
| Total tax (real) | $222,409 | $222,409 |
| Net gain (real) | $680,732 | $680,732 |
| Total income drawn (real) | $38,989 | $38,989 |
| Crossover | Not reached | Not reached |
| Final-year net dividend income | −$11,859 | −$11,859 |

So: **no wiring bug, no engine arithmetic bug in this scenario.** The problem is upstream, in
what the model was asked to compute (finding 2).

### 2. The $2,204 dividends: the yield collapses from 3.25% to 0.24% — by construction

`lib/projection.ts:318` grows the dividend **per share**: `divPerShare_t = divPerShare_0 ×
(1+divGrowth)^t`. That is the correct form (invariant 6, and the tests pin it). With
`dividendGrowth = 0` the per-share dividend stays flat forever while the price compounds:

- 1.0912³⁰ = **13.71×** price over 30 years
- effective yield = 3.25% / 13.71 = **0.237%** in year 30
- year-30 nominal gross dividends: 0.26% of a ~$2.07M opening = **$5,350**; ÷ 1.03³⁰ = **$2,204 real** ✓

This exactly reproduces the number on screen. The hypothesis I was asked to test — engine right,
default wrong — **is confirmed**. See "The dividend-growth question" below.

### 3. Total tax $222,409 is credible — it is FDR on portfolio value, not a bug

Above the $50k cost threshold, deemed income = 5% of opening value (FDR), taxed at 33% =
**1.65% of portfolio value per year**, with the (tiny) US WHT credited against it
(`lib/nzTax.ts:154,170-176`). Hand check: the real portfolio value averages roughly $450k across
the 30 years; 1.65% × ~$450k × 30y ≈ **$223k**. The app says $222,409 (real; $408,946 nominal).
Every year in the table uses FDR (CV is larger since total return > 5%), which is the correct
lower-of choice. **Not a defect** — this is what NZ FIF tax actually costs at a 33% marginal rate.

### 4. Net dividend income −$11,859 is arithmetically correct, but the UI makes it unreadable

`findIncomeCrossover` defines net income = gross dividends − total tax (`lib/projection.ts:588`).
Year 30 real: $2,204 gross − ($13,732 NZ tax + $331 WHT) = **−$11,859** ✓. Under FIF, the tax bill
is charged on the portfolio's *value*, and with the collapsed yield the dividend stream is far
smaller than the tax bill, so the metric goes negative. That is the honest consequence of the
inputs — but see "Other findings" #3: the projection *also* pays this same tax by selling shares,
and the UI never explains why "Total Income Drawn $38,989" and a negative income figure sit on the
same screen. A user cannot reconcile them without reading source comments.

### 5. Total income drawn $38,989 checks out

Draw years are 16–30 (15 years; `contributionsStopYear: 15` means year 15 itself has no
contribution, so contributions run years 1–14 = 14 × $12,000 = $168,000 — confirmed by the nominal
Net Gain: $2,224,065 − $100,000 − $168,000 = $1,956,065, which is what the app shows with real
terms off). Drawn cash is gross dividends less WHT only (`lib/projection.ts:330`), averaging
~$2,600/yr real because of the collapsed yield. Correct given the inputs.

### 6. Sanity arithmetic — the growth core is right

$100k + $1,000/mo for 15y at 9.12%, dividends and tax off: closed form gives
100k × 1.0912¹⁵ (= $370k) + 12k/yr start-of-month annuity (≈ $370k) ≈ **$740k**. Engine: **$743,317**. ✓
The app default view (no contributions, 15y) shows $245,654 real — my reimplementation gives
$245,654. ✓

---

## The dividend-growth question — ruling

**The engine is right. The default is a trap. Ship a different default.**

- **The mechanism is confirmed** (finding 2). `dividendGrowth = 0` beside 9.12% price growth
  implies a payout ratio falling toward zero for 30 years. No dividend ETF behaves this way; SCHD
  has raised its per-share dividend every year since 2011.
- **A sourced figure exists.** Issuers do not publish a "10-year dividend CAGR" *statistic*
  (the UI note is literally true), but they do publish the full per-share **distribution
  history**, from which a 10-year per-share CAGR is directly computable from primary data — the
  same provenance standard `data/funds.json` already meets. Third-party computations of SCHD's
  10-year dividend-per-share CAGR land at roughly **9–11.5%** (financecharts.com: 9.07%;
  stockanalysis.com history: ~$0.35/share 2015 → ~$1.05/share 2025 ≈ 11.6%/yr; 5-year figure
  ≈ 7%). Sources: [financecharts SCHD dividend CAGR](https://www.financecharts.com/etfs/SCHD/dividends/dividends-cagr),
  [stockanalysis.com SCHD dividend history](https://stockanalysis.com/etf/schd/dividend/).
  I did not compute the figure from Schwab's own distribution table myself — do that before
  seeding it (Constitution §3).
- **The default decides the product's answer.** Measured sensitivity (app and script agree):

  | dividendGrowth | Final-yr gross div (real) | Income drawn (real) | Final-yr net income (real) |
  |---|---|---|---|
  | 0% (shipped) | $2,204 | $38,989 | −$11,859 |
  | 5% | $10,636 | $130,143 | −$5,065 |
  | 7% | $19,975 | $213,772 | +$3,233 |
  | 9.12% | $39,241 | $366,579 | +$20,984 |

  A 17.8× swing in the headline dividend figure from one defaulted field. "0 is a stated
  assumption" in small grey text does not carry that weight — this is precisely the project's own
  named failure mode: a plausible number, silently wrong (Constitution §1). Classification:
  **[wrong default]**, severity critical.

- **One more honest truth the ruling must include:** even at 9.12% dividend growth the $60k
  target is *still* "Not reached". Net sustainable yield ≈ 3.25% gross − 1.65% FDR drag ≈
  **1.6–1.8% of portfolio value**, so $60k/yr real needs roughly **$3.4–3.75M in today's
  dollars**. Fady's inputs reach ~$1.2M real. Fixing the default makes the numbers coherent; it
  does not make the plan reach the target. The app should say what portfolio the target needs
  (see next slices).

---

## Other findings (ranked)

1. **[engine bug] The PIE wrapper is granted the $50k FIF de minimis.** The threshold check
   (`lib/nzTax.ts:141`) ignores the wrapper, so a PIE portfolio under $50k cost is taxed on
   actual dividends at PIR. Verified live: $30k initial, PIE mode → *"Year 1 is Dividend (actual
   dividends), below the $50,000 de minimis, taxed at PIR 28.0% … Regime changes to FIF in year
   22."* The project's own rules say the de minimis "doesn't apply to you" for a PIE
   (`docs/PRODUCT-NOTES.md` §1 table) — a PIE runs FIF at fund level from dollar one. Impact: at a
   3.25% yield the modelled PIE drag below $50k is 0.91% of value vs the correct ~1.40%, so the
   Compare view flatters PIE exactly in the sub-$50k region where the product's own insight says
   direct wins. No effect on Fady's trigger scenario (cost starts at $100k). **No test pins this
   either way** — the 189-test suite is silent on wrapper × threshold interaction.

2. **[UI] The Compare card mixes nominal and real dollars, unlabelled.** With real terms ON, the
   summary tiles show $916,285 (today's dollars) while the Compare card shows "US ETFs (direct)
   final value $2,224,065" — the *same run, same portfolio*, 2.4× apart on one screen.
   `components/InvestmentProjectionCalculator.tsx:559,565` read
   `projection.comparison.pie/direct.finalValueNzd`, which are never deflated, and the card labels
   carry no "(today's dollars)" suffix. Screenshot: `~/.playwright-mcp/compare-mixed-units.png`.

3. **[modelling choice] The crossover metric and the projection disagree about who pays the NZ
   tax.** The projection settles NZ tax by selling shares in every phase
   (`lib/projection.ts:367`), and "Total Income Drawn" is therefore reported gross of NZ tax. The
   crossover metric instead subtracts the full tax from income (`lib/projection.ts:588`,
   deliberate per its C2 comment). Each convention is defensible; showing both side by side with
   no explanation is not. Also, because of the share-sale settlement, the UI claim "principal is
   untouched" during Draw is not literally true — the share count falls every year by
   `nzTax / price`. Not a bug (the code comments state the choice), but the UI must reconcile the
   two stories or a user will trust neither.

4. **[UI] The crossover card's "−$11,859 net dividend income" is the final-year figure but is not
   labelled as such**, and nothing on the card explains that FIF tax is charged on portfolio
   value (which is why income can be negative). The most honest number in the product currently
   reads as a glitch.

5. **[modelling choice] The PIE leg charges 15% US WHT and credits it against PIE tax** — a
   reasonable stand-in for the fund suffering WHT internally, but it is nowhere stated in the UI,
   and the "identical inputs" explainer implies more comparability than the tax law gives.

6. **[wrong default, minor] FX spread, brokerage and platform fee default to 0** while the PRD
   names Sharesies (FX ~0.4–0.5% each way) as the primary user's platform. The defaults
   understate real costs on every contribution. Not exercised in the trigger scenario.

7. **Test-suite gaps (context, not a defect):** the suite pins the engine's arithmetic well
   (hand-computed fixtures, error paths, NaN guards) but pins nothing about (a) wrapper ×
   threshold intent, (b) economic coherence of the *seeded* defaults, or (c) any rendered UI
   (vitest runs in node env; the nominal-vs-real Compare card mix is invisible to it). A passing
   suite here means "the model computes what it says", not "the model says the right thing".

Positive verification, for the record: input validation is exemplary — term 0, empty capital,
negative contribution, term 100, percent-shaped growth (912) and draw-before-stop all fail loudly
with named errors and no NaN ever rendered (invariants 13/14 hold in the live UI). PIE vs direct
compare ($2,367,304 vs $2,224,065, PIE leads $143,239, no flip) matches my reimplementation.

---

## Does the product answer the PRD's question?

Not yet. The PRD's central question is *"when can I live off my dividends, and how much will that
income really be worth?"* Today a reasonable user with reasonable inputs gets: "Not reached", a
negative income figure with no explanation, and a headline dividend number driven by an
incoherent default. Two changes close most of the gap: a sourced dividend-growth default
(the crossover then behaves sensibly), and a "portfolio needed for your target" figure
(target ÷ net yield), since with honest inputs the true answer to Fady's scenario is "not with
these contributions — you need roughly $3.5M+ in today's dollars", and the app should say so
rather than just "Not reached".

---

## What I could not verify

- **The exact SCHD 10-year dividend-per-share CAGR.** Third-party sources disagree (9.07%–11.5%)
  depending on window and method. I did not compute it from Schwab's own distribution table.
- **The PIE rate-substitution convention against current IRD guidance.** I checked the code
  against the project's own rules files (which cite IRD); I did not independently re-verify the
  IRD pages themselves. The de minimis finding (#1) rests on the project's own documented rules.
- **Whether Fady's Sharesies account has a W-8BEN on file** (15% vs 30% WHT default).
- Browser note: the Chrome extension was not connected, so I drove the app through Playwright's
  own browser at the same URL. Same app, same numbers.

---

## Recommended next slices (priority order)

1. **Replace the `dividendGrowth` default.** Compute SCHD's 10-year per-share distribution CAGR
   from Schwab's own distribution history, store it in `data/funds.json` with `asOf`/`source`
   like every other figure, and seed it. If a computed-from-primary figure is judged to breach
   Constitution §6, then instead refuse to run (or show a prominent warning) when
   `dividendGrowth` is materially below `sharePriceGrowth`, and always display the final-year
   effective yield so a collapse is visible. Shipping 0 silently is the one option that is not
   defensible.
2. **Make the FIF de minimis wrapper-aware in `lib/nzTax.ts`** (PIE → FIF from $0), with tests
   pinning wrapper × threshold, and a before/after comparison since it changes sub-$50k numbers.
3. **Fix the Compare card units** — deflate both legs when real terms is on, or label the card
   "(nominal)".
4. **Reconcile the two income conventions in the UI** — label the crossover figure "final year",
   explain that FIF tax is charged on value (why income can be negative), and state next to
   "Total Income Drawn" that NZ tax was settled from the portfolio.
5. **Add "portfolio required for target income"** = target ÷ (net yield after FDR drag), in
   today's dollars — the direct answer to the PRD question when the crossover is not reached.
6. **Seed platform-realistic cost defaults** (Sharesies FX spread/brokerage) per the PRD's primary
   user.
