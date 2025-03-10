"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Frequency = "Monthly" | "Quarterly" | "Annually";

const defaultValues: {
  name: string;
  initialInvestment: number;
  sharePrice: number;
  dividendAmount: number;
  dividendFrequency: Frequency;
  dividendGrowthRate: number;
  sharePriceGrowth: number;
  principalLoanAmountInvested: number;
  extraInvestment: number;
  extraInvestFrequency: Frequency;
  lengthOfInvestment: number;
} = {
  name: "VGT",
  initialInvestment: 1000,
  sharePrice: 627,
  dividendAmount: 1,
  dividendFrequency: "Quarterly",
  dividendGrowthRate: 0,
  sharePriceGrowth: 18,
  principalLoanAmountInvested: 0,
  extraInvestment: 0,
  extraInvestFrequency: "Monthly",
  lengthOfInvestment: 30,
};

const ETFCalculator = () => {
  const [formData, setFormData] = useState(defaultValues);
  const [results, setResults] = useState<
    { year: number; balance: number; shares: number; dividends: number }[]
  >([]);

  const calculateInvestment = () => {
    let currentBalance = formData.initialInvestment;
    let shares = formData.initialInvestment / formData.sharePrice;
    const results = [];

    const dividendsPerYear = {
      Monthly: 12,
      Quarterly: 4,
      Annually: 1,
    };

    const extraInvestmentMultiplier = {
      Monthly: 12,
      Quarterly: 4,
      Annually: 1,
    };

    for (let year = 1; year <= formData.lengthOfInvestment; year++) {
      // Calculate dividends
      const yearlyDividend =
        shares *
        formData.dividendAmount *
        dividendsPerYear[formData.dividendFrequency] *
        (1 + formData.dividendGrowthRate / 100) ** (year - 1);

      // Calculate extra investments
      const yearlyExtraInvestment =
        formData.extraInvestment *
        extraInvestmentMultiplier[formData.extraInvestFrequency];

      // Add extra shares from reinvested dividends and extra investments
      const newSharePrice =
        formData.sharePrice * (1 + formData.sharePriceGrowth / 100) ** year;

      shares += (yearlyDividend + yearlyExtraInvestment) / newSharePrice;

      // Calculate new balance
      currentBalance = shares * newSharePrice;

      results.push({
        year,
        balance: currentBalance,
        shares,
        dividends: yearlyDividend,
      });
    }

    setResults(results);
  };

  const handleInputChange = (
    field: keyof typeof formData,
    value: string | number
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: typeof prev[field] === "number" ? Number(value) : value,
    }));
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>ETF Investment Calculator</CardTitle>
          <CardDescription>
            Calculate your potential ETF investment returns
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">ETF Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Initial Investment ($)
                </label>
                <Input
                  type="number"
                  value={formData.initialInvestment}
                  onChange={(e) =>
                    handleInputChange("initialInvestment", e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Share Price ($)</label>
                <Input
                  type="number"
                  value={formData.sharePrice}
                  onChange={(e) =>
                    handleInputChange("sharePrice", e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Dividend Amount ($)
                </label>
                <Input
                  type="number"
                  value={formData.dividendAmount}
                  onChange={(e) =>
                    handleInputChange("dividendAmount", e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Dividend Frequency
                </label>
                <Select
                  value={formData.dividendFrequency}
                  onValueChange={(value) =>
                    handleInputChange("dividendFrequency", value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="Annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Share Price Growth (%)
                </label>
                <Input
                  type="number"
                  value={formData.sharePriceGrowth}
                  onChange={(e) =>
                    handleInputChange("sharePriceGrowth", e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Extra Investment ($)
                </label>
                <Input
                  type="number"
                  value={formData.extraInvestment}
                  onChange={(e) =>
                    handleInputChange("extraInvestment", e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Extra Investment Frequency
                </label>
                <Select
                  value={formData.extraInvestFrequency}
                  onValueChange={(value) =>
                    handleInputChange("extraInvestFrequency", value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="Annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Length of Investment (Years)
                </label>
                <Input
                  type="number"
                  value={formData.lengthOfInvestment}
                  onChange={(e) =>
                    handleInputChange("lengthOfInvestment", e.target.value)
                  }
                />
              </div>
            </div>

            <Button type="button" onClick={calculateInvestment}>
              Calculate
            </Button>
          </form>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Growth Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={results}
                    margin={{ top: 20, right: 40, left: 40, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="year"
                      label={{ value: "Year", position: "bottom" }}
                    />
                    <YAxis
                      tickFormatter={(value) => formatCurrency(value)}
                    //   label={{
                    //     value: "Portfolio Value",
                    //     angle: 0,
                    //     position: "insideLeft",
                    //   }}
                    />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      labelFormatter={(year) => `Year ${year}`}
                    />
                    <Bar
                      dataKey="balance"
                      fill="#3b82f6"
                      name="Portfolio Value"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Investment Projection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Year</th>
                      <th className="text-left p-2">Balance</th>
                      <th className="text-left p-2">Shares</th>
                      <th className="text-left p-2">Yearly Dividends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.year} className="border-b">
                        <td className="p-2">{row.year}</td>
                        <td className="p-2">
                          $
                          {row.balance.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-2">
                          {row.shares.toLocaleString(undefined, {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="p-2">
                          $
                          {row.dividends.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ETFCalculator;
