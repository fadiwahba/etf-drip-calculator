import { describe, it, expect } from "vitest";
import {
  parseNumericField,
  parseInflationRate,
  buildProjectionInput,
  seedAssumptionsFromFund,
  runProjection,
  formatEngineError,
  formatNzd,
  formatPhase,
  type ProjectionFormState,
} from "@/components/projectionInputs";
import { getFund, MissingAssumptionError } from "@/lib/funds";

// A fully valid form matching the spec's stated defaults (100k / 15y / SCHD seed / direct / 33% /
// 15% WHT) — every AC2-AC9 test starts from this and overrides only what it needs to isolate.
// features/inflation-real-terms/spec.md AC10 guardrail: showRealTerms/inflationRatePercent added
// here (disclosed in notes.md) matching the UI's own defaults (R6 — toggle on, "3") so every
// pre-existing test below keeps exercising the same real-terms-on path the UI ships with.
function makeForm(overrides: Partial<ProjectionFormState> = {}): ProjectionFormState {
  return {
    initialCapital: "100000",
    termYears: "15",
    extraMonthlyContribution: "0",
    sharePriceGrowthPercent: "9.12",
    dividendYieldPercent: "3.25",
    dividendGrowthPercent: "0",
    wrapper: "direct",
    pirPercent: "28",
    marginalRatePercent: "33",
    usWithholdingPercent: "15",
    platformFeePercent: "0",
    brokeragePerContribution: "0",
    fxSpreadPercent: "0",
    contributionsStopYear: "",
    drawdownStartYear: "",
    showRealTerms: true,
    inflationRatePercent: "3",
    ...overrides,
  };
}

