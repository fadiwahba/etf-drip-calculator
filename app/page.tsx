"use client";
import React, { useState, useEffect, ChangeEvent, FormEvent } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import Footer from "@/components/Footer";
import { CalculatorInputData, ResultItem } from "@/types";
import GrowthColumnChart from "@/components/GrowthColumnChart";

const DRIPCalculator: React.FC = () => {
  // Updated default values based on the new projection requirements.
  const defaultValues: CalculatorInputData = {
    tickerSymbol: "SCHD", // Default ETF ticker symbol.
    initialInvestment: 10000,
    monthlyContribution: 0, // Monthly contribution
    yearsToHold: 30,
    estimatedAnnualGrowth: 7.7, // Capital appreciation rate (%)
    dividendYield: 3.5, // Annual dividend yield (%)
    dividendGrowthRate: 11.04, // Annual dividend growth rate (%)
    dividendTaxRate: 28, // Dividend tax rate (%)
    enableDRIP: true, // Dividend Reinvestment (DRIP) enabled by default.
  };

  // State hooks for form data and applied (submitted) data.
  const [formData, setFormData] = useState<CalculatorInputData>(defaultValues);
  const [appliedFormData, setAppliedFormData] =
    useState<CalculatorInputData>(defaultValues);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [hasCalculated, setHasCalculated] = useState<boolean>(false);

  // Handle form input changes.
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: name === "tickerSymbol" ? value : parseFloat(value) || 0,
    });
  };

  // Handle switch toggle.
  const handleSwitchChange = () => {
    setFormData({
      ...formData,
      enableDRIP: !formData.enableDRIP,
    });
  };

  // Improved calculation function with accurate dividend reinvestment tracking
  const calculateResults = (data: CalculatorInputData): ResultItem[] => {
    const {
      initialInvestment,
      monthlyContribution,
      yearsToHold,
      estimatedAnnualGrowth,
      dividendYield,
      dividendGrowthRate,
      dividendTaxRate,
      enableDRIP,
    } = data;

    // Convert percentages to decimals
    const annualGrowthRate = estimatedAnnualGrowth / 100;
    const initialDividendYield = dividendYield / 100;
    const dividendGrowth = dividendGrowthRate / 100;
    const taxRate = dividendTaxRate / 100;
    const annualContribution = monthlyContribution * 12;

    const resultsArray: ResultItem[] = [];

    // Initialize tracking variables
    let portfolioValue = initialInvestment;
    let totalContributions = initialInvestment;
    let totalDividendsReinvested = 0;
    let dividendComponent = 0; // Tracks growth from reinvested dividends
    let contributionComponent = initialInvestment; // Tracks growth from contributions

    for (let year = 1; year <= yearsToHold; year++) {
      // Calculate dividend yield for this year (with growth)
      const currentDividendYield =
        initialDividendYield * Math.pow(1 + dividendGrowth, year - 1);

      // Calculate annual dividend based on portfolio value
      const annualDividendBeforeTax = portfolioValue * currentDividendYield;
      const annualDividendAfterTax = annualDividendBeforeTax * (1 - taxRate);

      // Apply capital appreciation to the different components
      contributionComponent *= 1 + annualGrowthRate;
      dividendComponent *= 1 + annualGrowthRate;

      // Add new contribution
      totalContributions += annualContribution;
      contributionComponent += annualContribution;

      // Handle dividend reinvestment if DRIP is enabled
      if (enableDRIP) {
        // Reinvest dividends, which will compound in future years
        totalDividendsReinvested += annualDividendAfterTax;
        dividendComponent += annualDividendAfterTax;
      }

      // Calculate total portfolio value
      portfolioValue = contributionComponent + dividendComponent;

      // Calculate this year's capital appreciation (for reporting)
      const previousValue =
        year > 1 ? resultsArray[year - 2].portfolioValue : initialInvestment;
      const yearlyContribution = annualContribution;
      const yearlyDividend = enableDRIP ? annualDividendAfterTax : 0;
      const capitalAppreciation =
        portfolioValue - previousValue - yearlyContribution - yearlyDividend;

      // Store results
      resultsArray.push({
        year,
        dividendIncomeMonthly: Math.round(annualDividendAfterTax / 12),
        dividendIncomeYearly: Math.round(annualDividendAfterTax),
        capitalAppreciation: Math.round(capitalAppreciation),
        reinvestedDividendsTotal: Math.round(
          enableDRIP ? totalDividendsReinvested : 0
        ),
        reinvestedDividendsValue: Math.round(
          enableDRIP ? dividendComponent : 0
        ),
        totalInvestment: Math.round(totalContributions),
        portfolioValue: Math.round(portfolioValue),
      });
    }

    return resultsArray;
  };

  // Handle form submission: update applied data and results.
  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setAppliedFormData(formData);
    setResults(calculateResults(formData));
    setHasCalculated(true);
  };

  // Automatically calculate initial results when component mounts.
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
            <h1 className="bg-gradient-to-r from-rose-400 to-amber-400 inline-block text-transparent bg-clip-text text-xl md:text-3xl font-black text-center mb-8 w-full">
              Portfolio Projection Calculator
            </h1>
          </CardTitle>
          <CardDescription>
            <p className="text-center text-gray-500 mb-8">
              Enter your investment parameters below. By default, dividend
              reinvestment is enabled. The calculator uses an initial balance,
              monthly contributions, a share price growth rate, and dividend
              parameters (including tax and growth) to project the portfolio
              value over 30 years.
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                <Label htmlFor="monthlyContribution">
                  Monthly Contribution ($)
                </Label>
                <Input
                  id="monthlyContribution"
                  name="monthlyContribution"
                  type="number"
                  value={formData.monthlyContribution}
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
                  step="0.1"
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
                  className="data-[state=checked]:bg-rose-400"
                />
                <Label htmlFor="enableDRIP" className="font-medium">
                  Enable Dividend Reinvestment
                </Label>
              </div>
            </div>
            <div className="flex justify-center my-4">
              <Button
                size="lg"
                type="submit"
                className="w-auto transition duration-300 ease-in-out bg-rose-400 hover:bg-rose-600 text-white"
              >
                Calculate Returns
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {hasCalculated && (
        <div>
          <GrowthColumnChart formData={appliedFormData} results={results} />
        </div>
      )}

      <Footer />
    </div>
  );
};

export default DRIPCalculator;
