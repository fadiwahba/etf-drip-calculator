import { describe, it, expect } from "vitest";
import {
  parseNumericField,
  parseInflationRate,
  parseTargetIncome,
  buildProjectionInput,
  seedAssumptionsFromFund,
  runProjection,
  formatEngineError,
  formatNzd,
  formatPhase,
  formatTaxModeExplainer,
  formatRegimeCell,
  applyFieldChange,
  dividendGrowthHelperText,
  formatFinalEffectiveYield,
  type ProjectionFormState,
} from "@/components/projectionInputs";
import { getFund, MissingAssumptionError, type Fund } from "@/lib/funds";

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
    // features/sourced-dividend-growth/spec.md Coder Guardrails: added here mirroring the
    // showRealTerms/targetAnnualIncome disclosures above -- dividendGrowthPercent "0" stays 0, so
    // no pre-existing AC's behaviour changes.
    dividendGrowthLinked: true,
    taxMode: "direct",
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
    // features/crossover-target-income/spec.md AC17: "80000" matches the UI's own default (a
    // stated placeholder, not a recommendation) — disclosed here per Coder Guardrails, same
    // pattern as showRealTerms/inflationRatePercent above.
    targetAnnualIncome: "80000",
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
    const result = buildProjectionInput(makeForm({ taxMode: "pie", pirPercent: "10.5" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.growthBasis).toBe("net-of-expense-ratio");
    expect(result.value.expenseRatioAnnual).toBe(0);
  });
});

