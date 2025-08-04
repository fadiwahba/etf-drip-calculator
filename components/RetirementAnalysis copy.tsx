'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Home, Calculator, TrendingUp } from 'lucide-react';

export default function RetirementAnalysis() {
  // Property inputs
  const [housePrice, setHousePrice] = useState(1130000);
  const [depositPct, setDepositPct] = useState(10);
  const [loanTerm, setLoanTerm] = useState(30);
  const [mortgageRate, setMortgageRate] = useState(6);
  const [purchaseYear, setPurchaseYear] = useState(new Date().getFullYear());
  const [taxes, setTaxes] = useState(3000);
  const [insurance, setInsurance] = useState(1500);
  const [otherExpenses, setOtherExpenses] = useState(1000);

  // Investment inputs
  const [invTerm, setInvTerm] = useState(15);
  const [cagr, setCagr] = useState(10);
  const [expenseRatio, setExpenseRatio] = useState(0.2);
  const [taxRate, setTaxRate] = useState(28);
  const [extraContrib, setExtraContrib] = useState(0);

  interface Results {
    depositAmt: number;
    principal: number;
    monthlyPayment: number;
    timeline?: { year: number; balance: number }[];
  }

  // Computed state
  const [results, setResults] = useState<Results>({ depositAmt: 0, principal: 0, monthlyPayment: 0 });

  const calculateMonthlyPayment = (principal: number, annualRate: number, years: number) => {
    const r = annualRate / 100 / 12;
    const n = years * 12;
    return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) || 0;
  };

  const runCalculations = () => {
    const depositAmt = housePrice * (depositPct / 100);
    const principal = housePrice - depositAmt;
    const monthlyPayment = calculateMonthlyPayment(principal, mortgageRate, loanTerm);

    // Simple investment projection
    const monthlyReturnRate = cagr / 100 / 12;
    let balance = 0;
    const contributions = extraContrib;
    const timeline: { year: number; balance: number }[] = [];
    for (let year = 1; year <= invTerm; year++) {
      for (let m = 0; m < 12; m++) {
        balance = balance * (1 + monthlyReturnRate);
        balance += contributions;
      }
      timeline.push({ year: purchaseYear + year, balance });
    }

    setResults({ depositAmt, principal, monthlyPayment, timeline });
  };

  useEffect(() => {
    runCalculations();
  }, [housePrice, depositPct, loanTerm, mortgageRate, purchaseYear, taxes, insurance, otherExpenses, invTerm, cagr, expenseRatio, taxRate, extraContrib]);

  return (
    <div className="space-y-8 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home /> Mortgage & Investment Calculator
          </CardTitle>
          <CardDescription>Adjust inputs below to model different scenarios</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="property" className="space-y-4">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="property">Property Inputs</TabsTrigger>
              <TabsTrigger value="investment">Investment Inputs</TabsTrigger>
            </TabsList>

            <TabsContent value="property" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>House Price (NZD)</Label>
                  <Input type="number" value={housePrice} onChange={e => setHousePrice(+e.target.value)} />
                </div>
                <div>
                  <Label>Deposit (%)</Label>
                  <Input type="number" value={depositPct} onChange={e => setDepositPct(+e.target.value)} />
                </div>
                <div>
                  <Label>Loan Term (years)</Label>
                  <Input type="number" value={loanTerm} onChange={e => setLoanTerm(+e.target.value)} />
                </div>
                <div>
                  <Label>Mortgage Rate (%)</Label>
                  <Input type="number" value={mortgageRate} onChange={e => setMortgageRate(+e.target.value)} />
                </div>
                <div>
                  <Label>Purchase Year</Label>
                  <Input type="number" value={purchaseYear} onChange={e => setPurchaseYear(+e.target.value)} />
                </div>
                <div>
                  <Label>Property Taxes (annual)</Label>
                  <Input type="number" value={taxes} onChange={e => setTaxes(+e.target.value)} />
                </div>
                <div>
                  <Label>Insurance (annual)</Label>
                  <Input type="number" value={insurance} onChange={e => setInsurance(+e.target.value)} />
                </div>
                <div>
                  <Label>Other Expenses (annual)</Label>
                  <Input type="number" value={otherExpenses} onChange={e => setOtherExpenses(+e.target.value)} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="investment" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Investment Term (years)</Label>
                  <Input type="number" value={invTerm} onChange={e => setInvTerm(+e.target.value)} />
                </div>
                <div>
                  <Label>Expected Return (CAGR %)</Label>
                  <Input type="number" value={cagr} onChange={e => setCagr(+e.target.value)} />
                </div>
                <div>
                  <Label>Expense Ratio (%)</Label>
                  <Input type="number" step="0.01" value={expenseRatio} onChange={e => setExpenseRatio(+e.target.value)} />
                </div>
                <div>
                  <Label>Taxes % (FIF)</Label>
                  <Input type="number" value={taxRate} onChange={e => setTaxRate(+e.target.value)} />
                </div>
                <div>
                  <Label>Extra Contributions (monthly)</Label>
                  <Input type="number" value={extraContrib} onChange={e => setExtraContrib(+e.target.value)} />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Button className="mt-6 w-full" onClick={runCalculations}>
            Recalculate
          </Button>

          {/* Display Results */}
          {results.monthlyPayment !== undefined && (
            <div className="mt-8 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Calculator /> Mortgage Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p>Deposit Amount: NZD {results.depositAmt.toFixed(0)}</p>
                  <p>Principal: NZD {results.principal.toFixed(0)}</p>
                  <p>Monthly Payment: NZD {results.monthlyPayment.toFixed(0)}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><TrendingUp /> Investment Projection</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {results.timeline?.map((t: { year: number; balance: number }, i: number) => (
                      <p key={i}>Year {t.year}: NZD {t.balance.toFixed(0)}</p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
