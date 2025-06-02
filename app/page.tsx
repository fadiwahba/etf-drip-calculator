"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Info } from "lucide-react";

interface ProjectionRow {
  year: number;
  startBalance: number;
  endBalance: number;
  // cagrPercent: number;
}

const DEFAULT_PIR = 28; // % max PIR in NZ
const FDR_RATE = 0.05; // 5% deemed return taxed annually
const DEFAULT_EFFECTIVE_TAX = FDR_RATE * (DEFAULT_PIR / 100); // 0.05 * 0.28 = 1.4%

const FREQUENCY_MAP = {
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

export default function Home() {
  const currentYear = new Date().getFullYear();
  // Form state
  const [initialInvestment, setInitialInvestment] = useState("100000");
  const [cagr, setCagr] = useState("15");
  const [years, setYears] = useState("15");
  const [startYear, setStartYear] = useState(String(currentYear));
  const [taxRate, setTaxRate] = useState(DEFAULT_EFFECTIVE_TAX.toFixed(3)); // default 1.4%
  const [extraInvestment, setExtraInvestment] = useState("0");
  const [extraFrequency, setExtraFrequency] =
    useState<keyof typeof FREQUENCY_MAP>("monthly");

  const [projectionData, setProjectionData] = useState<ProjectionRow[]>([]);

  // Helper: format NZD currency
  const formatNZD = (value: number) =>
    value.toLocaleString("en-NZ", {
      style: "currency",
      currency: "NZD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  // Calculation logic
  const calculateProjection = () => {
    // Parse inputs
    const principal = parseFloat(initialInvestment);
    const annualReturn = parseFloat(cagr) / 100;
    const term = parseInt(years);
    const tax = parseFloat(taxRate);
    const extraAmt = parseFloat(extraInvestment);
    const freq = FREQUENCY_MAP[extraFrequency];
    const startYearNum = parseInt(startYear);

    // Validation
    if (isNaN(principal) || principal <= 0) {
      alert("Please enter a valid initial investment amount > 0");
      return;
    }
    if (isNaN(annualReturn) || annualReturn <= 0) {
      alert("Please enter a valid CAGR % > 0");
      return;
    }
    if (isNaN(term) || term <= 0) {
      alert("Please enter a valid investment term (years) > 0");
      return;
    }
    if (isNaN(startYearNum) || startYearNum < currentYear) {
      alert(`Please enter a valid starting year (>= ${currentYear})`);
      return;
    }
    if (isNaN(tax) || tax < 0 || tax > 1) {
      alert(
        "Please enter a valid tax rate between 0 and 1 (e.g. 0.014 for 1.4%)"
      );
      return;
    }
    if (isNaN(extraAmt) || extraAmt < 0) {
      alert("Please enter a valid extra investment amount >= 0");
      return;
    }

    // Effective annual net return after tax drag on portfolio value
    const netAnnualReturn = annualReturn - tax;
    if (netAnnualReturn <= 0) {
      alert(
        `Tax drag (${(tax * 100).toFixed(
          2
        )}%) is higher than or equal to CAGR (${(annualReturn * 100).toFixed(
          2
        )}%). No growth possible.`
      );
      return;
    }

    // Compound growth with extra investments at frequency
    // We'll do monthly compounding for accuracy with extra contributions
    const periodsPerYear = 12;
    // const totalPeriods = term * periodsPerYear;

    // Convert netAnnualReturn to monthly rate
    const monthlyReturn = Math.pow(1 + netAnnualReturn, 1 / periodsPerYear) - 1;

    // Extra investment per period depends on frequency
    const extraPerPeriod = extraAmt / (periodsPerYear / freq);

    let portfolioValue = principal;
    const data: ProjectionRow[] = [];

    for (let year = 0; year <= term; year++) {
      // Record start balance at beginning of year
      const startBalance = portfolioValue;

      // Simulate 12 months growth and contributions
      for (let month = 1; month <= 12; month++) {
        // Apply growth
        portfolioValue = portfolioValue * (1 + monthlyReturn);

        // Add extra investment if month matches frequency
        if (
          extraFrequency === "monthly" ||
          (extraFrequency === "quarterly" && month % 3 === 0) ||
          (extraFrequency === "yearly" && month === 12)
        ) {
          portfolioValue += extraPerPeriod;
        }
      }

      // // Calculate CAGR % for the year (annualized growth from startBalance to endBalance)
      // const cagrPercent =
      //   startBalance === 0 ? 0 : (portfolioValue / startBalance - 1) * 100;

      data.push({
        year: startYearNum + year,
        startBalance,
        endBalance: portfolioValue,
        // cagrPercent,
      });
    }

    setProjectionData(data);
  };

  return (
    <main className="min-h-screen p-6 bg-gray-50 flex flex-col items-center">
      <h1 className="text-lg md:text-3xl font-black uppercase mb-8 bg-gradient-to-r from-indigo-500 via-pink-500 to-amber-500 text-transparent bg-clip-text">Stock Investment Calculator</h1>

      <Card className="max-w-2xl w-full p-6 mb-8">
        <CardHeader>
          <CardTitle>Input Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              calculateProjection();
            }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-6"
          >
            <div>
              <Label htmlFor="initialInvestment">
                Initial Investment Amount ($)
              </Label>
              <Input
                id="initialInvestment"
                type="number"
                min={0}
                step={100}
                value={initialInvestment}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setInitialInvestment(e.target.value)
                }
                required
              />
            </div>

            <div>
              <Label htmlFor="cagr">Annual Return (CAGR %)</Label>
              <Input
                id="cagr"
                type="number"
                min={0}
                step={0.01}
                value={cagr}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCagr(e.target.value)
                }
                required
              />
            </div>

            <div>
              <Label htmlFor="years">Investment Term (Years)</Label>
              <Input
                id="years"
                type="number"
                min={1}
                step={1}
                value={years}
                onChange={(e) => setYears(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="startYear">Starting Year</Label>
              <Input
                id="startYear"
                type="number"
                min={currentYear}
                max={currentYear + 100}
                step={1}
                value={startYear}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setStartYear(e.target.value)
                }
                required
              />
            </div>

            <div>
              <Label htmlFor="taxRate" className="flex items-center gap-1">
                Annual Tax Rate
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-slate-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Default New Zealand tax: 5% FDR × 28% PIR = 1.4%</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Input
                id="taxRate"
                type="number"
                min={0}
                max={1}
                step={0.001}
                value={taxRate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTaxRate(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="extraInvestment">
                Extra Investment Amount ($)
              </Label>
              <Input
                id="extraInvestment"
                type="number"
                min={0}
                step={50}
                value={extraInvestment}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setExtraInvestment(e.target.value)
                }
                required
              />
            </div>

            <div>
              <Label htmlFor="extraFrequency">Extra Investment Frequency</Label>
              <Select
                value={extraFrequency}
                onValueChange={(value: keyof typeof FREQUENCY_MAP) =>
                  setExtraFrequency(value)
                }
              >
                <SelectTrigger id="extraFrequency" className="w-full">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-2 flex justify-center mt-4">
              <Button type="submit" className="bg-indigo-500 transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-teal-200 hover:bg-teal-400">
                Calculate Projection
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {projectionData.length > 0 && (
        <Card className="max-w-2xl w-full overflow-auto">
          <CardHeader>
            <CardTitle>Projection Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full border-collapse border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border border-gray-300 px-4 py-2 text-left">
                    Year
                  </th>
                  <th className="border border-gray-300 px-4 py-2 text-right">
                    Start Balance
                  </th>
                  <th className="border border-gray-300 px-4 py-2 text-right">
                    End Balance
                  </th>
                  {/* <th className="border border-gray-300 px-4 py-2 text-right">
                    CAGR %
                  </th> */}
                </tr>
              </thead>
              <tbody>
                {projectionData.map(
                  ({ year, startBalance, endBalance }, idx) => (
                    <tr
                      key={year}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="border border-gray-300 px-4 py-2">
                        {year}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right">
                        {formatNZD(startBalance)}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right">
                        {formatNZD(endBalance)}
                      </td>
                      {/* <td className="border border-gray-300 px-4 py-2 text-right">
                        {cagrPercent.toFixed(2)}%
                      </td> */}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
