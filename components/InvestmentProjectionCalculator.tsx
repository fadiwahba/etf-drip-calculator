"use client";

import React, { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartNoAxesCombined } from "lucide-react";
// Using HTML table elements with Tailwind styling instead of shadcn/ui table components

const InvestmentProjectionCalculator = () => {
  // Default values based on your scenario
  const [inputs, setInputs] = useState({
    initialCapital: 100000,
    termYears: 15,
    returnRate: 18.0,
    dividendYield: 0.95,
    expenseRatio: 0.26,
    taxRate: 1.4,
    extraContribution: 0,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value);

    // Basic validation - prevent negative values for most fields
    if (name === "termYears" && numValue < 0) return;
    if (name === "initialCapital" && numValue < 0) return;

    setInputs((prev) => ({
      ...prev,
      [name]: isNaN(numValue) ? 0 : numValue,
    }));
  };

  // Memoize the calculation to prevent unnecessary recalculations
  const projectionData = useMemo(() => {
    const {
      initialCapital,
      termYears,
      returnRate,
      dividendYield,
      expenseRatio,
      taxRate,
      extraContribution,
    } = inputs;

    const results = [];
    let currentBalance = initialCapital;

    for (let year = 1; year <= termYears; year++) {
      const startBalance = currentBalance;
      const dividends = startBalance * (dividendYield / 100);
      const contributions = extraContribution * 12;
      const preGrowthBalance = startBalance + dividends + contributions;

      const growth = preGrowthBalance * (returnRate / 100);
      const expenses = preGrowthBalance * (expenseRatio / 100);
      const taxes = dividends * (taxRate / 100);

      currentBalance = preGrowthBalance + growth - expenses - taxes;

      results.push({
        year,
        startBalance,
        dividends,
        contributions,
        preGrowthBalance,
        returnRate,
        growth,
        expenses,
        taxes,
        endBalance: currentBalance,
      });
    }

    return results;
  }, [inputs]);

  const finalValue = projectionData[projectionData.length - 1]?.endBalance || 0;
  const totalGrowthPercent =
    inputs.initialCapital > 0
      ? ((finalValue - inputs.initialCapital) / inputs.initialCapital) * 100
      : 0;

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <div className="space-y-2">
                <Label
                  htmlFor="initialCapital"
                  className="text-slate-700 font-medium"
                >
                  Initial Capital ($)
                </Label>
                <Input
                  id="initialCapital"
                  name="initialCapital"
                  type="number"
                  min="0"
                  value={inputs.initialCapital}
                  onChange={handleInputChange}
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                  aria-describedby="initialCapital-desc"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="termYears"
                  className="text-slate-700 font-medium"
                >
                  Investment Term (Years)
                </Label>
                <Input
                  id="termYears"
                  name="termYears"
                  type="number"
                  min="1"
                  max="50"
                  value={inputs.termYears}
                  onChange={handleInputChange}
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                  aria-describedby="termYears-desc"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="returnRate"
                  className="text-slate-700 font-medium"
                >
                  Expected Return (%)
                </Label>
                <Input
                  id="returnRate"
                  name="returnRate"
                  type="number"
                  step="0.1"
                  value={inputs.returnRate}
                  onChange={handleInputChange}
                  className="border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                  aria-describedby="returnRate-desc"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="dividendYield"
                  className="text-slate-700 font-medium"
                >
                  Dividend Yield (%)
                </Label>
                <Input
                  id="dividendYield"
                  name="dividendYield"
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputs.dividendYield}
                  onChange={handleInputChange}
                  className="border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                  aria-describedby="dividendYield-desc"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="expenseRatio"
                  className="text-slate-700 font-medium"
                >
                  Expense Ratio (%)
                </Label>
                <Input
                  id="expenseRatio"
                  name="expenseRatio"
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputs.expenseRatio}
                  onChange={handleInputChange}
                  className="border-slate-300 focus:border-red-500 focus:ring-red-500"
                  aria-describedby="expenseRatio-desc"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="taxRate" className="text-slate-700 font-medium">
                  Tax Rate on Dividends (%)
                </Label>
                <Input
                  id="taxRate"
                  name="taxRate"
                  type="number"
                  step="0.1"
                  min="0"
                  value={inputs.taxRate}
                  onChange={handleInputChange}
                  className="border-slate-300 focus:border-red-500 focus:ring-red-500"
                  aria-describedby="taxRate-desc"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="extraContribution"
                  className="text-slate-700 font-medium"
                >
                  Extra Monthly Contribution ($)
                </Label>
                <Input
                  id="extraContribution"
                  name="extraContribution"
                  type="number"
                  min="0"
                  value={inputs.extraContribution}
                  onChange={handleInputChange}
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                  aria-describedby="extraContribution-desc"
                />
              </div>
            </div>

            {/* Summary Card */}
            <Card className="bg-gradient-to-b from-indigo-100 to-pink-50 border-indigo-100 shadow-inner">
              <CardContent className="p-6">
                <div className="flex flex-wrap justify-between gap-6">
                  <div className="text-center space-y-4">
                    <p className="text-sm text-slate-600 font-medium mb-1">
                      Final Portfolio Value
                    </p>
                    <p className="text-3xl font-bold text-blue-700">
                      $
                      {finalValue.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}
                    </p>
                  </div>
                  <div className="text-center space-y-4">
                    <p className="text-sm text-slate-600 font-medium mb-1">
                      4% Withdrawal Income
                    </p>
                    <p className="text-3xl font-bold text-blue-700">
                      $
                      {(finalValue * 0.04).toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}
                      /year
                    </p>
                  </div>
                  <div className="text-center space-y-4">
                    <p className="text-sm text-slate-600 font-medium mb-1">
                      Total Growth
                    </p>
                    <p className="text-3xl font-bold text-blue-700">
                      +{totalGrowthPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        {/* Projection Table */}
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
                    <th className="text-left p-3 font-semibold text-slate-700">
                      Year
                    </th>
                    <th className="text-left p-3 font-semibold text-slate-700">
                      Start Balance
                    </th>
                    <th className="text-left p-3 font-semibold text-emerald-700">
                      Dividends
                    </th>
                    <th className="text-left p-3 font-semibold text-blue-700">
                      Contributions
                    </th>
                    <th className="text-left p-3 font-semibold text-slate-700">
                      Pre-Growth
                    </th>
                    <th className="text-left p-3 font-semibold text-slate-700">
                      Return %
                    </th>
                    <th className="text-left p-3 font-semibold text-emerald-700">
                      Growth
                    </th>
                    <th className="text-left p-3 font-semibold text-red-700">
                      Expenses
                    </th>
                    <th className="text-left p-3 font-semibold text-red-700">
                      Taxes
                    </th>
                    <th className="text-left p-3 font-semibold text-slate-700">
                      End Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projectionData.map((data, index) => (
                    <tr
                      key={data.year}
                      className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                        index % 2 === 0 ? "bg-white" : "bg-slate-25"
                      }`}
                    >
                      <td className="p-3 font-semibold text-slate-800">
                        {data.year}
                      </td>
                      <td className="p-3 text-slate-600">
                        $
                        {data.startBalance.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="p-3 text-emerald-600 font-medium">
                        +$
                        {data.dividends.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="p-3 text-blue-600 font-medium">
                        +$
                        {data.contributions.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="p-3 text-slate-600">
                        $
                        {data.preGrowthBalance.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="p-3 text-slate-600">
                        {data.returnRate.toFixed(1)}%
                      </td>
                      <td className="p-3 text-emerald-600 font-semibold">
                        +$
                        {data.growth.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="p-3 text-red-600 font-medium">
                        -$
                        {data.expenses.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="p-3 text-red-600 font-medium">
                        -$
                        {data.taxes.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="p-3 font-bold text-slate-800 bg-slate-100">
                        $
                        {data.endBalance.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default InvestmentProjectionCalculator;
