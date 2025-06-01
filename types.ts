export interface CalculatorInputData {
  tickerSymbol: string;
  initialInvestment: number;
  monthlyContribution: number;
  yearsToHold: number;
  estimatedAnnualGrowth: number;
  dividendYield: number;
  dividendGrowthRate: number;
  dividendTaxRate: number;
  enableDRIP: boolean;
}

export interface ResultItem {
  year: number;
  dividendIncomeMonthly: number;
  dividendIncomeYearly: number;
  capitalAppreciation: number;
  reinvestedDividendsTotal: number; // Total amount reinvested (without growth)
  reinvestedDividendsValue: number; // Current value including growth
  totalInvestment: number;
  portfolioValue: number;
}