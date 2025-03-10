"use client";
import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import Footer from "@/components/Footer";

const DRIPCalculator = () => {
  // Updated default values based on technical requirements
  const defaultValues = {
    tickerSymbol: "SCHD",
    initialInvestment: 1000,
    annualContribution: 5000,
    yearsToHold: 30,
    estimatedAnnualGrowth: 7.5, // Capital appreciation rate (%)
    dividendYield: 3.5, // Annual dividend yield (%)
    dividendGrowthRate: 11.18, // Annual dividend growth rate (%)
    dividendTaxRate: 15, // Dividend tax rate (%)
    currentSharePrice: 28.0, // Current share price ($)
    enableDRIP: true, // Toggle for reinvestment scenario; if false, use accumulation scenario
  };

  // State hooks for form data and applied (submitted) data
  const [formData, setFormData] = useState(defaultValues);
  const [appliedFormData, setAppliedFormData] = useState(defaultValues);
  interface ResultItem {
    year: number;
    startBalance: number;
    sharePrice: string;
    totalShares: string;
    annualDividend: number;
    cumulativeDividends: number;
    totalContributions: number;
    endBalance: number;
    returnOnInvestment: number;
  }

  const [results, setResults] = useState<ResultItem[]>([]);
  const [hasCalculated, setHasCalculated] = useState(false);

  // Handle form input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: name === "tickerSymbol" ? value : parseFloat(value) || 0,
    });
  };

  // Handle switch toggle
  const handleSwitchChange = () => {
    setFormData({
      ...formData,
      enableDRIP: !formData.enableDRIP,
    });
  };

  // Calculate the DRIP / Accumulation results using given data object
  interface CalculatorInputData {
    initialInvestment: number;
    annualContribution: number;
    yearsToHold: number;
    estimatedAnnualGrowth: number;
    dividendYield: number;
    dividendGrowthRate: number;
    dividendTaxRate: number;
    currentSharePrice: number;
    enableDRIP: boolean;
  }

  interface YearlyResult {
    year: number;
    startBalance: number;
    sharePrice: string;
    totalShares: string;
    annualDividend: number;
    cumulativeDividends: number;
    totalContributions: number;
    endBalance: number;
    returnOnInvestment: number;
  }

  const calculateResults = (data: CalculatorInputData): YearlyResult[] => {
    const {
      initialInvestment,
      annualContribution,
      yearsToHold,
      estimatedAnnualGrowth,
      dividendYield,
      dividendGrowthRate,
      dividendTaxRate,
      currentSharePrice,
      enableDRIP,
    } = data;

    // Convert percentage rates
    const growthRate: number = estimatedAnnualGrowth / 100;
    const baseDivYield: number = dividendYield / 100;
    const divGrowthRate: number = dividendGrowthRate / 100;
    const taxFactor: number = 1 - dividendTaxRate / 100;

    const resultsArray: YearlyResult[] = [];
    let portfolioValue: number = initialInvestment;
    let cumulativeDividends: number = 0;
    let totalContributions: number = initialInvestment;
    let totalShares: number = initialInvestment / currentSharePrice;
    let sharePrice: number = currentSharePrice;
    let currentDivYield: number = baseDivYield;

    // Loop over each year of the investment period
    for (let year: number = 1; year <= yearsToHold; year++) {
      const startBalance: number = portfolioValue;
      const annualDividend: number = startBalance * currentDivYield * taxFactor;
      cumulativeDividends += annualDividend;
      totalContributions += annualContribution;

      let endBalance: number;
      if (enableDRIP) {
        const newBalance: number =
          startBalance + annualDividend + annualContribution;
        endBalance = newBalance * (1 + growthRate);
        const newSharesFromFunds: number =
          (annualDividend + annualContribution) / sharePrice;
        totalShares += newSharesFromFunds;
      } else {
        const newBalance: number = startBalance + annualContribution;
        endBalance = newBalance * (1 + growthRate);
        const newSharesFromContribution: number =
          annualContribution / sharePrice;
        totalShares += newSharesFromContribution;
      }

      const roi: number =
        ((endBalance - startBalance - annualContribution) / startBalance) * 100;

      sharePrice = sharePrice * (1 + growthRate);
      currentDivYield = currentDivYield * (1 + divGrowthRate);

      resultsArray.push({
        year,
        startBalance: Math.round(startBalance),
        sharePrice: sharePrice.toFixed(2),
        totalShares: totalShares.toFixed(2),
        annualDividend: Math.round(annualDividend),
        cumulativeDividends: Math.round(cumulativeDividends),
        totalContributions: Math.round(totalContributions),
        endBalance: Math.round(endBalance),
        returnOnInvestment: Math.round(roi),
      });

      portfolioValue = endBalance;
    }

    return resultsArray;
  };

  // Handle form submission: update applied data and results
  interface FormSubmitEvent extends React.FormEvent<HTMLFormElement> {
    preventDefault: () => void;
  }

  const handleSubmit = (e: FormSubmitEvent): void => {
    e.preventDefault();
    setAppliedFormData(formData);
    setResults(calculateResults(formData));
    setHasCalculated(true);
  };

  // Format currency for display
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Automatically calculate initial results when component mounts
  useEffect(() => {
    const initialResults = calculateResults(appliedFormData);
    setResults(initialResults);
    setHasCalculated(true);
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto py-8 px-4">
      <Card className="mb-8 md:p-8 shadow-lg">
        <CardHeader>
          <CardTitle>
            <h1 className="bg-gradient-to-r from-indigo-500 to-teal-300 inline-block text-transparent bg-clip-text text-xl md:text-3xl font-black text-center mb-8 w-full">
              Dividend Reinvestment Calculator (DRIP Calc)
            </h1>
          </CardTitle>
          <CardDescription>
            <p className="text-center text-gray-500 mb-8">
              Analyze the potential growth of your investments with
              dual-scenario calculations. Adjust the parameters and click
              &quot;Calculate Returns&quot; to update the results.
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="tickerSymbol">ETF Ticker Symbol</Label>
                <Input
                  id="tickerSymbol"
                  name="tickerSymbol"
                  type="text"
                  value={formData.tickerSymbol}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currentSharePrice">
                  Current Share Price ($)
                </Label>
                <Input
                  id="currentSharePrice"
                  name="currentSharePrice"
                  type="number"
                  step="0.01"
                  value={formData.currentSharePrice}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="initialInvestment">
                  Initial Investment ($)
                </Label>
                <Input
                  id="initialInvestment"
                  name="initialInvestment"
                  type="number"
                  value={formData.initialInvestment}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="annualContribution">
                  Annual Contribution ($)
                </Label>
                <Input
                  id="annualContribution"
                  name="annualContribution"
                  type="number"
                  value={formData.annualContribution}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yearsToHold">Years to Hold</Label>
                <Input
                  id="yearsToHold"
                  name="yearsToHold"
                  type="number"
                  min="1"
                  max="50"
                  value={formData.yearsToHold}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimatedAnnualGrowth">
                  Estimated Annual Growth (%)
                </Label>
                <Input
                  id="estimatedAnnualGrowth"
                  name="estimatedAnnualGrowth"
                  type="number"
                  step="0.1"
                  value={formData.estimatedAnnualGrowth}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dividendYield">Dividend Yield (%)</Label>
                <Input
                  id="dividendYield"
                  name="dividendYield"
                  type="number"
                  step="0.1"
                  value={formData.dividendYield}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dividendGrowthRate">
                  Dividend Growth Rate (%)
                </Label>
                <Input
                  id="dividendGrowthRate"
                  name="dividendGrowthRate"
                  type="number"
                  step="0.01"
                  value={formData.dividendGrowthRate}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dividendTaxRate">Dividend Tax Rate (%)</Label>
                <Input
                  id="dividendTaxRate"
                  name="dividendTaxRate"
                  type="number"
                  step="0.1"
                  value={formData.dividendTaxRate}
                  onChange={handleChange}
                />
              </div>
              <div className="flex items-center space-x-2 pt-8">
                <Switch
                  id="enableDRIP"
                  checked={formData.enableDRIP}
                  onCheckedChange={handleSwitchChange}
                  className="data-[state=checked]:bg-indigo-500"
                />
                <Label htmlFor="enableDRIP" className="font-medium">
                  Enable Dividend Reinvestment
                </Label>
              </div>
            </div>
            <div className="flex justify-center my-4">
              <Button
                size={"lg"}
                type="submit"
                className="w-auto transition duration-300 ease-in-out bg-indigo-500 hover:bg-indigo-700 text-white"
              >
                Calculate Returns
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {hasCalculated && (
        <div>
          <Card className="mb-8 md:p-8 shadow-lg">
            <CardHeader>
              <CardTitle>
                Portfolio Growth Projection - {appliedFormData.tickerSymbol}
              </CardTitle>
              <CardDescription>
                {appliedFormData.enableDRIP
                  ? "Results with dividend reinvestment enabled"
                  : "Results without dividend reinvestment"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={results}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="year"
                      label={{
                        value: "Year",
                        position: "insideBottom",
                        offset: -5,
                      }}
                    />
                    <YAxis
                      tickFormatter={(value) => `$${value / 1000}k`}
                      label={{
                        value: "Value ($)",
                        angle: -90,
                        position: "insideLeft",
                        offset: "-10",
                      }}
                    />
                    <Tooltip
                      formatter={(value) => [
                        formatCurrency(
                          Array.isArray(value)
                            ? (value[0] as number)
                            : typeof value === "string"
                            ? parseFloat(value)
                            : (value as number)
                        ),
                        "Value",
                      ]}
                      labelFormatter={(value) => `Year ${value}`}
                    />
                    <Legend />
                    {/* Only display dividend bar if DRIP was enabled during calculation */}
                    {appliedFormData.enableDRIP && (
                      <Bar
                        dataKey="cumulativeDividends"
                        name="Reinvested Dividend Total"
                        fill="#676bd6"
                      />
                    )}
                    <Bar
                      dataKey="endBalance"
                      name="Portfolio Total Value"
                      fill="#67d6ba"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-8 md:p-8 shadow-lg">
            <CardHeader>
              <CardTitle>
                Yearly Details - {appliedFormData.tickerSymbol}
              </CardTitle>
              <CardDescription>
                Detailed breakdown of your investment growth over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-800">
                      <th className="p-2 text-left border">Year</th>
                      <th className="p-2 text-left border">Start Balance</th>
                      <th className="p-2 text-left border">Share Price</th>
                      <th className="p-2 text-left border">Total Shares</th>
                      <th className="p-2 text-left border">Annual Dividend</th>
                      <th className="p-2 text-left border">
                        Total Contributions
                      </th>
                      {appliedFormData.enableDRIP && (
                        <th className="p-2 text-left border">
                          Cumulative Dividends
                        </th>
                      )}
                      <th className="p-2 text-left border">End Balance</th>
                      <th className="p-2 text-left border">ROI (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr
                        key={row.year}
                        className="border-b even:bg-gray-50 odd:bg-white dark:even:bg-gray-800 dark:odd:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                      >
                        <td className="p-2 border">{row.year}</td>
                        <td className="p-2 border">
                          {formatCurrency(row.startBalance)}
                        </td>
                        <td className="p-2 border">${row.sharePrice}</td>
                        <td className="p-2 border">{row.totalShares}</td>
                        <td className="p-2 border">
                          {formatCurrency(row.annualDividend)}
                        </td>
                        <td className="p-2 border">
                          {formatCurrency(row.totalContributions)}
                        </td>
                        {appliedFormData.enableDRIP && (
                          <td className="p-2 border">
                            {formatCurrency(row.cumulativeDividends)}
                          </td>
                        )}
                        <td className="p-2 border">
                          {formatCurrency(row.endBalance)}
                        </td>
                        <td className="p-2 border">
                          {row.returnOnInvestment}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
            <CardFooter className="text-sm text-gray-500 pt-2">
              Note: This calculator provides estimates based on consistent
              growth and tax assumptions. Actual performance may vary.
            </CardFooter>
          </Card>
        </div>
      )}

      <Footer />
    </div>
  );
};

export default DRIPCalculator;
