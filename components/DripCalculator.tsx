'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { HelpCircle, Calculator, TrendingUp } from 'lucide-react';

const chartConfig = {
  postTaxNAV: {
    label: 'Post-Tax NAV',
    color: 'hsl(var(--chart-1))',
  },
  grossDividends: {
    label: 'Gross Dividends',
    color: 'hsl(var(--chart-2))',
  },
} satisfies ChartConfig;

// Types
interface CalculationInputs {
  initialInvestment: number;
  currentSharePrice: number;
  sharePriceGrowth: number; // CAGR %
  dividendYield: number; // Current dividend yield %
  dividendGrowth: number; // Dividend growth CAGR %
  dividendTaxRate: number; // U.S. dividend tax rate (e.g. 15)
  expenseRatio: number; // Annual expense ratio %
  extraContributions: number; // $ per contribution period
  contributionFrequency: number; // 1, 4, 12, 26, or 52
  investmentPeriod: number; // Years
  startingYear: number;
}

interface YearlyResult {
  year: number;
  yearNumber: number;
  openingNAV: number;
  grossDividends: number;
  feesPaid: number;
  netDividends: number;
  dividendTaxPaid: number;
  extraContributions: number;
  sharesPurchasedFromCash: number;
  totalShares: number;
  sharePrice: number; // Year-end price
  closingNAV: number; // NAV before fees at year-end
  postTaxNAV: number; // NAV after fees at year-end
  annualReturn: number; // %
  cumulativeReturn: number; // %
}

// Default values based on SCHD
const defaultInputs: CalculationInputs = {
  initialInvestment: 100000, // USD 100,000
  currentSharePrice: 26, // USD 26.00 today
  sharePriceGrowth: 7.5, // 7.5% CAGR
  dividendYield: 3.6, // 3.5% yield
  dividendGrowth: 11, // 11% dividend growth CAGR
  expenseRatio: 0.06, // 0.06% expense ratio
  dividendTaxRate: 15, // 15% U.S. dividend tax
  extraContributions: 0, // no extra contributions by default
  contributionFrequency: 12, // monthly contributions if any
  investmentPeriod: 15, // 15 years
  startingYear: 2026, // starting calendar year
};

// Calculation engine with U.S. dividend‐tax, proper fee ordering, mid‐year reinvest
const calculateDRIP = (inputs: CalculationInputs): YearlyResult[] => {
  const results: YearlyResult[] = [];
  let currentShares = inputs.initialInvestment / inputs.currentSharePrice;
  let previousNAV = inputs.initialInvestment;

  for (let year = 0; year < inputs.investmentPeriod; year++) {
    const actualYear = inputs.startingYear + year;
    const yearNumber = year + 1;

    // 1. Determine start‐of‐year share price
    const startPrice =
      year === 0
        ? inputs.currentSharePrice
        : inputs.currentSharePrice *
          Math.pow(1 + inputs.sharePriceGrowth / 100, year);

    // 2. Opening NAV
    const openingNAV = currentShares * startPrice;

    // 3. Gross dividends for the year
    const currentDividendYield =
      (inputs.dividendYield / 100) *
      Math.pow(1 + inputs.dividendGrowth / 100, year);
    const grossDividends = openingNAV * currentDividendYield;

    // 4. Dividend tax (U.S.-style)
    const dividendTaxPaid = grossDividends * (inputs.dividendTaxRate / 100);

    // 5. Fees on AUM (annual expense ratio)
    const feesPaid = openingNAV * (inputs.expenseRatio / 100);

    // 6. Net dividends available to reinvest
    const netDividends = Math.max(0, grossDividends - dividendTaxPaid);

    // 7. Extra contributions for the year
    const yearlyExtraContributions =
      inputs.extraContributions * inputs.contributionFrequency;

    // 8. Mid‐year reinvest price approximation
    const midYearPrice =
      startPrice * Math.pow(1 + inputs.sharePriceGrowth / 100, 0.5);

    // 9. Shares bought with net dividends + contributions
    const cashToReinvest = netDividends + yearlyExtraContributions;
    const sharesPurchasedFromCash =
      midYearPrice > 0 ? cashToReinvest / midYearPrice : 0;
    currentShares += sharesPurchasedFromCash;

    // 10. End‐of‐year share price
    const endPrice =
      inputs.currentSharePrice *
      Math.pow(1 + inputs.sharePriceGrowth / 100, year + 1);

    // 11. NAV before fees at year-end
    const closingNAVBeforeFees = currentShares * endPrice;

    // 12. Subtract fees at year-end
    const closingNAV = closingNAVBeforeFees - feesPaid;

    // 13. Post‐tax NAV is same as closingNAV since tax was already taken from dividends
    const postTaxNAV = Math.max(0, closingNAV);

    // 14. Calculate annual and cumulative returns
    const annualReturn =
      year === 0
        ? ((postTaxNAV - inputs.initialInvestment) / inputs.initialInvestment) *
          100
        : ((postTaxNAV - previousNAV) / previousNAV) * 100;
    const cumulativeReturn =
      ((postTaxNAV - inputs.initialInvestment) / inputs.initialInvestment) *
      100;

    results.push({
      year: actualYear,
      yearNumber,
      openingNAV,
      grossDividends,
      feesPaid,
      netDividends,
      dividendTaxPaid,
      extraContributions: yearlyExtraContributions,
      sharesPurchasedFromCash,
      totalShares: currentShares,
      sharePrice: endPrice,
      closingNAV: closingNAVBeforeFees,
      postTaxNAV,
      annualReturn,
      cumulativeReturn,
    });

    previousNAV = postTaxNAV;
  }

  return results;
};

