"use client";

import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartNoAxesCombined } from "lucide-react";
import { getFund } from "@/lib/funds";
import type { ProjectionRow } from "@/lib/projection";
import type { Wrapper } from "@/lib/nzTax";
import {
  buildProjectionInput,
  runProjection,
  seedAssumptionsFromFund,
  formatNzd,
  type ProjectionFormState,
} from "@/components/projectionInputs";
// Using HTML table elements with Tailwind styling instead of shadcn/ui table components

// Every number this component shows comes from `project()` (lib/projection.ts) via
// `runProjection` — this file performs no projection, fee or tax arithmetic of its own
// (Constitution §2). `sharePriceGrowth`/`dividendYield` are seeded once from SCHD
// (lib/funds.ts) and are then user-editable, same as every other assumption.
function buildDefaultFormState(): ProjectionFormState {
  const seed = seedAssumptionsFromFund(getFund("SCHD"));
  return {
    initialCapital: "100000",
    termYears: "15",
    extraMonthlyContribution: "0",
    // .toFixed(2) is display formatting only, not a projection/tax calculation.
    sharePriceGrowthPercent: seed.ok ? seed.sharePriceGrowthPercent.toFixed(2) : "",
    dividendYieldPercent: seed.ok ? seed.dividendYieldPercent.toFixed(2) : "",
    dividendGrowthPercent: "0",
    wrapper: "direct",
    pirPercent: "28",
    marginalRatePercent: "33",
    usWithholdingPercent: "15",
    platformFeePercent: "0",
    brokeragePerContribution: "0",
    fxSpreadPercent: "0",
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}

// AC12 (nz-tax.md non-negotiable 4): discloses regime, method and threshold per year. "$50k" is
// display text for the engine's default fifThresholdNzd (this UI never overrides it) — not a
// re-derived tax figure.
function formatRegimeCell(row: ProjectionRow): string {
  if (row.taxRegime === "fif") {
    return `FIF · ${row.taxMethod.toUpperCase()} · above $50k`;
  }
  return "Dividend · below";
}

const InvestmentProjectionCalculator = () => {
  const [form, setForm] = useState<ProjectionFormState>(buildDefaultFormState);
  const schdSeed = useMemo(() => seedAssumptionsFromFund(getFund("SCHD")), []);

  const handleFieldChange = (field: keyof ProjectionFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleWrapperChange = (value: string) => {
    if (value === "pie" || value === "direct") {
      setForm((prev) => ({ ...prev, wrapper: value as Wrapper }));
    }
  };

  // Field-level validation (AC10) is checked separately from the engine call (AC9) so a bad
  // field shows its own inline message even when the engine is never reached.
  const fieldCheck = useMemo(() => buildProjectionInput(form), [form]);
  const projection = useMemo(() => runProjection(form), [form]);
  const fieldErrors = fieldCheck.ok ? {} : fieldCheck.errors;

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-100 to-indigo-100">
      <div className="max-w-6xl mx-auto p-6 space-y-10">
        <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-lg">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg">
            <CardTitle className="text-lg md:text-2xl font-thin flex items-center gap-2">
              <ChartNoAxesCombined /> Portfolio Projection Calculator
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-6">
              This calculator no longer has an &quot;Expected Return&quot;, &quot;Expense
              Ratio&quot; or &quot;Tax Rate on Dividends&quot; field. Tax now follows New
              Zealand&apos;s FIF/FDR rules on portfolio value (or actual dividends below the
              $50k threshold), not a flat rate on dividends — results differ materially from the
              previous version of this page.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <div className="space-y-2">
                <Label htmlFor="initialCapital" className="text-slate-700 font-medium">
                  Initial Capital (NZD)
                </Label>
                <Input
                  id="initialCapital"
                  type="text"
                  inputMode="decimal"
                  value={form.initialCapital}
                  onChange={(e) => handleFieldChange("initialCapital", e.target.value)}
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
                <FieldError message={fieldErrors.initialCapital} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="termYears" className="text-slate-700 font-medium">
                  Investment Term (years)
                </Label>
                <Input
                  id="termYears"
                  type="text"
                  inputMode="numeric"
                  value={form.termYears}
                  onChange={(e) => handleFieldChange("termYears", e.target.value)}
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
                <FieldError message={fieldErrors.termYears} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="extraMonthlyContribution" className="text-slate-700 font-medium">
                  Extra Monthly Contribution (NZD)
                </Label>
                <Input
                  id="extraMonthlyContribution"
                  type="text"
                  inputMode="decimal"
                  value={form.extraMonthlyContribution}
                  onChange={(e) => handleFieldChange("extraMonthlyContribution", e.target.value)}
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
                <FieldError message={fieldErrors.extraMonthlyContribution} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sharePriceGrowthPercent" className="text-slate-700 font-medium">
                  Share price growth (% p.a., price only)
                </Label>
                <Input
                  id="sharePriceGrowthPercent"
                  type="text"
                  inputMode="decimal"
                  value={form.sharePriceGrowthPercent}
                  onChange={(e) => handleFieldChange("sharePriceGrowthPercent", e.target.value)}
                  className="border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                />
                <FieldError message={fieldErrors.sharePriceGrowthPercent} />
                {schdSeed.ok ? (
                  <p className="text-xs text-slate-500">
                    Seeded from SCHD, as of {schdSeed.asOf} —{" "}
                    <a href={schdSeed.source} className="underline" target="_blank" rel="noreferrer">
                      source
                    </a>
                  </p>
                ) : (
                  <p className="text-xs text-red-600">{schdSeed.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dividendYieldPercent" className="text-slate-700 font-medium">
                  Dividend yield (% at start)
                </Label>
                <Input
                  id="dividendYieldPercent"
                  type="text"
                  inputMode="decimal"
                  value={form.dividendYieldPercent}
                  onChange={(e) => handleFieldChange("dividendYieldPercent", e.target.value)}
                  className="border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                />
                <FieldError message={fieldErrors.dividendYieldPercent} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dividendGrowthPercent" className="text-slate-700 font-medium">
                  Dividend growth (% p.a., per share)
                </Label>
                <Input
                  id="dividendGrowthPercent"
                  type="text"
                  inputMode="decimal"
                  value={form.dividendGrowthPercent}
                  onChange={(e) => handleFieldChange("dividendGrowthPercent", e.target.value)}
                  className="border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                />
                <FieldError message={fieldErrors.dividendGrowthPercent} />
                <p className="text-xs text-slate-500">
                  No fund publishes a multi-year per-share dividend CAGR — 0 is a stated
                  assumption, not a sourced figure.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wrapper" className="text-slate-700 font-medium">
                  Wrapper
                </Label>
                <Select value={form.wrapper} onValueChange={handleWrapperChange}>
                  <SelectTrigger id="wrapper" className="w-full border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct">US ETF (direct)</SelectItem>
                    <SelectItem value="pie">NZ PIE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.wrapper === "pie" && (
                <div className="space-y-2">
                  <Label htmlFor="pirPercent" className="text-slate-700 font-medium">
                    PIR (%)
                  </Label>
                  <Input
                    id="pirPercent"
                    type="text"
                    inputMode="decimal"
                    value={form.pirPercent}
                    onChange={(e) => handleFieldChange("pirPercent", e.target.value)}
                    className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                  <FieldError message={fieldErrors.pirPercent} />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="marginalRatePercent" className="text-slate-700 font-medium">
                  Marginal tax rate (%)
                </Label>
                <Input
                  id="marginalRatePercent"
                  type="text"
                  inputMode="decimal"
                  value={form.marginalRatePercent}
                  onChange={(e) => handleFieldChange("marginalRatePercent", e.target.value)}
                  className="border-slate-300 focus:border-red-500 focus:ring-red-500"
                />
                <FieldError message={fieldErrors.marginalRatePercent} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="usWithholdingPercent" className="text-slate-700 font-medium">
                  US withholding (%)
                </Label>
                <Input
                  id="usWithholdingPercent"
                  type="text"
                  inputMode="decimal"
                  value={form.usWithholdingPercent}
                  onChange={(e) => handleFieldChange("usWithholdingPercent", e.target.value)}
                  className="border-slate-300 focus:border-red-500 focus:ring-red-500"
                />
                <FieldError message={fieldErrors.usWithholdingPercent} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="platformFeePercent" className="text-slate-700 font-medium">
                  Platform fee (% p.a.)
                </Label>
                <Input
                  id="platformFeePercent"
                  type="text"
                  inputMode="decimal"
                  value={form.platformFeePercent}
                  onChange={(e) => handleFieldChange("platformFeePercent", e.target.value)}
                  className="border-slate-300 focus:border-red-500 focus:ring-red-500"
                />
                <FieldError message={fieldErrors.platformFeePercent} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="brokeragePerContribution" className="text-slate-700 font-medium">
                  Brokerage per contribution (NZD)
                </Label>
                <Input
                  id="brokeragePerContribution"
                  type="text"
                  inputMode="decimal"
                  value={form.brokeragePerContribution}
                  onChange={(e) => handleFieldChange("brokeragePerContribution", e.target.value)}
                  className="border-slate-300 focus:border-red-500 focus:ring-red-500"
                />
                <FieldError message={fieldErrors.brokeragePerContribution} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fxSpreadPercent" className="text-slate-700 font-medium">
                  FX spread (%)
                </Label>
                <Input
                  id="fxSpreadPercent"
                  type="text"
                  inputMode="decimal"
                  value={form.fxSpreadPercent}
                  onChange={(e) => handleFieldChange("fxSpreadPercent", e.target.value)}
                  className="border-slate-300 focus:border-red-500 focus:ring-red-500"
                />
                <FieldError message={fieldErrors.fxSpreadPercent} />
              </div>
            </div>

            {!projection.ok && (
              <Card className="bg-red-50 border-red-200">
                <CardContent className="p-6">
                  <p className="font-semibold text-red-700 mb-2">
                    {fieldCheck.ok
                      ? "Projection could not run:"
                      : "Fix the highlighted inputs to see a projection"}
                  </p>
                  {fieldCheck.ok && (
                    <ul className="list-disc list-inside text-red-700 text-sm">
                      {projection.errors.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Summary Card */}
            {projection.ok && (
              <Card className="bg-gradient-to-b from-indigo-100 to-pink-50 border-indigo-100 shadow-inner">
                <CardContent className="p-6">
                  <div className="flex flex-wrap justify-between gap-6">
                    <div className="text-center space-y-4">
                      <p className="text-sm text-slate-600 font-medium mb-1">
                        Final Portfolio Value
                      </p>
                      <p className="text-3xl font-bold text-blue-700">
                        {formatNzd(projection.value.finalValueNzd)}
                      </p>
                    </div>
                    <div className="text-center space-y-4">
                      <p className="text-sm text-slate-600 font-medium mb-1">
                        Final-Year Gross Dividends
                      </p>
                      <p className="text-3xl font-bold text-blue-700">
                        {formatNzd(
                          projection.value.rows[projection.value.rows.length - 1].grossDividendsNzd
                        )}
                      </p>
                    </div>
                    <div className="text-center space-y-4">
                      <p className="text-sm text-slate-600 font-medium mb-1">Total Tax</p>
                      <p className="text-3xl font-bold text-blue-700">
                        {formatNzd(projection.value.totalTaxNzd)}
                      </p>
                    </div>
                    <div className="text-center space-y-4">
                      <p className="text-sm text-slate-600 font-medium mb-1">Net Gain</p>
                      <p className="text-3xl font-bold text-blue-700">
                        {formatNzd(projection.value.netGainNzd)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>

        {/* Projection Table */}
        {projection.ok && (
          <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-lg">
            <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-t-lg">
              <CardTitle className="text-lg md:text-2xl font-thin">
                Year-by-Year Projection
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-4">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left p-3 font-semibold text-slate-700">Year</th>
                      <th className="text-left p-3 font-semibold text-slate-700">Start Balance</th>
                      <th className="text-left p-3 font-semibold text-blue-700">Contributions</th>
                      <th className="text-left p-3 font-semibold text-emerald-700">
                        Gross Dividends
                      </th>
                      <th className="text-left p-3 font-semibold text-red-700">US WHT</th>
                      <th className="text-left p-3 font-semibold text-red-700">Fees</th>
                      <th className="text-left p-3 font-semibold text-slate-700">Regime</th>
                      <th className="text-left p-3 font-semibold text-slate-700">
                        Taxable Income
                      </th>
                      <th className="text-left p-3 font-semibold text-red-700">NZ Tax</th>
                      <th className="text-left p-3 font-semibold text-slate-700">End Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.value.rows.map((row, index) => (
                      <tr
                        key={row.year}
                        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                          index % 2 === 0 ? "bg-white" : "bg-slate-25"
                        }`}
                      >
                        <td className="p-3 font-semibold text-slate-800">{row.year}</td>
                        <td className="p-3 text-slate-600">{formatNzd(row.openingValueNzd)}</td>
                        <td className="p-3 text-blue-600 font-medium">
                          {formatNzd(row.contributionsGrossNzd)}
                        </td>
                        <td className="p-3 text-emerald-600 font-medium">
                          {formatNzd(row.grossDividendsNzd)}
                        </td>
                        <td className="p-3 text-red-600 font-medium">
                          {formatNzd(row.usWithholdingNzd)}
                        </td>
                        <td className="p-3 text-red-600 font-medium">
                          {formatNzd(row.totalFeesNzd)}
                        </td>
                        <td className="p-3 text-slate-600 text-sm">{formatRegimeCell(row)}</td>
                        <td className="p-3 text-slate-600">
                          {formatNzd(row.taxableIncomeNzd)}
                        </td>
                        <td className="p-3 text-red-600 font-medium">
                          {formatNzd(row.nzTaxPayableNzd)}
                        </td>
                        <td className="p-3 font-bold text-slate-800 bg-slate-100">
                          {formatNzd(row.closingValueAfterTaxNzd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default InvestmentProjectionCalculator;
