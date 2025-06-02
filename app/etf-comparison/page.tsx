// app/etf-projection/page.tsx
"use client";

import { useState, useEffect, FormEvent } from "react";
import etfsData from "@/data/etfs.json"; // Local JSON file with ETF data
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface ETF {
  ticker: string;
  sharePrice: number;
  oneYReturn: number;
  threeYReturn: number;
  fiveYReturn: number;
  tenYReturn: number;
  avgReturn: number;
  dividendYield: number; // expressed as decimal (e.g. 3% => 0.03)
  riskRating: number;
}

interface ETFWithGrowth extends ETF {
  portfolioGrowth: number;
  yearlyValues: number[];
}

// Map contribution frequency string to number of contributions per year
const freqMap: Record<string, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

// Simulation function: using discrete periods, we add contributions at each period.
function simulateGrowth(
  principal: number,
  annualRate: number,
  years: number,
  contribution: number,
  freq: number
): { finalValue: number; yearlyValues: number[] } {
  const totalPeriods = years * freq;
  const periodRate = annualRate / freq;
  let value = principal;
  // Record value at each year-end (every freq periods)
  const yearlyValues: number[] = [principal];
  for (let i = 1; i <= totalPeriods; i++) {
    value = value * (1 + periodRate) + contribution;
    if (i % freq === 0) {
      yearlyValues.push(value);
    }
  }
  return { finalValue: value, yearlyValues };
}

export default function ETFProjectionPage() {
  // Form state
  const [initialCapital, setInitialCapital] = useState(10000);
  const [years, setYears] = useState(10);
  const [drip, setDrip] = useState(true);
  const [additionalContribution, setAdditionalContribution] = useState(0);
  const [contributionFrequency, setContributionFrequency] = useState("monthly");

  // Computed results state
  const [computedTableData, setComputedTableData] = useState<ETFWithGrowth[]>(
    []
  );
  const [chartDatasets, setChartDatasets] = useState<{
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    tension: number;
  }[]>([]);
  const [chartLabels, setChartLabels] = useState<string[]>([]);

  // Function to recalc table and chart data
  function recalcProjections() {
    const freq = freqMap[contributionFrequency];
    // For each ETF, compute effective rate = avgReturn + (drip ? dividendYield : 0)
    const table = etfsData.map((etf: ETF) => {
      const effectiveRate = etf.avgReturn + (drip ? etf.dividendYield : 0);
      const { finalValue, yearlyValues } = simulateGrowth(
        initialCapital,
        effectiveRate,
        years,
        additionalContribution,
        freq
      );
      return {
        ...etf,
        portfolioGrowth: finalValue,
        yearlyValues,
      } as ETFWithGrowth;
    });

    // Sort table data by final portfolio value descending
    table.sort((a, b) => b.portfolioGrowth - a.portfolioGrowth);
    setComputedTableData(table);

    // Prepare chart labels (year 0 to year N)
    const labels = Array.from({ length: years + 1 }, (_, i) => i.toString());
    setChartLabels(labels);

    // For each ETF, create a dataset from the yearlyValues.
    const datasets = table.map((etf: ETFWithGrowth, index: number) => {
      return {
        label: etf.ticker,
        data: etf.yearlyValues.map((v) => Math.round(v)),
        borderColor: getColor(index),
        backgroundColor: getColor(index, 0.5),
        tension: 0.3,
      };
    });
    setChartDatasets(datasets);
  }

  // On first render, compute default results.
  useEffect(() => {
    recalcProjections();
  }, [recalcProjections]);

  // Form submission handler: recalc and update results.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    recalcProjections();
  }

  // Simple function to generate colors for chart datasets.
  function getColor(index: number, opacity: number = 1) {
    const colors = [
      `rgba(255, 99, 132, ${opacity})`,
      `rgba(54, 162, 235, ${opacity})`,
      `rgba(255, 206, 86, ${opacity})`,
      `rgba(75, 192, 192, ${opacity})`,
      `rgba(153, 102, 255, ${opacity})`,
    ];
    return colors[index % colors.length];
  }

  const chartData = {
    labels: chartLabels,
    datasets: chartDatasets,
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: "top" as const },
      title: {
        display: true,
        text: `Portfolio Growth Projection (0 to ${years} Years)`,
      },
    },
  };

  return (
    <div className="container mx-auto p-8">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-bold mb-4">
              ETF Portfolio Growth Projection
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Form */}
          <form className="space-y-4 mb-6" onSubmit={handleSubmit}>
            <div className="flex flex-col md:flex-row space-y-4 md:space-x-4 md:items-end md:justify-between md:flex-wrap">
              <div className="flex-1">
                <label htmlFor="initialCapital" className="block font-medium">
                  Initial Capital (USD)
                </label>
                <input
                  id="initialCapital"
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                />
              </div>

              <div className="flex-1">
                <label htmlFor="years" className="block font-medium">
                  Projection Years
                </label>
                <input
                  id="years"
                  type="number"
                  value={years}
                  onChange={(e) => setYears(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                />
              </div>

              <div className="flex-1">
                <label
                  htmlFor="additionalContribution"
                  className="block font-medium"
                >
                  Additional Contribution
                </label>
                <input
                  id="additionalContribution"
                  type="number"
                  value={additionalContribution}
                  onChange={(e) =>
                    setAdditionalContribution(Number(e.target.value))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                />
              </div>

              <div className="flex-1">
                <label
                  htmlFor="contributionFrequency"
                  className="block font-medium"
                >
                  Contribution Frequency
                </label>
                <select
                  id="contributionFrequency"
                  value={contributionFrequency}
                  onChange={(e) => setContributionFrequency(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm"
                >
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
            </div>

            <div className="flex items-center">
              <input
                id="drip"
                type="checkbox"
                checked={drip}
                onChange={(e) => setDrip(e.target.checked)}
                className="mr-2"
              />
              <label htmlFor="drip" className="font-medium">
                DRIP (Dividends Reinvested)
              </label>
            </div>

            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Submit
            </button>
          </form>

          {/* Results Table */}
          <table className="min-w-full divide-y divide-gray-200 border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">ETF Name / Ticker</th>
                <th className="px-4 py-2 text-right">Share Price (USD)</th>
                <th className="px-4 py-2 text-right">1Y Return</th>
                <th className="px-4 py-2 text-right">3Y Return</th>
                <th className="px-4 py-2 text-right">5Y Return</th>
                <th className="px-4 py-2 text-right">10Y Return</th>
                <th className="px-4 py-2 text-right">Avg Return</th>
                <th className="px-4 py-2 text-right">Risk Rating</th>
                <th className="px-4 py-2 text-right">
                  Portfolio Growth ({years}Y)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {computedTableData.map((etf: ETFWithGrowth) => (
                <tr
                  key={etf.ticker}
                  className="odd:bg-white even:bg-gray-50 hover:bg-gray-100"
                >
                  <td className="px-4 py-2">{etf.ticker}</td>
                  <td className="px-4 py-2 text-right">
                    ${etf.sharePrice.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(etf.oneYReturn * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(etf.threeYReturn * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(etf.fiveYReturn * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(etf.tenYReturn * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Badge variant="default">
                      {(etf.avgReturn * 100).toFixed(1)}%
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right">{etf.riskRating}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="font-bold text-green-600 text-lg">
                      ${etf.portfolioGrowth.toFixed(0)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Line Chart */}
          <div className="mt-8">
            <Line data={chartData} options={chartOptions} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