// Calculate total return CAGR
const calculateTotalReturnCAGR = (inputs: CalculationInputs): number => {
  const results = calculateDRIP(inputs);
  if (results.length === 0) return 0;
  const finalValue = results[results.length - 1].postTaxNAV;
  const initialValue = inputs.initialInvestment;
  const years = inputs.investmentPeriod;
  return (Math.pow(finalValue / initialValue, 1 / years) - 1) * 100;
};

// Format currency (USD)
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Format percentage
const formatPercentage = (value: number): string => {
  return `${value.toFixed(2)}%`;
};

// Format number with decimals
const formatNumber = (value: number, decimals: number = 2): string => {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export default function DRIPCalculator() {
  const [inputs, setInputs] = useState<CalculationInputs>(defaultInputs);
  const [results, setResults] = useState<YearlyResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Input handler with non-negative guard
  const handleInputChange = (field: keyof CalculationInputs, value: string) => {
    let numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      numValue = 0;
    }
    setInputs((prev) => ({ ...prev, [field]: numValue }));
  };

  // Validate before calculating
  const inputsAreValid = (): boolean => {
    return (
      inputs.initialInvestment > 0 &&
      inputs.currentSharePrice > 0 &&
      inputs.investmentPeriod > 0 &&
      inputs.sharePriceGrowth >= 0 &&
      inputs.dividendYield >= 0 &&
      inputs.dividendGrowth >= 0 &&
      inputs.expenseRatio >= 0 &&
      inputs.dividendTaxRate >= 0 &&
      inputs.extraContributions >= 0
    );
  };

  const handleCalculate = () => {
    if (!inputsAreValid()) {
      alert(
        'Please ensure all inputs are non-negative and required fields are filled.'
      );
      return;
    }
    const calculatedResults = calculateDRIP(inputs);
    setResults(calculatedResults);
    setShowResults(true);
  };

  const totalReturnCAGR = calculateTotalReturnCAGR(inputs);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gray-50 py-4 px-4">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center justify-center gap-2">
              <TrendingUp className="w-8 h-8 text-blue-600" />
              DRIP Calculator
            </h1>
            <p className="text-gray-600">
              Dividend Reinvestment Plan Projection Tool
            </p>
          </div>

          {/* Input Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5" />
                Investment Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 align-items-center">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Initial Investment */}
                <div className="space-y-2">
                  <Label
                    htmlFor="initialInvestment"
                    className="flex items-center gap-1"
                  >
                    Initial Investment (USD)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Your starting investment amount</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="initialInvestment"
                    type="number"
                    value={inputs.initialInvestment}
                    onChange={(e) =>
                      handleInputChange('initialInvestment', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Current Share Price */}
                <div className="space-y-2">
                  <Label
                    htmlFor="currentSharePrice"
                    className="flex items-center gap-1"
                  >
                    Current Share Price (USD)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Current price per share of the ETF</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="currentSharePrice"
                    type="number"
                    step="0.01"
                    value={inputs.currentSharePrice}
                    onChange={(e) =>
                      handleInputChange('currentSharePrice', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Investment Period */}
                <div className="space-y-2">
                  <Label
                    htmlFor="investmentPeriod"
                    className="flex items-center gap-1"
                  >
                    Investment Period (Years)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>How many years to project the investment</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="investmentPeriod"
                    type="number"
                    value={inputs.investmentPeriod}
                    onChange={(e) =>
                      handleInputChange('investmentPeriod', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Share Price Growth */}
                <div className="space-y-2">
                  <Label
                    htmlFor="sharePriceGrowth"
                    className="flex items-center gap-1"
                  >
                    Share Price Growth (CAGR %)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Expected annual growth rate of share price</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="sharePriceGrowth"
                    type="number"
                    step="0.1"
                    value={inputs.sharePriceGrowth}
                    onChange={(e) =>
                      handleInputChange('sharePriceGrowth', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Dividend Yield */}
                <div className="space-y-2">
                  <Label
                    htmlFor="dividendYield"
                    className="flex items-center gap-1"
                  >
                    Current Dividend Yield (%)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Current annual dividend yield percentage</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="dividendYield"
                    type="number"
                    step="0.01"
                    value={inputs.dividendYield}
                    onChange={(e) =>
                      handleInputChange('dividendYield', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Dividend Growth */}
                <div className="space-y-2">
                  <Label
                    htmlFor="dividendGrowth"
                    className="flex items-center gap-1"
                  >
                    Dividend Growth (CAGR %)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Expected annual growth rate of dividend payments</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="dividendGrowth"
                    type="number"
                    step="0.1"
                    value={inputs.dividendGrowth}
                    onChange={(e) =>
                      handleInputChange('dividendGrowth', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Expense Ratio */}
                <div className="space-y-2">
                  <Label
                    htmlFor="expenseRatio"
                    className="flex items-center gap-1"
                  >
                    Expense Ratio (%)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Annual management fee charged by the ETF/fund</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="expenseRatio"
                    type="number"
                    step="0.01"
                    value={inputs.expenseRatio}
                    onChange={(e) =>
                      handleInputChange('expenseRatio', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Dividend Tax Rate */}
                <div className="space-y-2">
                  <Label
                    htmlFor="dividendTaxRate"
                    className="flex items-center gap-1"
                  >
                    Dividend Tax Rate (%)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Expected U.S. dividend tax rate (e.g. 15%)</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="dividendTaxRate"
                    type="number"
                    step="0.1"
                    value={inputs.dividendTaxRate}
                    onChange={(e) =>
                      handleInputChange('dividendTaxRate', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Extra Contributions */}
                <div className="space-y-2">
                  <Label
                    htmlFor="extraContributions"
                    className="flex items-center gap-1"
                  >
                    Contribution Amount ($ per period)
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Enter the contribution amount per selected frequency
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="extraContributions"
                    type="number"
                    value={inputs.extraContributions}
                    onChange={(e) =>
                      handleInputChange('extraContributions', e.target.value)
                    }
                    className="w-full"
                  />
                </div>

                {/* Contribution Frequency */}
                <div className="space-y-2">
                  <Label htmlFor="contributionFrequency">
                    Contribution Frequency
                  </Label>
                  <Select
                    value={inputs.contributionFrequency.toString()}
                    onValueChange={(value) =>
                      handleInputChange('contributionFrequency', value)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Annual</SelectItem>
                      <SelectItem value="4">Quarterly</SelectItem>
                      <SelectItem value="12">Monthly</SelectItem>
                      <SelectItem value="26">Bi-Weekly</SelectItem>
                      <SelectItem value="52">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Starting Year */}
                <div className="space-y-2">
                  <Label htmlFor="startingYear">Starting Year</Label>
                  <Input
                    id="startingYear"
                    type="number"
                    value={inputs.startingYear}
                    onChange={(e) =>
                      handleInputChange('startingYear', e.target.value)
                    }
                    className="w-full"
                  />
                </div>
              </div>

              {/* Auto-calculated Total Return */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-blue-900">
                    Projected Total Return (CAGR)
                  </span>
                  <span className="text-2xl font-bold text-blue-600">
                    {formatPercentage(totalReturnCAGR)}
                  </span>
                </div>
                <p className="text-sm text-blue-700 mt-1">
                  Combines price growth, dividend income, dividend tax, and
                  expense drag
                </p>
              </div>

              {/* Calculate Button */}
              <Button
                size="lg"
                onClick={handleCalculate}
                disabled={!inputsAreValid()}
                className={`font-medium py-3 ${
                  inputsAreValid()
                    ? 'bg-blue-600 hover:bg-blue-500 hover:shadow-md text-white'
                    : 'bg-gray-300 cursor-not-allowed text-gray-600'
                }`}
              >
                Calculate DRIP Projection
              </Button>
            </CardContent>
          </Card>

          {/* Results Table */}
          {showResults && results.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>DRIP Projection Results</CardTitle>
                <div className="flex flex-wrap gap-4 text-gray-600">
                  <span>
                    Final NAV (Post-Tax):{' '}
                    <strong className="text-green-600">
                      {formatCurrency(results[results.length - 1].postTaxNAV)}
                    </strong>
                  </span>
                  <span>
                    Total Return:{' '}
                    <strong className="text-blue-600">
                      {formatPercentage(
                        results[results.length - 1].cumulativeReturn
                      )}
                    </strong>
                  </span>
                  <span>
                    Final Shares:{' '}
                    <strong>
                      {formatNumber(results[results.length - 1].totalShares)}
                    </strong>
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help">
                              Year{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Investment year number and calendar year</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Opening NAV{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                Portfolio value at the beginning of the year
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Gross Dividends{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Total dividend payments before tax and fees</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Fees Paid{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Annual expense ratio fees deducted from NAV</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Net Dividends{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Dividends after subtracting dividend tax</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Dividend Tax Paid{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Tax paid on dividends</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Contributions{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Total extra cash added during the year</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Shares Bought{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>New shares purchased mid‐year</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Total Shares{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Cumulative shares owned</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Share Price{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Share price at the end of the year</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Closing NAV{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Portfolio NAV before fees at year-end</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Post-Tax NAV{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                Portfolio NAV after annual fees and dividend tax
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Annual Return{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Year-over-year percentage return</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right p-1 font-medium">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1 cursor-help ml-auto">
                              Cumulative Return{' '}
                              <HelpCircle className="w-3 h-3 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Total return since initial investment</p>
                            </TooltipContent>
                          </Tooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="">
                      {results.map((res, idx) => (
                        <tr
                          key={res.year}
                          className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                        >
                          <td className="p-1 font-medium">
                            {res.yearNumber} ({res.year})
                          </td>
                          <td className="p-1 text-right">
                            {formatCurrency(res.openingNAV)}
                          </td>
                          <td className="p-1 text-right text-green-600">
                            {formatCurrency(res.grossDividends)}
                          </td>
                          <td className="p-1 text-right text-orange-600">
                            {formatCurrency(res.feesPaid)}
                          </td>
                          <td className="p-1 text-right">
                            {formatCurrency(res.netDividends)}
                          </td>
                          <td className="p-1 text-right text-red-600">
                            {formatCurrency(res.dividendTaxPaid)}
                          </td>
                          <td className="p-1 text-right">
                            {formatCurrency(res.extraContributions)}
                          </td>
                          <td className="p-1 text-right">
                            {formatNumber(res.sharesPurchasedFromCash)}
                          </td>
                          <td className="p-1 text-right">
                            {formatNumber(res.totalShares)}
                          </td>
                          <td className="p-1 text-right">
                            ${formatNumber(res.sharePrice)}
                          </td>
                          <td className="p-1 text-right">
                            {formatCurrency(res.closingNAV)}
                          </td>
                          <td className="p-1 text-right font-medium">
                            {formatCurrency(res.postTaxNAV)}
                          </td>
                          <td
                            className={`p-1 text-right ${
                              res.annualReturn >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}
                          >
                            {formatPercentage(res.annualReturn)}
                          </td>
                          <td
                            className={`p-1 text-right font-medium ${
                              res.cumulativeReturn >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}
                          >
                            {formatPercentage(res.cumulativeReturn)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Chart */}
          {showResults && results.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Portfolio Growth & Annual Dividends</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={chartConfig}
                  className="min-h-96 w-full"
                >
                  <BarChart
                    accessibilityLayer
                    data={results.map((res) => ({
                      year: `${res.yearNumber}`,
                      postTaxNAV: Math.round(res.postTaxNAV),
                      grossDividends: Math.round(res.grossDividends),
                    }))}
                    margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="year"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={10}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={10}
                      tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, name) => [
                            formatCurrency(value as number),
                            ' ',
                            name,
                          ]}
                          labelFormatter={(label) => `Year ${label}`}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="grossDividends" fill="#3b82f6" radius={4} />
                    <Bar dataKey="postTaxNAV" fill="#10b981" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
