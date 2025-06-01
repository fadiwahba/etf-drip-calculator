import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
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
import { formatCurrency } from "@/lib/utils";
import { CalculatorInputData, ResultItem } from "@/types";

interface GrowthColumnChartProps {
  formData: CalculatorInputData;
  results: ResultItem[];
}

const GrowthColumnChart = ({ formData, results }: GrowthColumnChartProps) => {
  return (
    <div>
      <Card className="mb-8 md:p-8 shadow-lg">
        <CardHeader>
          <CardTitle>
            Portfolio Growth Projection - {formData.tickerSymbol}
          </CardTitle>
          <CardDescription>
            {formData.enableDRIP
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
                  formatter={(value) => {
                    const numValue =
                      typeof value === "number"
                        ? value
                        : parseFloat(
                            String(Array.isArray(value) ? value[0] : value)
                          );
                    return formatCurrency(numValue);
                  }}
                  labelFormatter={(value) => `Year ${value}`}
                />
                <Legend />
                {/* Stacked order is important: reinvested dividends (value), then total portfolio */}
                {formData.enableDRIP && (
                  <Bar
                    dataKey="reinvestedDividendsValue"
                    name="Reinvested Dividends (Current Value)"
                    fill="#fcac50"
                  />
                )}
                <Bar
                  dataKey="portfolioValue"
                  name="Portfolio Total Value"
                  fill="#ff8080"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GrowthColumnChart;
