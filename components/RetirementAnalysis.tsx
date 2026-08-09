"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp,
  Home,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Calculator,
  Info,
} from "lucide-react";

interface PropertyData {
  year: number;
  propertyValue: number;
  mortgageBalance: number;
  totalEquity: number;
  usableEquity: number;
  extractableAmount: number;
  cumulativeExtracted: number;
}

interface FinancialData {
  year: number;
  originalPayment: number;
  equityLoanPayment: number;
  totalDebtService: number;
  availableForETF: number;
  annualETFContribution: number;
}

interface ETFScenarioData {
  year: number;
  startingBalance: number;
  lumpSum: number;
  monthlyContribution: number;
  annualContributions: number;
  investmentGrowth: number;
  endingBalance: number;
  potentialIncome: number;
}

interface KeyMetrics {
  equityPayment150k: number;
  finalBalance: number;
  finalIncome: number;
  extractionYear: number;
  meetsTarget: boolean;
}

export default function RetirementAnalysis() {
  // Property inputs - Fixed to match backstory
  const [housePrice, setHousePrice] = useState(1130000);
  const [depositPct] = useState(10);
  const [loanTerm] = useState(30);
  const [mortgageRate, setMortgageRate] = useState(6.0);
  const [purchaseYear] = useState(2023); // Fixed to April 2023
  // const [currentMortgageBalance] = useState(994712); // Current balance as of today - unused

  // Investment inputs - Fixed to match backstory
  const [invTerm, setInvTerm] = useState(15);
  // const [grossCAGR] = useState(18); // Gross return before taxes/fees - unused
  const [netCAGR] = useState(15); // After FIF tax (1.65%) and fees
  const [monthlyContrib, setMonthlyContrib] = useState(1000);
  const [propGrowthRate] = useState(4.5); // Auckland property growth rate

  // Computed
  const [propertyData, setPropertyData] = useState<PropertyData[]>([]);
  const [financialData, setFinancialData] = useState<FinancialData[]>([]);
  const [etfScenario, setEtfScenario] = useState<ETFScenarioData[]>([]);
  const [keyMetrics, setKeyMetrics] = useState<KeyMetrics>({
    equityPayment150k: 0,
    finalBalance: 0,
    finalIncome: 0,
    extractionYear: 0,
    meetsTarget: false,
  });

  const calculateMonthlyPayment = (
    principal: number,
    annualRatePct: number,
    years: number
  ) => {
    const r = annualRatePct / 100 / 12;
    const n = years * 12;
    if (r === 0) return principal / n;
    return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  };

  const calculateRemainingBalance = useCallback((
    originalPrincipal: number,
    rate: number,
    termYears: number,
    paymentsMade: number
  ) => {
    const monthlyRate = rate / 100 / 12;
    const totalPayments = termYears * 12;
    const monthlyPayment = calculateMonthlyPayment(
      originalPrincipal,
      rate,
      termYears
    );

    if (paymentsMade >= totalPayments) return 0;

    const remainingBalance =
      originalPrincipal * Math.pow(1 + monthlyRate, paymentsMade) -
      (monthlyPayment * (Math.pow(1 + monthlyRate, paymentsMade) - 1)) /
        monthlyRate;

    return Math.max(0, remainingBalance);
  }, []);

  useEffect(() => {
    const currentYear = new Date().getFullYear();
    const yearsElapsed = currentYear - purchaseYear;
    const monthsElapsed = yearsElapsed * 12;

    // Calculate original loan details
    const depositAmt = housePrice * (depositPct / 100);
    const originalPrincipal = housePrice - depositAmt;
    const monthlyPayment = calculateMonthlyPayment(
      originalPrincipal,
      mortgageRate,
      loanTerm
    );

    // Property growth calculation
    const propGrowthDecimal = propGrowthRate / 100;
    let currentValue =
      housePrice * Math.pow(1 + propGrowthDecimal, yearsElapsed);

    // Equity extraction settings
    const equityLoanRate = 7.0; // Typical equity loan rate in NZ
    const equityLoanTerm = 25; // 25 year term for equity loan
    const maxLVR = 0.8; // Banks typically allow up to 80% LVR

    let totalExtracted = 0;
    let extractionYear = 0;
    const propData: PropertyData[] = [];

    // Generate property projection
    for (let i = 1; i <= invTerm; i++) {
      const projectionYear = currentYear + i;
      const totalMonthsFromPurchase = monthsElapsed + i * 12;

      // Calculate property value growth
      currentValue *= 1 + propGrowthDecimal;

      // Calculate remaining mortgage balance
      const mortgageBalance = calculateRemainingBalance(
        originalPrincipal,
        mortgageRate,
        loanTerm,
        totalMonthsFromPurchase
      );

      // Calculate equity metrics
      const totalEquity = currentValue - mortgageBalance;
      const maxBorrowingCapacity = currentValue * maxLVR;
      const usableEquity = Math.max(0, maxBorrowingCapacity - mortgageBalance);

      // Determine extraction
      let extractableAmount = 0;
      if (totalExtracted === 0 && usableEquity >= 150000) {
        extractableAmount = 150000;
        totalExtracted = 150000;
        extractionYear = projectionYear;
      }

      propData.push({
        year: projectionYear,
        propertyValue: currentValue,
        mortgageBalance: mortgageBalance,
        totalEquity: totalEquity,
        usableEquity: usableEquity,
        extractableAmount: extractableAmount,
        cumulativeExtracted: totalExtracted,
      });
    }

    setPropertyData(propData);

    // Financial position calculation
    const equityMonthlyPayment =
      totalExtracted > 0
        ? calculateMonthlyPayment(150000, equityLoanRate, equityLoanTerm)
        : 0;
    const finData: FinancialData[] = [];

    for (let i = 1; i <= invTerm; i++) {
      const year = currentYear + i;
      // const isExtractionYear = year === extractionYear; // unused variable
      const hasEquityLoan = year >= extractionYear && extractionYear > 0;

      const equityPayment = hasEquityLoan ? equityMonthlyPayment : 0;
      const totalDebtService = monthlyPayment + equityPayment;
      const availableForETF = Math.max(0, monthlyContrib - equityPayment);

      finData.push({
        year: year,
        originalPayment: monthlyPayment,
        equityLoanPayment: equityPayment,
        totalDebtService: totalDebtService,
        availableForETF: availableForETF,
        annualETFContribution: availableForETF * 12,
      });
    }

    setFinancialData(finData);

    // ETF Portfolio calculation with proper compounding
    const monthlyReturn = netCAGR / 100 / 12;
    let portfolioBalance = 0;
    const etfData: ETFScenarioData[] = [];

    for (let i = 1; i <= invTerm; i++) {
      const year = currentYear + i;
      const startBalance = portfolioBalance;
      const lumpSum = year === extractionYear ? 150000 : 0;
      const monthlyContribution = finData[i - 1].availableForETF;

      // Add lump sum at beginning of year
      portfolioBalance += lumpSum;

      // Monthly compounding with monthly contributions
      let yearlyGrowth = 0;
      for (let month = 0; month < 12; month++) {
        const growthThisMonth = portfolioBalance * monthlyReturn;
        portfolioBalance += growthThisMonth + monthlyContribution;
        yearlyGrowth += growthThisMonth;
      }

      const potentialIncome = portfolioBalance * 0.04; // 4% withdrawal rate

      etfData.push({
        year: year,
        startingBalance: startBalance,
        lumpSum: lumpSum,
        monthlyContribution: monthlyContribution,
        annualContributions: monthlyContribution * 12,
        investmentGrowth: yearlyGrowth,
        endingBalance: portfolioBalance,
        potentialIncome: potentialIncome,
      });
    }

    setEtfScenario(etfData);

    // Calculate key metrics
    const finalIncome = portfolioBalance * 0.04;
    setKeyMetrics({
      equityPayment150k: equityMonthlyPayment,
      finalBalance: portfolioBalance,
      finalIncome: finalIncome,
      extractionYear: extractionYear,
      meetsTarget: finalIncome >= 80000,
    });
  }, [housePrice, depositPct, loanTerm, mortgageRate, invTerm, monthlyContrib, calculateRemainingBalance, netCAGR, propGrowthRate, purchaseYear]);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-NZ", {
      style: "currency",
      currency: "NZD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <Card className="bg-gradient-to-r from-green-600 to-blue-600 text-white">
          <CardHeader>
            <CardTitle className="text-3xl font-bold flex items-center gap-2">
              <Home className="h-8 w-8" />
              John&apos;s NZ Retirement Strategy
            </CardTitle>
            <CardDescription className="text-blue-100 text-lg">
              Property Equity → ETF Portfolio (Target: $80k annual income)
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Input Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Strategy Parameters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Investment Term (years)
                </label>
                <input
                  type="number"
                  value={invTerm}
                  onChange={(e) => setInvTerm(Number(e.target.value))}
                  className="w-full p-2 border rounded"
                  min="10"
                  max="20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Monthly Contribution
                </label>
                <input
                  type="number"
                  value={monthlyContrib}
                  onChange={(e) => setMonthlyContrib(Number(e.target.value))}
                  className="w-full p-2 border rounded"
                  min="500"
                  max="3000"
                  step="100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  House Price
                </label>
                <input
                  type="number"
                  value={housePrice}
                  onChange={(e) => setHousePrice(Number(e.target.value))}
                  className="w-full p-2 border rounded"
                  step="10000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Mortgage Rate (%)
                </label>
                <input
                  type="number"
                  value={mortgageRate}
                  onChange={(e) => setMortgageRate(Number(e.target.value))}
                  className="w-full p-2 border rounded"
                  step="0.1"
                  min="3"
                  max="10"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-5">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="property">Property Analysis</TabsTrigger>
            <TabsTrigger value="financial">Cash Flow</TabsTrigger>
            <TabsTrigger value="etf">ETF Growth</TabsTrigger>
            <TabsTrigger value="insights">Strategy Insights</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="bg-gradient-to-br from-green-50 to-emerald-50">
                <CardHeader>
                  <CardTitle className="text-green-700">
                    Target Achievement
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600 mb-2">
                    {formatCurrency(keyMetrics.finalIncome)}
                  </div>
                  <div className="text-sm text-gray-600">Annual 4% Income</div>
                  <Badge
                    variant={keyMetrics.meetsTarget ? "default" : "destructive"}
                    className="mt-2"
                  >
                    {keyMetrics.meetsTarget
                      ? "✅ Target Met"
                      : "❌ Below Target"}
                  </Badge>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-50 to-indigo-50">
                <CardHeader>
                  <CardTitle className="text-blue-700">
                    ETF Portfolio Value
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-600 mb-2">
                    {formatCurrency(keyMetrics.finalBalance)}
                  </div>
                  <div className="text-sm text-gray-600">
                    After {invTerm} years
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-purple-50 to-pink-50">
                <CardHeader>
                  <CardTitle className="text-purple-700">
                    Equity Extraction
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600 mb-2">
                    {keyMetrics.extractionYear || "TBD"}
                  </div>
                  <div className="text-sm text-gray-600">Extraction Year</div>
                  <div className="text-sm mt-1">
                    Payment: {formatCurrency(keyMetrics.equityPayment150k)}
                    /month
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="property">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Auckland Property Projection (4.5% annual growth)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <table className="w-full border text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-2 text-left">Year</th>
                        <th className="p-2 text-right">Property Value</th>
                        <th className="p-2 text-right">Mortgage Balance</th>
                        <th className="p-2 text-right">Total Equity</th>
                        <th className="p-2 text-right">Usable Equity</th>
                        <th className="p-2 text-right">Extractable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {propertyData.map((row) => (
                        <tr
                          key={row.year}
                          className="odd:bg-white even:bg-gray-50 border-b"
                        >
                          <td className="p-2 font-medium">{row.year}</td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.propertyValue)}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.mortgageBalance)}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.totalEquity)}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.usableEquity)}
                          </td>
                          <td className="p-2 text-right">
                            <Badge
                              variant={
                                row.extractableAmount > 0
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {formatCurrency(row.extractableAmount)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Monthly Cash Flow Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <table className="w-full border text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-2 text-left">Year</th>
                        <th className="p-2 text-right">Mortgage Payment</th>
                        <th className="p-2 text-right">Equity Loan Payment</th>
                        <th className="p-2 text-right">Total Debt Service</th>
                        <th className="p-2 text-right">Available for ETF</th>
                        <th className="p-2 text-right">Annual ETF Contrib</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financialData.map((row) => (
                        <tr
                          key={row.year}
                          className="odd:bg-white even:bg-gray-50 border-b"
                        >
                          <td className="p-2 font-medium">{row.year}</td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.originalPayment)}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.equityLoanPayment)}
                          </td>
                          <td className="p-2 text-right font-medium">
                            {formatCurrency(row.totalDebtService)}
                          </td>
                          <td className="p-2 text-right text-green-600">
                            {formatCurrency(row.availableForETF)}
                          </td>
                          <td className="p-2 text-right font-medium text-green-600">
                            {formatCurrency(row.annualETFContribution)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="etf">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  ETF Portfolio Growth (15% CAGR after tax/fees)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <table className="w-full border text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-2 text-left">Year</th>
                        <th className="p-2 text-right">Starting Balance</th>
                        <th className="p-2 text-right">Lump Sum</th>
                        <th className="p-2 text-right">Annual Contributions</th>
                        <th className="p-2 text-right">Investment Growth</th>
                        <th className="p-2 text-right">Ending Balance</th>
                        <th className="p-2 text-right">4% Income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {etfScenario.map((row) => (
                        <tr
                          key={row.year}
                          className="odd:bg-white even:bg-gray-50 border-b"
                        >
                          <td className="p-2 font-medium">{row.year}</td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.startingBalance)}
                          </td>
                          <td className="p-2 text-right">
                            <Badge
                              variant={
                                row.lumpSum > 0 ? "default" : "secondary"
                              }
                            >
                              {formatCurrency(row.lumpSum)}
                            </Badge>
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(row.annualContributions)}
                          </td>
                          <td className="p-2 text-right text-green-600">
                            {formatCurrency(row.investmentGrowth)}
                          </td>
                          <td className="p-2 text-right font-bold">
                            {formatCurrency(row.endingBalance)}
                          </td>
                          <td className="p-2 text-right text-blue-600">
                            {formatCurrency(row.potentialIncome)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="insights">
            <div className="space-y-6">
              <Card className="bg-gradient-to-br from-green-50 to-blue-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    Strategy Assessment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold text-green-700 mb-2">
                        Strengths
                      </h4>
                      <ul className="space-y-1 text-sm">
                        <li>• Conservative 4.5% property growth assumption</li>
                        <li>• Realistic 15% ETF returns (after NZ tax/fees)</li>
                        <li>• Diversified ETF strategy (QQQ/SMH/XLY/XLV)</li>
                        <li>• Maintains property ownership</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-amber-700 mb-2">
                        Considerations
                      </h4>
                      <ul className="space-y-1 text-sm">
                        <li>
                          • Additional debt service reduces ETF contributions
                        </li>
                        <li>• Market volatility risk in ETF portfolio</li>
                        <li>• Interest rate changes affect borrowing costs</li>
                        <li>• Property market dependency</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    NZ Banking & Equity Extraction
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Alert className="bg-blue-50 border-blue-200 mb-4">
                    <AlertDescription>
                      <strong>NZ Banks typically allow:</strong> Up to 80% LVR
                      (Loan-to-Value Ratio) for equity extraction. Banks may
                      require debt-to-income ratios below 6-7x and will assess
                      your ability to service additional debt.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-3">
                    <div>
                      <h4 className="font-semibold">
                        Future Equity Extraction Options:
                      </h4>
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        <li>
                          Revolving credit facilities tied to property value
                        </li>
                        <li>Top-up loans (additional to existing mortgage)</li>
                        <li>Refinancing to access equity</li>
                        <li>
                          Investment property loans (if purchasing additional
                          properties)
                        </li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold">
                        Bank Assessment Criteria:
                      </h4>
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        <li>
                          Debt-to-income ratio (typically max 6-7x annual
                          income)
                        </li>
                        <li>
                          Loan-to-value ratio (typically max 80% for
                          investments)
                        </li>
                        <li>
                          Serviceability tests (ability to pay at higher
                          interest rates)
                        </li>
                        <li>
                          Purpose of funds (some banks cautious about stock
                          investments)
                        </li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    Strategic Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Alert
                      className={
                        keyMetrics.meetsTarget
                          ? "bg-green-50 border-green-200"
                          : "bg-yellow-50 border-yellow-200"
                      }
                    >
                      <AlertDescription>
                        <strong>Income Target:</strong>{" "}
                        {keyMetrics.meetsTarget
                          ? `✅ Strategy achieves ${formatCurrency(
                              keyMetrics.finalIncome
                            )} annual income, exceeding the $80k target.`
                          : `⚠️ Strategy achieves ${formatCurrency(
                              keyMetrics.finalIncome
                            )} annual income, falling short of the $80k target.`}
                      </AlertDescription>
                    </Alert>

                    {!keyMetrics.meetsTarget && (
                      <Alert className="bg-orange-50 border-orange-200">
                        <AlertDescription>
                          <strong>Options to reach target:</strong>
                          <ul className="list-disc pl-5 mt-2 space-y-1">
                            <li>
                              Increase monthly contributions from $1,000 to
                              $1,500+
                            </li>
                            <li>
                              Extract additional equity in later years (requires
                              higher income)
                            </li>
                            <li>
                              Consider selling property and investing full
                              proceeds
                            </li>
                            <li>
                              Look for higher-yielding investment opportunities
                            </li>
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="font-semibold mb-2">Key Timeline:</h4>
                      <ul className="space-y-1 text-sm">
                        <li>
                          • <strong>2023:</strong> Property purchased ($1.13M,
                          10% deposit)
                        </li>
                        <li>
                          •{" "}
                          <strong>{keyMetrics.extractionYear || "TBD"}:</strong>{" "}
                          Extract $150k equity, start ETF investing
                        </li>
                        <li>
                          • <strong>{2023 + invTerm}:</strong> Target retirement
                          with ${formatCurrency(keyMetrics.finalIncome)} income
                        </li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