describe("AC1 — parseNumericField never coerces invalid input to 0", () => {
  it("AC1a empty string returns ok:false naming the field", () => {
    const result = parseNumericField("", "Initial Capital (NZD)", { min: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Initial Capital (NZD)");
  });

  it("AC1b whitespace-only string returns ok:false naming the field", () => {
    const result = parseNumericField("   ", "Initial Capital (NZD)", { min: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Initial Capital (NZD)");
  });

  it("AC1c non-numeric string returns ok:false naming the field", () => {
    const result = parseNumericField("abc", "Initial Capital (NZD)", { min: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Initial Capital (NZD)");
  });

  it("AC1d a negative value on a non-negative field returns ok:false", () => {
    const result = parseNumericField("-5", "Initial Capital (NZD)", { min: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Initial Capital (NZD)");
  });

  it("AC1e 1e999 (parses to Infinity) returns ok:false", () => {
    const result = parseNumericField("1e999", "Initial Capital (NZD)", { min: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Initial Capital (NZD)");
  });

  it("AC1f a non-integer term returns ok:false", () => {
    const result = parseNumericField("15.5", "Investment Term (years)", {
      min: 1,
      max: 50,
      integer: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Investment Term (years)");
  });

  it("AC1g a value outside the field's stated range returns ok:false", () => {
    const result = parseNumericField("51", "Investment Term (years)", {
      min: 1,
      max: 50,
      integer: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Investment Term (years)");
  });

  it("AC1h a valid value returns ok:true with the parsed number", () => {
    const result = parseNumericField("15", "Investment Term (years)", {
      min: 1,
      max: 50,
      integer: true,
    });
    expect(result).toEqual({ ok: true, value: 15 });
  });
});

describe("AC2 — percent to decimal exactly once", () => {
  it("converts every percent field by /100 exactly once, no double division", () => {
    const result = buildProjectionInput(makeForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sharePriceGrowth).toBeCloseTo(0.0912, 10);
    expect(result.value.dividendGrowth).toBeCloseTo(0, 10);
    expect(result.value.marginalRate).toBeCloseTo(0.33, 10);
    expect(result.value.usWithholdingRate).toBeCloseTo(0.15, 10);
    expect(result.value.platformFeeAnnualRate).toBeCloseTo(0, 10);
    expect(result.value.fxSpreadRate).toBeCloseTo(0, 10);
  });
});

describe("AC3 — unit-share convention", () => {
  it("initialSharePriceNzd is 1, initialShares equals the NZD capital, dividend-per-share equals the yield decimal", () => {
    const result = buildProjectionInput(makeForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.initialSharePriceNzd).toBe(1);
    expect(result.value.initialShares).toBe(100000);
    expect(result.value.initialDividendPerShareNzd).toBeCloseTo(0.0325, 10);
  });
});

describe("AC4 — cadence is not multiplied", () => {
  it("500/month becomes contributionPerEventNzd 500 at a fixed cadence of 12, not extraContribution*12", () => {
    const result = buildProjectionInput(makeForm({ extraMonthlyContribution: "500" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contributionsPerYear).toBe(12);
    expect(result.value.contributionPerEventNzd).toBe(500);
    expect(result.value.contributionTiming).toBe("start");
    expect(result.value.compoundingPeriodsPerYear).toBe(1);
  });
});

describe("AC5 — net basis, fixed for every form state", () => {
  it("growthBasis is net-of-expense-ratio and expenseRatioAnnual is 0 on the default form", () => {
    const result = buildProjectionInput(makeForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.growthBasis).toBe("net-of-expense-ratio");
    expect(result.value.expenseRatioAnnual).toBe(0);
  });

  it("growthBasis and expenseRatioAnnual are unaffected by wrapper/pir overrides", () => {
    const result = buildProjectionInput(makeForm({ wrapper: "pie", pirPercent: "10.5" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.growthBasis).toBe("net-of-expense-ratio");
    expect(result.value.expenseRatioAnnual).toBe(0);
  });
});

describe("AC6 — wrapper passthrough", () => {
  it("wrapper 'pie' yields pir as a decimal and keeps marginalRate present", () => {
    const result = buildProjectionInput(makeForm({ wrapper: "pie", pirPercent: "28" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.wrapper).toBe("pie");
    expect(result.value.pir).toBeCloseTo(0.28, 10);
    expect(result.value.marginalRate).toBeCloseTo(0.33, 10);
  });

  it("wrapper 'direct' yields pir undefined, never 0", () => {
    const result = buildProjectionInput(makeForm({ wrapper: "direct" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.wrapper).toBe("direct");
    expect(result.value.pir).toBeUndefined();
  });
});

describe("AC7 — seeded assumptions carry provenance and never re-derive", () => {
  it("seedAssumptionsFromFund(getFund('SCHD')) returns growth 9.12, yield 3.25, asOf and source", () => {
    const schd = getFund("SCHD");
    const seed = seedAssumptionsFromFund(schd);
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    expect(seed.sharePriceGrowthPercent).toBeCloseTo(9.12, 6);
    expect(seed.dividendYieldPercent).toBeCloseTo(3.25, 6);
    expect(seed.asOf).toBe(schd.asOf);
    expect(seed.source).toBe(schd.source);
  });
});

describe("AC8 — a null assumption is unavailable, not zero", () => {
  it("seedAssumptionsFromFund(getFund('VYMI')) is unavailable, empty growth field, named ticker+unpublished", () => {
    const seed = seedAssumptionsFromFund(getFund("VYMI"));
    expect(seed.ok).toBe(false);
    if (seed.ok) return;
    expect(seed.sharePriceGrowthPercent).toBe("");
    expect(seed.message).toContain("VYMI");
    expect(seed.message.toLowerCase()).toContain("unpublish");
  });

  it("seedAssumptionsFromFund(getFund('FDVV')) is unavailable, empty growth field, named ticker+unpublished", () => {
    const seed = seedAssumptionsFromFund(getFund("FDVV"));
    expect(seed.ok).toBe(false);
    if (seed.ok) return;
    expect(seed.sharePriceGrowthPercent).toBe("");
    expect(seed.message).toContain("FDVV");
    expect(seed.message.toLowerCase()).toContain("unpublish");
  });

  it("runProjection on a form with a blank/invalid growth field returns ok:false and never calls project()", () => {
    const result = runProjection(makeForm({ sharePriceGrowthPercent: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("AC9 — engine errors surface verbatim through runProjection", () => {
  it("a ProjectionInputError from project() (sharePriceGrowth 150%) is caught and returned, not thrown", () => {
    const result = runProjection(makeForm({ sharePriceGrowthPercent: "150" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^ProjectionInputError: /);
  });

  it("a TaxInputError from project() (pir missing under PIE) is caught and returned, not thrown", () => {
    const result = runProjection(makeForm({ wrapper: "pie", pirPercent: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^TaxInputError: /);
    expect(result.errors[0]).toContain("pir");
  });

  it("formatEngineError surfaces a MissingAssumptionError verbatim as '<name>: <message>'", () => {
    const error = new MissingAssumptionError(
      "SCHD: sharePriceGrowth is unavailable -- cannot run a projection off a null assumption"
    );
    expect(formatEngineError(error)).toBe(
      "MissingAssumptionError: SCHD: sharePriceGrowth is unavailable -- cannot run a projection off a null assumption"
    );
  });

  it("the successful path never appears alongside an error path (sanity: valid form runs project())", () => {
    const result = runProjection(makeForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.length).toBe(16); // year 0 + 15 years
  });
});

describe("AC14 — NaN/Infinity cannot print", () => {
  it("formatNzd returns em dash for NaN", () => {
    expect(formatNzd(NaN)).toBe("—");
  });

  it("formatNzd returns em dash for Infinity", () => {
    expect(formatNzd(Infinity)).toBe("—");
  });

  it("formatNzd renders -0 as a plain zero, never a negative sign", () => {
    expect(formatNzd(-0)).toBe("$0");
  });

  it("formatNzd renders a normal finite number", () => {
    expect(formatNzd(1234.5)).toBe("$1,235");
  });
});

// features/three-phase-projection/spec.md ACs 10-13.
describe("three-phase-projection mapper", () => {
  // 3PP-AC10: blank means absent, "0" means zero — a `||`-style falsy check would treat "0" as
  // absent too and silently drop the decumulator persona.
  it("3PP-AC10 — blank means absent, '0' means zero", () => {
    const blank = buildProjectionInput(makeForm({ contributionsStopYear: "" }));
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.value.contributionsStopYear).toBeUndefined();

    const zero = buildProjectionInput(makeForm({ contributionsStopYear: "0" }));
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.value.contributionsStopYear).toBe(0);

    const five = buildProjectionInput(
      makeForm({ contributionsStopYear: "5", drawdownStartYear: "" })
    );
    expect(five.ok).toBe(true);
    if (five.ok) {
      expect(five.value.contributionsStopYear).toBe(5);
      // The mapper never fills in the engine's own default (Constitution §2) — the built input
      // must carry `undefined` through, not a pre-computed "= contributionsStopYear" value.
      expect(five.value.drawdownStartYear).toBeUndefined();
    }
  });

  // 3PP-AC11: phase fields validate without coercion — no field silently becomes 0 or NaN.
  it("3PP-AC11 — phase fields validate without coercion", () => {
    for (const bad of ["abc", "-1", "2.5", "60"]) {
      const result = buildProjectionInput(makeForm({ contributionsStopYear: bad }));
      expect(result.ok, `contributionsStopYear="${bad}" should be rejected`).toBe(false);
      if (!result.ok) {
        expect(result.errors.contributionsStopYear).toBeTruthy();
      }
    }
  });

  // 3PP-AC12: the engine's cross-field ProjectionInputError surfaces verbatim through
  // runProjection, not caught/reworded by the mapper (Constitution §2).
  it("3PP-AC12 — the cross-field error surfaces verbatim", () => {
    const result = runProjection(
      makeForm({ contributionsStopYear: "5", drawdownStartYear: "3" })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^ProjectionInputError: /);
    expect(result.errors[0]).toContain("contributionsStopYear");
    expect(result.errors[0]).toContain("drawdownStartYear");
  });

  // 3PP-AC13: formatPhase is the only place a phase label is formatted — no ".tsx" string mapping.
  it("3PP-AC13 — formatPhase labels the three phases", () => {
    expect(formatPhase("accumulate")).toBe("Accumulate");
    expect(formatPhase("coast")).toBe("Coast");
    expect(formatPhase("draw")).toBe("Draw");
  });
});

// features/inflation-real-terms/spec.md ACs 9-12. Every occurrence of "/(1+i)" (the deflator
// itself) lives in lib/projection.ts's toRealTerms — this module only ever does a single `/100`
// percent->decimal conversion for the rate, same convention as every other percent field here
// (Constitution §2, Coder Guardrails).
describe("inflation-real-terms mapper", () => {
  // AC9: showRealTerms off means the field is never parsed at all — not even a syntax check —
  // and the value is kept (spec.md R6 "value kept and not parsed"), so "abc" cannot surface here.
  describe("AC9 — parseInflationRate(form)", () => {
    it("showRealTerms: false returns {ok:true, value:undefined} even for an invalid rate string", () => {
      const result = parseInflationRate(makeForm({ showRealTerms: false, inflationRatePercent: "abc" }));
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it('showRealTerms: true, "3" -> 0.03', () => {
      const result = parseInflationRate(makeForm({ showRealTerms: true, inflationRatePercent: "3" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeCloseTo(0.03, 10);
    });

    it('showRealTerms: true, "0" -> 0, never omitted or coerced from something else', () => {
      const result = parseInflationRate(makeForm({ showRealTerms: true, inflationRatePercent: "0" }));
      expect(result).toEqual({ ok: true, value: 0 });
    });

    it('showRealTerms: true, "" -> a field error naming the field as required (invariant 14)', () => {
      const result = parseInflationRate(makeForm({ showRealTerms: true, inflationRatePercent: "" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("Inflation rate (%) is required");
    });

    it('showRealTerms: true, "abc" -> a field error, never coerced to 0', () => {
      const result = parseInflationRate(makeForm({ showRealTerms: true, inflationRatePercent: "abc" }));
      expect(result.ok).toBe(false);
    });

    it('showRealTerms: true, " " -> a field error, never coerced to 0', () => {
      const result = parseInflationRate(makeForm({ showRealTerms: true, inflationRatePercent: " " }));
      expect(result.ok).toBe(false);
    });
  });

  // AC10: the field error surfaces through buildProjectionInput's own errors bag, but the parsed
  // rate is never written into the returned ProjectionInput — R1's "inflation is not a
  // ProjectionInput" holds even though this mapper does validate the field.
  describe("AC10 — buildProjectionInput surfaces the field error, never the value", () => {
    it("toggle on with an invalid rate returns ok:false naming inflationRatePercent", () => {
      const result = buildProjectionInput(
        makeForm({ showRealTerms: true, inflationRatePercent: "abc" })
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.inflationRatePercent).toBeTruthy();
    });

    it("toggle off with the same invalid rate returns ok:true — the field is not parsed", () => {
      const result = buildProjectionInput(
        makeForm({ showRealTerms: false, inflationRatePercent: "abc" })
      );
      expect(result.ok).toBe(true);
    });

    it("on success, 'inflationRate' is never a key of the built ProjectionInput", () => {
      const result = buildProjectionInput(
        makeForm({ showRealTerms: true, inflationRatePercent: "3" })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("inflationRate" in result.value).toBe(false);
    });
  });

  // AC11: one project() call, two views — runProjection's nominal `value` never depends on the
  // toggle, only whether `real` is populated alongside it does.
  it("AC11 — runProjection returns one projection, two views", () => {
    const on = runProjection(makeForm({ showRealTerms: true, inflationRatePercent: "3" }));
    const off = runProjection(makeForm({ showRealTerms: false, inflationRatePercent: "3" }));

    expect(on.ok).toBe(true);
    expect(off.ok).toBe(true);
    if (!on.ok || !off.ok) return;

    expect(on.real).toBeDefined();
    if (!on.real) return;
    expect(on.real.inflationRate).toBeCloseTo(0.03, 10);
    expect(on.real.rows.length).toBe(on.value.rows.length);
    expect(on.value).toEqual(off.value);
    expect(off.real).toBeUndefined();
  });

  // AC12: toRealTerms' own ProjectionInputError (rate domain) surfaces through runProjection
  // exactly like project()'s errors do (AC9 above in this file) — not caught and reworded.
  it("AC12 — the engine error surfaces verbatim, naming inflationRate", () => {
    const result = runProjection(
      makeForm({ showRealTerms: true, inflationRatePercent: "150" })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^ProjectionInputError: /);
    expect(result.errors[0]).toContain("inflationRate");
  });
});
