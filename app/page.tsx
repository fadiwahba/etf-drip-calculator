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
  const [results, setResults] = useState([]);
  const [hasCalculated, setHasCalculated] = useState(false);

  // Handle form input changes
  const handleChange = (e) => {
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
  const calculateResults = (data) => {
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
    const growthRate = estimatedAnnualGrowth / 100;
    const baseDivYield = dividendYield / 100;
    const divGrowthRate = dividendGrowthRate / 100;
    const taxFactor = 1 - dividendTaxRate / 100;

    let resultsArray = [];
    let portfolioValue = initialInvestment; // End balance from previous year
    let cumulativeDividends = 0;
    let totalContributions = initialInvestment;
    let totalShares = initialInvestment / currentSharePrice;
    let sharePrice = currentSharePrice;
    let currentDivYield = baseDivYield; // This rate grows each year

    // Loop over each year of the investment period
    for (let year = 1; year <= yearsToHold; year++) {
      // Record the starting balance of the year
      const startBalance = portfolioValue;

      // Calculate annual dividend based on start balance and effective yield after tax
      const annualDividend = startBalance * currentDivYield * taxFactor;

      // Increase cumulative dividends (even if not reinvested)
      cumulativeDividends += annualDividend;

      // Increase total contributions by annual addition
      totalContributions += annualContribution;

      let endBalance;
      if (enableDRIP) {
        // DRIP scenario: dividends are reinvested along with contributions
        const newBalance = startBalance + annualDividend + annualContribution;
        endBalance = newBalance * (1 + growthRate);
        // Update total shares: add shares bought with both contribution and reinvested dividend at current share price
        const newSharesFromFunds =
          (annualDividend + annualContribution) / sharePrice;
        totalShares += newSharesFromFunds;
      } else {
        // Non-reinvestment scenario: dividends are accrued separately, not reinvested
        const newBalance = startBalance + annualContribution;
        endBalance = newBalance * (1 + growthRate);
        // Only contributions buy new shares in this scenario
        const newSharesFromContribution = annualContribution / sharePrice;
        totalShares += newSharesFromContribution;
      }

      // Calculate ROI (%) for the year
      const roi =
        ((endBalance - startBalance - annualContribution) / startBalance) * 100;

      // Update share price for next year based on capital appreciation
      sharePrice = sharePrice * (1 + growthRate);
      // Update dividend yield based on dividend growth rate
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

      // Prepare for next year
      portfolioValue = endBalance;
    }

    return resultsArray;
  };

  // Handle form submission: update applied data and results
  const handleSubmit = (e) => {
    e.preventDefault();
    setAppliedFormData(formData);
    setResults(calculateResults(formData));
    setHasCalculated(true);
  };

  // Format currency for display
  const formatCurrency = (value) => {
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
      <Card className="mb-8 shadow-lg">
        <CardHeader>
          <CardTitle>
            <h1 className="bg-gradient-to-r from-indigo-500 to-teal-300 inline-block text-transparent bg-clip-text text-3xl font-black text-center mb-8 w-full">
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
          <Card className="mb-8 shadow-lg">
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
                      formatter={(value) => [formatCurrency(value), "Value"]}
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

          <Card className="mb-8 shadow-lg">
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
                    {results.map((row, index) => (
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
    </div>
  );
};

export default DRIPCalculator;
