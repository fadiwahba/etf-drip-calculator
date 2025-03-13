"use client";

import { useState } from "react";
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

interface ETF {
  ticker: string;
  sharePrice: number;
  oneYReturn: number;
  threeYReturn: number;
  fiveYReturn: number;
  tenYReturn: number;
  avgReturn: number;
  dividendYieldPercent?: number;
  riskRating: number;
  portfolioGrowth?: number;
}

interface ETFWithGrowth extends ETF {
  portfolioGrowth: number;
}

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

export default function ETFProjectionPage() {
  // Form state
  const [initialCapital, setInitialCapital] = useState(10000);
  const [years, setYears] = useState(10);
  const [drip, setDrip] = useState(true);

  // Helper: Calculate the projected portfolio value using compound growth.
  // r is avgReturn as a decimal; years is the projection horizon.
  const calculateGrowth = (r: number, years: number) =>
    initialCapital * Math.pow(1 + r, years);

  // Prepare table data by mapping over the ETF JSON data.
  // Each ETF object is assumed to have: ticker, sharePrice, oneYReturn, threeYReturn,
  // fiveYReturn, tenYReturn, avgReturn, riskRating.
  // We then add a computed property: portfolioGrowth (for the 10-year projection).
  const tableData = etfsData
    .map((etf: ETF) => ({
      ...etf,
      portfolioGrowth: calculateGrowth(etf.avgReturn, years),
    }))
    .sort(
      (a: ETFWithGrowth, b: ETFWithGrowth) =>
        b.portfolioGrowth - a.portfolioGrowth
    );

  // Prepare data for the line chart.
  // For each ETF, we create data points for each year (0 to N) using the compound growth formula.
  const chartLabels = Array.from({ length: years + 1 }, (_, i) => i.toString());
  const chartDatasets = tableData.map((etf: ETF, index: number) => {
    const dataPoints = Array.from({ length: years + 1 }, (_, i) =>
      Math.round(initialCapital * Math.pow(1 + etf.avgReturn, i))
    );
    return {
      label: etf.ticker,
      data: dataPoints,
      borderColor: getColor(index),
      backgroundColor: getColor(index, 0.5),
      tension: 0.3,
    };
  });

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
        text: "Portfolio Growth Projection (0 to " + years + " Years)",
      },
    },
  };

  // Simple function to generate colors for the chart datasets.
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
          {/* Form inputs */}
          <form className="space-y-4 mb-6">
            <div>
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

            <div>
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
          </form>

          {/* Results Table */}
          <table className="md:min-w-full divide-y divide-gray-200 border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">ETF Name / Ticker</th>
                <th className="px-4 py-2 text-right">Share Price (USD)</th>
                <th className="px-4 py-2 text-right">1Y</th>
                <th className="px-4 py-2 text-right">3Y</th>
                <th className="px-4 py-2 text-right">5Y</th>
                <th className="px-4 py-2 text-right">10Y</th>
                <th className="px-4 py-2 text-right">Avg Return</th>
                <th className="px-4 py-2 text-right">Risk Rating</th>
                <th className="px-4 py-2 text-right">
                  Portfolio Growth ({years}Y)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tableData.map((etf: ETF) => (
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
                      ${etf.portfolioGrowth && etf.portfolioGrowth.toFixed(0)}
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