describe("AC6 — wrapper passthrough", () => {
  it("wrapper 'pie' yields pir as a decimal and keeps marginalRate present", () => {
    const result = buildProjectionInput(makeForm({ taxMode: "pie", pirPercent: "28" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.wrapper).toBe("pie");
    expect(result.value.pir).toBeCloseTo(0.28, 10);
    expect(result.value.marginalRate).toBeCloseTo(0.33, 10);
  });

  it("wrapper 'direct' yields pir undefined, never 0", () => {
    const result = buildProjectionInput(makeForm({ taxMode: "direct" }));
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
    const result = runProjection(makeForm({ taxMode: "pie", pirPercent: "" }));
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

// features/crossover-target-income/spec.md ACs 13-16. Every deflator/income calculation lives in
// lib/projection.ts's findIncomeCrossover — this module only ever parses the raw target string and
// decides whether to call it (Constitution §2, Coder Guardrails "no income or deflator arithmetic
// in ... projectionInputs.ts").
describe("crossover-target-income mapper", () => {
  describe("AC13 — parseTargetIncome(form)", () => {
    it('"" -> {ok:true, value: undefined} (blank must not hide the whole table)', () => {
      const result = parseTargetIncome(makeForm({ targetAnnualIncome: "" }));
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it('"   " -> {ok:true, value: undefined}', () => {
      const result = parseTargetIncome(makeForm({ targetAnnualIncome: "   " }));
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it('"0" -> 0, a legitimate target distinct from blank (invariant 14)', () => {
      const result = parseTargetIncome(makeForm({ targetAnnualIncome: "0" }));
      expect(result).toEqual({ ok: true, value: 0 });
    });

    it('"80000" -> 80000', () => {
      const result = parseTargetIncome(makeForm({ targetAnnualIncome: "80000" }));
      expect(result).toEqual({ ok: true, value: 80000 });
    });

    it('"abc" -> a field error naming Target annual income', () => {
      const result = parseTargetIncome(makeForm({ targetAnnualIncome: "abc" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("Target annual income");
    });

    it('"-1" -> a field error naming Target annual income', () => {
      const result = parseTargetIncome(makeForm({ targetAnnualIncome: "-1" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("Target annual income");
    });
  });

  describe("AC14 — buildProjectionInput", () => {
    it('targetAnnualIncome "abc" -> ok:false naming targetAnnualIncome', () => {
      const result = buildProjectionInput(makeForm({ targetAnnualIncome: "abc" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.targetAnnualIncome).toBeTruthy();
    });

    it("blank -> ok:true", () => {
      const result = buildProjectionInput(makeForm({ targetAnnualIncome: "" }));
      expect(result.ok).toBe(true);
    });

    it('on success, "targetAnnualIncomeNzd" is never a key of the built ProjectionInput (same reasoning as inflationRate)', () => {
      const result = buildProjectionInput(makeForm({ targetAnnualIncome: "80000" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("targetAnnualIncomeNzd" in result.value).toBe(false);
    });
  });

  describe("AC15 — runProjection wiring", () => {
    it("toggle on, target '3800' -> crossover defined and consistent with real", () => {
      const result = runProjection(makeForm({ showRealTerms: true, targetAnnualIncome: "3800" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.crossover).toBeDefined();
      if (!result.crossover || !result.real) return;
      expect(result.crossover.inflationRate).toBe(result.real.inflationRate);
      expect(result.crossover.netIncomeByYearNzd.length).toBe(result.value.rows.length);
    });

    it("toggle off -> crossover undefined (C3, a nominal answer to a real question is wrong)", () => {
      const result = runProjection(makeForm({ showRealTerms: false, targetAnnualIncome: "3800" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.crossover).toBeUndefined();
    });

    it("toggle on, target blank -> crossover undefined, real still defined, ok:true", () => {
      const result = runProjection(makeForm({ showRealTerms: true, targetAnnualIncome: "" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.crossover).toBeUndefined();
      expect(result.real).toBeDefined();
    });
  });

  it("AC16 — one projection: a target changes no projection output, no second project() call", () => {
    const withTarget = runProjection(makeForm({ showRealTerms: true, targetAnnualIncome: "3800" }));
    const withoutTarget = runProjection(makeForm({ showRealTerms: true, targetAnnualIncome: "" }));
    expect(withTarget.ok).toBe(true);
    expect(withoutTarget.ok).toBe(true);
    if (!withTarget.ok || !withoutTarget.ok) return;
    expect(withTarget.value).toEqual(withoutTarget.value);
  });
});

// features/tax-mode-compare/spec.md ACs 12-15. `makeForm()`'s own defaults (100k / 15y / SCHD seed
// 9.12%/3.25% / direct / 33% / PIR 28% / WHT 15% / inflation 3%) are the spec's "UI-default form"
// verbatim — reused directly rather than duplicated.
describe("tax-mode-compare mapper", () => {
  describe("AC12 — taxMode replaces wrapper", () => {
    it("'pie' -> wrapper 'pie' + decimal pir", () => {
      const result = buildProjectionInput(makeForm({ taxMode: "pie", pirPercent: "28" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.wrapper).toBe("pie");
      expect(result.value.pir).toBeCloseTo(0.28, 10);
    });

    it("'direct' -> wrapper 'direct', pir undefined", () => {
      const result = buildProjectionInput(makeForm({ taxMode: "direct", pirPercent: "28" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.wrapper).toBe("direct");
      expect(result.value.pir).toBeUndefined();
    });

    it("'compare' -> wrapper 'direct' (base run) with pir still parsed ('28' -> 0.28)", () => {
      const result = buildProjectionInput(makeForm({ taxMode: "compare", pirPercent: "28" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.wrapper).toBe("direct");
      expect(result.value.pir).toBeCloseTo(0.28, 10);
    });

    it("'taxMode' is never a key of the built ProjectionInput", () => {
      const result = buildProjectionInput(makeForm());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("taxMode" in result.value).toBe(false);
    });
  });

  describe("AC13 — runProjection", () => {
    it("'compare' -> comparison defined, comparison.direct equals value, no third project() call", () => {
      const result = runProjection(makeForm({ taxMode: "compare" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.comparison).toBeDefined();
      if (!result.comparison) return;
      expect(result.comparison.direct).toEqual(result.value);
      expect(result.comparison.years.length).toBe(result.value.rows.length);
    });

    it("'pie'/'direct' -> comparison undefined", () => {
      const pie = runProjection(makeForm({ taxMode: "pie" }));
      const direct = runProjection(makeForm({ taxMode: "direct" }));
      expect(pie.ok).toBe(true);
      expect(direct.ok).toBe(true);
      if (!pie.ok || !direct.ok) return;
      expect(pie.comparison).toBeUndefined();
      expect(direct.comparison).toBeUndefined();
    });

    it("'compare' with pirPercent '' -> ok:false carrying the unwrapped TaxInputError", () => {
      const result = runProjection(makeForm({ taxMode: "compare", pirPercent: "" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/^TaxInputError: /);
      expect(result.errors[0]).toContain('pir is required when wrapper is "pie"');
    });
  });

  // features/pie-de-minimis-wrapper-aware/spec.md AC11(a): no UI text may claim a de minimis
  // outcome a PIE never got.
  describe("AC11(a) — a sub-$50k PIE's explainer never claims a de minimis outcome", () => {
    it("a sub-$50k PIE run states FIF-from-first-dollar, not 'above'/'below the $50,000 de minimis'", () => {
      const form = makeForm({ taxMode: "pie", initialCapital: "30000", pirPercent: "28" });
      const run = runProjection(form);
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.value.rows[1].taxRegime).toBe("fif"); // sanity: this run is the sub-$50k PIE case
      expect(run.value.rows[1].aboveThreshold).toBe(false);

      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).not.toContain("above the $50,000 de minimis");
      expect(explainer).not.toContain("below the $50,000 de minimis");
      expect(explainer).toContain("FIF applies from the first dollar");
      expect(explainer).toContain("direct-holding rule");
      expect(explainer).toContain("NZ PIE");
      expect(explainer).toContain("PIR 28.0%");
    });

    it("the 'direct' explainer line keeps its existing wording unchanged", () => {
      // Same assertions as the pre-existing "UI-default form ('direct')" test below — pinned again
      // here, right beside the PIE case above, so a change to the direct branch cannot pass
      // unnoticed alongside the PIE-only fix.
      const form = makeForm();
      const run = runProjection(form);
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain("above");
      expect(explainer).toContain("$50,000");
      expect(explainer).toContain("de minimis");
    });
  });

  // features/pie-de-minimis-wrapper-aware/spec.md AC11(b): a row with taxRegime "fif" and
  // aboveThreshold false (only reachable by a sub-$50k PIE, since a direct row only ever reaches
  // "fif" by crossing the threshold) must not render "above $50k".
  describe("AC11(b) — formatRegimeCell never renders 'above $50k' for a row that isn't", () => {
    it("fif + aboveThreshold false (sub-$50k PIE) omits the threshold claim", () => {
      const cell = formatRegimeCell({ taxRegime: "fif", taxMethod: "fdr", aboveThreshold: false });
      expect(cell).not.toContain("above $50k");
      expect(cell).toBe("FIF · FDR");
    });

    it("fif + aboveThreshold true renders exactly the pre-existing string (regression pin)", () => {
      const cell = formatRegimeCell({ taxRegime: "fif", taxMethod: "fdr", aboveThreshold: true });
      expect(cell).toBe("FIF · FDR · above $50k");
    });

    it("dividend rows keep their exact current string, whatever aboveThreshold is (regression pin)", () => {
      expect(
        formatRegimeCell({ taxRegime: "dividend", taxMethod: "actual-dividends", aboveThreshold: false })
      ).toBe("Dividend · below");
    });
  });

  describe("AC14 — formatTaxModeExplainer, single modes", () => {
    it("UI-default form ('direct')", () => {
      const form = makeForm();
      const run = runProjection(form);
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain("US ETFs (direct)");
      expect(explainer).toContain("marginal rate 33.0%");
      expect(explainer).toContain("Year 1");
      expect(explainer).toContain("FIF");
      expect(explainer).toContain("FDR");
      expect(explainer).toContain("above");
      expect(explainer).toContain("$50,000");
      expect(explainer).toContain("US withholding 15%");
    });

    it("'pie' + pirPercent '28' -> NZ PIE, PIR 28.0%, not marginal", () => {
      const form = makeForm({ taxMode: "pie", pirPercent: "28" });
      const run = runProjection(form);
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain("NZ PIE");
      expect(explainer).toContain("PIR 28.0%");
      expect(explainer).not.toContain("marginal");
    });

    it("'pie' + pirPercent '30' -> also capped at 28%", () => {
      const form = makeForm({ taxMode: "pie", pirPercent: "30" });
      const run = runProjection(form);
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain("capped at 28%");
    });

    it("initialCapital '40000' + extraMonthlyContribution '500' -> below, Dividend, actual dividends, first FIF year", () => {
      const form = makeForm({ initialCapital: "40000", extraMonthlyContribution: "500" });
      const run = runProjection(form);
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain("below");
      expect(explainer).toContain("Dividend");
      expect(explainer).toContain("actual dividends");
      expect(explainer).toContain("year 2");
    });

    it("run.ok === false -> a fixed line quoting no rate", () => {
      const form = makeForm({ sharePriceGrowthPercent: "150" });
      const run = runProjection(form);
      expect(run.ok).toBe(false);
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).not.toMatch(/%/);
      expect(explainer.length).toBeGreaterThan(0);
    });
  });

  describe("AC15 — formatTaxModeExplainer, compare mode", () => {
    it("contains both wrappers/rates, 'identical inputs', and a lead via formatNzd (UI-default, never flips)", () => {
      const form = makeForm({ taxMode: "compare" });
      const run = runProjection(form);
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain("NZ PIE");
      expect(explainer).toContain("US ETFs (direct)");
      expect(explainer).toContain("PIR 28.0%");
      expect(explainer).toContain("marginal rate 33.0%");
      expect(explainer).toContain("identical inputs");
      expect(explainer).toContain("never changes");
      expect(explainer).not.toMatch(/NaN|Infinity|undefined/);
    });

    it("names the flip year and the wrapper it flips to when the comparison flips", () => {
      // features/pie-de-minimis-wrapper-aware/spec.md made a PIE run FIF from the first dollar
      // (nz-tax.md "the de minimis is a DIRECT-HOLDING rule only") — a PIE's FDR drag is a flat
      // 5% x PIR-cap = 1.4% of value regardless of cost, from year 1. So with a low dividend yield
      // and a high marginal rate, DIRECT starts cheaper (its actual-dividend tax on a thin yield is
      // less than 1.4% of value), then loses the lead once its own cost basis crosses the $50k de
      // minimis and it switches to FDR at the 39% marginal rate (1.95% of value) — now above the
      // PIE's flat 1.4%. So the flip direction is direct -> pie, the opposite of what an
      // (incorrect) sub-$50k-PIE-escapes-FIF model would have produced. Verified against the real
      // (unmodified) runProjection() output on the corrected engine before being pinned here —
      // capital/yield/term were searched over, not guessed, specifically so this branch is
      // genuinely exercised rather than passing vacuously (see notes.md "Cycle 2").
      const form = makeForm({
        taxMode: "compare",
        initialCapital: "48000",
        extraMonthlyContribution: "0",
        dividendYieldPercent: "1.5",
        pirPercent: "28",
        marginalRatePercent: "39",
        usWithholdingPercent: "0",
        termYears: "12",
      });
      const run = runProjection(form);
      expect(run.ok).toBe(true);
      if (!run.ok || !run.comparison) return;
      expect(run.comparison.firstDecisiveWrapper).toBe("direct");
      expect(run.comparison.flipYear).toBe(6);
      expect(run.comparison.flipWrapper).toBe("pie");
      const explainer = formatTaxModeExplainer(form, run);
      // Pinned as one substring naming the flip wrapper right beside its year — a looser pair of
      // checks (year present + "NZ PIE" present anywhere) would pass even if the flip wrapper label
      // were swapped, since "NZ PIE" already appears earlier in the line as the wrapper's own rate
      // label.
      expect(explainer).toContain(`flips to NZ PIE in year ${run.comparison.flipYear}`);
      expect(explainer).not.toMatch(/NaN|Infinity|undefined/);
    });
  });

  // AC20 (explainer half): two mirrored makeForm runs rebuild lib's Fixture P and Fixture L (same
  // capital/growth/term/yield/WHT, only marginalRatePercent differs), where both the leader and the
  // amount change between runs — a swapped wrapper label would put the right amount beside the
  // wrong wrapper in either direction, which a bare toContain("US ETFs (direct)") could not detect
  // since that string also appears earlier in the line as the direct leg's own rate label.
  describe("AC20 — explainer labels pinned by number, not swapped (compare mode)", () => {
    const baseForm = {
      taxMode: "compare" as const,
      initialCapital: "100000",
      termYears: "3",
      sharePriceGrowthPercent: "10",
      dividendYieldPercent: "0",
      usWithholdingPercent: "0",
    };

    it("marginalRatePercent '39' -> NZ PIE leads by the exact amount (rebuilds Fixture P)", () => {
      const form = makeForm({ ...baseForm, marginalRatePercent: "39" });
      const run = runProjection(form);
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain(`NZ PIE leads by ${formatNzd(1_936.1645875)}`);
    });

    it("marginalRatePercent '17.5' -> US ETFs (direct) leads by the exact amount (rebuilds Fixture L)", () => {
      const form = makeForm({ ...baseForm, marginalRatePercent: "17.5" });
      const run = runProjection(form);
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      const explainer = formatTaxModeExplainer(form, run);
      expect(explainer).toContain(`US ETFs (direct) leads by ${formatNzd(1_866.5430328125)}`);
    });
  });
});

// features/sourced-dividend-growth/spec.md. Replaces the shipped `dividendGrowthPercent: "0"`
// default with constant yield (dividend growth = share price growth), a stated modelling
// convention (Constitution §6/§6a), never a re-derived per-fund CAGR (Out of Scope).
describe("sourced-dividend-growth mapper", () => {
  describe("SDG-AC1 — the seed carries constant yield (SCHD)", () => {
    it("dividendGrowthPercent is strictly === sharePriceGrowthPercent and toFixed(2) is '9.12'", () => {
      const seed = seedAssumptionsFromFund(getFund("SCHD"));
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;
      // Field-to-field equality (never `=== 9.12`, a float literal) per spec.md AC1.
      expect(seed.dividendGrowthPercent).toBe(seed.sharePriceGrowthPercent);
      expect(seed.dividendGrowthPercent.toFixed(2)).toBe("9.12");
      expect(seed.dividendGrowthPercent).not.toBe(0);
    });
  });

  describe("SDG-AC2 — unsourceable stays blank, never 0 (VYMI)", () => {
    it("dividendGrowthPercent is '' beside sharePriceGrowthPercent '', ok:false", () => {
      const seed = seedAssumptionsFromFund(getFund("VYMI"));
      expect(seed.ok).toBe(false);
      if (seed.ok) return;
      expect(seed.sharePriceGrowthPercent).toBe("");
      expect(seed.dividendGrowthPercent).toBe("");
      expect(Object.is(seed.dividendGrowthPercent, 0)).toBe(false);
    });
  });

  describe("SDG-AC3 — the seed ignores fund.dividendGrowth", () => {
    it("a Fund literal with sharePriceGrowth 0.07 and dividendGrowth 0.05 seeds 7.00, not 5.00", () => {
      const fund: Fund = {
        ticker: "TEST",
        name: "Test Fund",
        domicile: "US",
        currency: "USD",
        asOf: "2026-01-01",
        source: "https://example.com",
        expenseRatio: 0.001,
        totalReturnAnnualised: 0.09,
        totalReturnWindowYears: 10,
        dividendYield: 0.02,
        dividendGrowth: 0.05,
        notes: null,
        sharePriceGrowth: 0.07,
      };
      const seed = seedAssumptionsFromFund(fund);
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;
      expect(seed.dividendGrowthPercent.toFixed(2)).toBe("7.00");
    });
  });

  describe("SDG-AC4 — a linked edit to share price growth carries", () => {
    it("carries the new value onto dividendGrowthPercent, keeps dividendGrowthLinked true, returns a new object", () => {
      const form = makeForm({
        sharePriceGrowthPercent: "9.12",
        dividendGrowthPercent: "9.12",
        dividendGrowthLinked: true,
      });
      const next = applyFieldChange(form, "sharePriceGrowthPercent", "5");
      expect(next.sharePriceGrowthPercent).toBe("5");
      // "5", never a value that happens to equal 9.12 (Coder Guardrails mutation-resistance note).
      expect(next.dividendGrowthPercent).toBe("5");
      expect(next.dividendGrowthLinked).toBe(true);
      expect(next).not.toBe(form);
      // The input form itself must not be mutated.
      expect(form.sharePriceGrowthPercent).toBe("9.12");
      expect(form.dividendGrowthPercent).toBe("9.12");
    });
  });

  describe("SDG-AC5 — the first dividend-growth edit breaks the link permanently, a typed 0 survives", () => {
    const linkedForm = makeForm({
      sharePriceGrowthPercent: "9.12",
      dividendGrowthPercent: "9.12",
      dividendGrowthLinked: true,
    });

    it("(a) editing dividendGrowthPercent to '0' unlinks", () => {
      const next = applyFieldChange(linkedForm, "dividendGrowthPercent", "0");
      expect(next.dividendGrowthPercent).toBe("0");
      expect(next.dividendGrowthLinked).toBe(false);
    });

    it("(b) a later share-price edit leaves the typed 0 alone -- not '5', not '9.12', not ''", () => {
      const unlinked = applyFieldChange(linkedForm, "dividendGrowthPercent", "0");
      const after = applyFieldChange(unlinked, "sharePriceGrowthPercent", "5");
      expect(after.dividendGrowthPercent).toBe("0");
      expect(after.dividendGrowthPercent).not.toBe("5");
      expect(after.dividendGrowthPercent).not.toBe("9.12");
      expect(after.dividendGrowthPercent).not.toBe("");
    });

    it("(c) buildProjectionInput of (b)'s form gives dividendGrowth 0 and sharePriceGrowth 0.05 -- a typed zero reaches the engine as zero", () => {
      const unlinked = applyFieldChange(linkedForm, "dividendGrowthPercent", "0");
      const after = applyFieldChange(unlinked, "sharePriceGrowthPercent", "5");
      const result = buildProjectionInput(after);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dividendGrowth).toBe(0);
      expect(result.value.sharePriceGrowth).toBeCloseTo(0.05, 10);
    });
  });

  describe("SDG-AC6 — unrelated edits touch nothing else", () => {
    it("editing initialCapital changes only initialCapital", () => {
      const form = makeForm({
        sharePriceGrowthPercent: "9.12",
        dividendGrowthPercent: "9.12",
        dividendGrowthLinked: true,
      });
      const next = applyFieldChange(form, "initialCapital", "250000");
      expect(next.initialCapital).toBe("250000");
      expect(next.dividendGrowthPercent).toBe("9.12");
      expect(next.sharePriceGrowthPercent).toBe("9.12");
      expect(next.dividendGrowthLinked).toBe(true);
    });
  });

  describe("SDG-AC7 — the label names the convention, per state", () => {
    it("linked", () => {
      const form = makeForm({ dividendGrowthLinked: true });
      expect(dividendGrowthHelperText(form)).toBe(
        "Tracks share price growth — constant yield. A stated modelling convention, not a sourced figure. Edit it to set your own."
      );
    });

    it("unlinked", () => {
      const form = makeForm({ dividendGrowthLinked: false });
      expect(dividendGrowthHelperText(form)).toBe(
        "Your own figure — no longer tracking share price growth, so the constant-yield convention no longer holds."
      );
    });

    // Neither string claims a source (spec.md AC7) -- the linked string's own "not a sourced
    // figure" is a disclaimer, not a claim, so this checks for the deleted "No fund publishes..."
    // sentence and a bare source citation, not the substring "source" itself.
    it("the deleted 'No fund publishes a multi-year per-share dividend CAGR' sentence is gone", () => {
      expect(dividendGrowthHelperText(makeForm({ dividendGrowthLinked: true }))).not.toMatch(
        /No fund publishes|CAGR/i
      );
      expect(dividendGrowthHelperText(makeForm({ dividendGrowthLinked: false }))).not.toMatch(
        /No fund publishes|CAGR/i
      );
    });
  });

  describe("SDG-AC8 — blank still errors; the flag never reaches the engine", () => {
    it("a blank dividendGrowthPercent still errors naming the field (invariant 14, pre-existing)", () => {
      const result = buildProjectionInput(makeForm({ dividendGrowthPercent: "" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.dividendGrowthPercent).toContain("Dividend growth (%)");
    });

    it("'dividendGrowthLinked' is never a key of the built ProjectionInput", () => {
      const result = buildProjectionInput(makeForm());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("dividendGrowthLinked" in result.value).toBe(false);
    });
  });

  // AC9's trigger scenario, the audit's headline reproduction case (also AC10's before/after table):
  // 100000 initial (makeForm default) · 30y · 1000/mo · 9.12% growth · 3.25% yield (makeForm
  // default) · direct (makeForm default) · 33% marginal (makeForm default) · 15% WHT (makeForm
  // default) · stop 15 · draw 16 · 3% inflation (makeForm default) · real terms on (makeForm
  // default) · target 60000.
  function triggerForm(dividendGrowthPercent: string) {
    return makeForm({
      termYears: "30",
      extraMonthlyContribution: "1000",
      dividendGrowthPercent,
      contributionsStopYear: "15",
      drawdownStartYear: "16",
      targetAnnualIncome: "60000",
    });
  }

  describe("SDG-AC9 — final-year effective yield", () => {
    it("(a) dividendGrowthPercent '9.12' -> '3.25%', raw ratio 0.0325 within 1e-12 (constant by construction)", () => {
      const run = runProjection(triggerForm("9.12"));
      expect(run.ok).toBe(true);
      if (!run.ok || !run.real) return;
      const last = run.real.rows[run.real.rows.length - 1];
      const rawRatio = last.dividendPerShareNzd / last.closingSharePriceNzd;
      expect(Math.abs(rawRatio - 0.0325)).toBeLessThan(1e-12);
      expect(formatFinalEffectiveYield(run.real)).toBe("3.25%");
    });

    it("(b) dividendGrowthPercent '0' -> '0.24%' (0.0325 / 1.0912^30 = 0.2370%)", () => {
      const run = runProjection(triggerForm("0"));
      expect(run.ok).toBe(true);
      if (!run.ok || !run.real) return;
      expect(formatFinalEffectiveYield(run.real)).toBe("0.24%");
    });

    it("(c) the string is identical for run.value and run.real -- both deflators cancel in the ratio", () => {
      const run = runProjection(triggerForm("9.12"));
      expect(run.ok).toBe(true);
      if (!run.ok || !run.real) return;
      expect(formatFinalEffectiveYield(run.value)).toBe(formatFinalEffectiveYield(run.real));
    });

    it("(d) empty rows, or a final row with closing price 0 or non-finite, returns '—', never NaN%", () => {
      expect(formatFinalEffectiveYield({ rows: [] })).toBe("—");

      const run = runProjection(triggerForm("9.12"));
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      const zeroPriceRows = run.value.rows.map((row, index, arr) =>
        index === arr.length - 1 ? { ...row, closingSharePriceNzd: 0 } : row
      );
      expect(formatFinalEffectiveYield({ rows: zeroPriceRows })).toBe("—");

      const infiniteRatioRows = run.value.rows.map((row, index, arr) =>
        index === arr.length - 1
          ? { ...row, closingSharePriceNzd: Number.POSITIVE_INFINITY }
          : row
      );
      expect(formatFinalEffectiveYield({ rows: infiniteRatioRows })).toBe("—");
      expect(formatFinalEffectiveYield({ rows: infiniteRatioRows })).not.toMatch(/NaN/);
    });
  });

  // AC10: before/after on the audit's trigger scenario, through runProjection end-to-end (not
  // lib/projection.ts directly) -- asserted from the engine's own output, ±$1 tolerance, per
  // spec.md. Reproduced independently against the unmodified engine before being pinned here (see
  // notes.md "Verify the numbers yourself") -- both columns and both AC9 yields matched exactly on
  // the first run, so no blocker was raised.
  describe("SDG-AC10 — before/after on the audit's trigger scenario", () => {
    it("dividendGrowthPercent '0' (old default): grossDividends 2204, drawn 38989, netIncome -11859, no crossover", () => {
      const run = runProjection(triggerForm("0"));
      expect(run.ok).toBe(true);
      if (!run.ok || !run.real || !run.crossover) return;
      const last = run.real.rows[run.real.rows.length - 1];
      expect(last.grossDividendsNzd).toBeCloseTo(2204, 0);
      expect(run.real.totalDividendsDrawnNzd).toBeCloseTo(38989, 0);
      expect(run.crossover.finalYearNetIncomeNzd).toBeCloseTo(-11859, 0);
      expect(run.crossover.crossoverYear).toBeNull();
    });

    it("dividendGrowthPercent '9.12' (new default): grossDividends 39241, drawn 366579, netIncome +20984, still no crossover", () => {
      const run = runProjection(triggerForm("9.12"));
      expect(run.ok).toBe(true);
      if (!run.ok || !run.real || !run.crossover) return;
      const last = run.real.rows[run.real.rows.length - 1];
      expect(last.grossDividendsNzd).toBeCloseTo(39241, 0);
      expect(run.real.totalDividendsDrawnNzd).toBeCloseTo(366579, 0);
      expect(run.crossover.finalYearNetIncomeNzd).toBeCloseTo(20984, 0);
      expect(run.crossover.crossoverYear).toBeNull();
    });
  });
});
