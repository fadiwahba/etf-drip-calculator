# Calculator invariants — the maths rules that must hold

> Every rule here was written because the 2026-08-06 audit found it **violated** in shipped code.
> These are not style preferences; each one is a defect class that produces a confidently wrong
> number with no error.

## The failure mode to fear

A financial projection never crashes. It returns a number that looks reasonable and is wrong. There
is no stack trace, no red test, nothing to notice — just a decision made on a bad figure. **Silence
is the dangerous outcome here, not a crash.** Prefer failing loudly over coercing bad input to 0.

## Compounding

1. **A term of N years compounds N times, not N+1.** Loop `year < term`, or emit year 0 as a
   pre-growth opening row that runs no growth. *(Was `year <= term` with a full 12-month inner loop —
   a 15-year projection compounded 16 years, ~15% overstatement at 15% CAGR.)*
2. **Convert annual rates to periodic rates geometrically, never arithmetically.**
   `periodRate = (1 + annualRate)^(1/periodsPerYear) − 1`, **not** `annualRate / periodsPerYear`.
   *(The arithmetic form turned compounding frequency into a phantom growth lever: switching to
   "weekly" with zero contributions raised a 12% return to 12.73% effective.)*
3. **Compounding frequency and contribution frequency are independent.** Do not derive one from the
   other. A user changing how often they deposit must not change the growth model.
4. **Contribution timing is a stated decision.** Start-of-period vs end-of-period changes a 30-year
   result materially. Pick one, document it in the UI, apply it consistently. Crediting 12 months of
   contributions at the start of a year grants roughly half a year of growth that was never earned.

## Growth and income must not double-count

5. **Decide once whether a return figure is price-only or total return, and label it.** If
   `avgReturn` is a total return, adding a dividend yield on top double-counts. If it is price-only,
   the dividend must be added. Both are defensible; silently mixing them is not.
6. **Grow dividend *per share*, not dividend *yield*.** Applying a growing yield to an already-grown
   NAV compounds dividend growth on top of price growth. Correct form:
   ```
   divPerShare_t = divPerShare_0 × (1 + divGrowth)^t
   grossDividends_t = shares_t × divPerShare_t
   ```
   Yield then falls out naturally as `divPerShare / price`. *(The wrong form produced an effective
   ~19%/yr per-share dividend growth from an 11% input, overstating year-15 dividends ~2.7×.)*
7. **Historical CAGRs are usually already net of the expense ratio.** Charging a fee on top of a net
   historical return double-charges it. State which convention each data field uses.

## Fees

8. **Fee drag must compound.** Deducting a fee from a displayed balance while the underlying share
   count is untouched means next year's opening value ignores every prior fee — the drag silently
   resets each year. Either reduce the share count (`shares -= fees / price`) or fold the fee into
   the growth rate. Do not do both.
9. **Model the costs that actually recur:** management fee/TER, per-trade brokerage, platform fee,
   and **FX spread** (~0.4–0.5% each way on retail NZ platforms) on every contribution into a
   non-NZD asset. A calculator quoting NZD results for USD assets with no FX model is incomplete.

## Tax

10. **All tax logic goes through one shared module.** See `nz-tax.md`. Per-component tax maths is
    banned — that is how four components ended up with four different answers for one investor.
11. **Tax is levied on the right base.** An FDR-derived rate applies to **portfolio value**; a
    dividend tax rate applies to **dividends**. Mixing them is a ~100× error.

## Reported metrics

12. **Contributions are not returns.** Any "return", "CAGR" or "cumulative growth" figure must
    subtract cumulative contributions, or be relabelled "growth in value". Comparing an
    end balance that includes deposits against a starting balance inflates every reported return.
13. **Guard the degenerate cases.** Zero rate, zero initial investment, zero term. `NaN` and
    `Infinity` must never reach the UI — if the inputs cannot produce a result, say so.

## Input handling

14. **Do not coerce invalid input to zero.** An empty or negative field must surface an error, not
    silently yield a $0 projection. `Number('')` is `0`, and that has produced blank tables with no
    explanation. HTML `min`/`max` attributes are not validation — enforce in code.

## Money representation

15. **float64 is fine for projections.** Drift is orders of magnitude below model error. This is a
    forecasting tool, not a ledger — do **not** "fix" it with integer cents.

## Verification

16. **Every calculation function needs a test with a hand-computed fixture.** A 2–3 year projection
    checked against a spreadsheet catches every defect class above. The project currently has no test
    infrastructure at all, which is why all of this shipped.
