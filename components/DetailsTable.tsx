import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { formatCurrency } from "@/lib/utils";
import { CalculatorInputData, ResultItem } from "@/types";

interface DetailsTableProps {
  formData: CalculatorInputData;
  results: ResultItem[];
}

const DetailsTable = ({ formData, results }: DetailsTableProps) => {
  return (
    <div>
      {" "}
      <Card className="mb-8 md:p-8 shadow-lg">
        <CardHeader>
          <CardTitle>Yearly Details - {formData.tickerSymbol}</CardTitle>
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
                  <th className="p-2 text-left border">
                    Dividend Income (Monthly)
                  </th>
                  <th className="p-2 text-left border">
                    Dividend Income (Yearly)
                  </th>
                  <th className="p-2 text-left border">Capital Appreciation</th>
                  {formData.enableDRIP && (
                    <>
                      <th className="p-2 text-left border">
                        Reinvested Dividends (Total)
                      </th>
                      <th className="p-2 text-left border">
                        Reinvested Dividends (Value)
                      </th>
                    </>
                  )}
                  <th className="p-2 text-left border">Total Investment</th>
                  <th className="p-2 text-left border">Portfolio Value</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr
                    key={row.year}
                    className="border-b even:bg-gray-50 odd:bg-white dark:even:bg-gray-800 dark:odd:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    <td className="p-2 border">{row.year}</td>
                    <td className="p-2 border">
                      {formatCurrency(row.dividendIncomeMonthly)}
                    </td>
                    <td className="p-2 border">
                      {formatCurrency(row.dividendIncomeYearly)}
                    </td>
                    <td className="p-2 border">
                      {formatCurrency(row.capitalAppreciation)}
                    </td>
                    {formData.enableDRIP && (
                      <>
                        <td className="p-2 border">
                          {formatCurrency(row.reinvestedDividendsTotal)}
                        </td>
                        <td className="p-2 border">
                          {formatCurrency(row.reinvestedDividendsValue)}
                        </td>
                      </>
                    )}
                    <td className="p-2 border">
                      {formatCurrency(row.totalInvestment)}
                    </td>
                    <td className="p-2 border">
                      {formatCurrency(row.portfolioValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2 text-sm text-gray-500 pt-2">
          <p>
            Note: The projection uses fixed rates and assumptions. Actual
            performance may vary.
          </p>
          {formData.enableDRIP && (
            <p>
              <strong>Reinvested Dividends (Total):</strong> The cumulative
              amount of dividends reinvested without considering growth.
            </p>
          )}
          {formData.enableDRIP && (
            <p>
              <strong>Reinvested Dividends (Value):</strong> The current value
              of all reinvested dividends, including compound growth.
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
};

export default DetailsTable;
