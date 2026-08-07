# ETF Investment Calculator

A New Zealand DRIP (dividend reinvestment) and investment projection calculator for analysing long-term growth scenarios with NZ-specific tax treatment. Built to help NZ investors model portfolio growth under different contribution schedules and reinvestment strategies.

## What it does

The calculator simulates long-term investment growth for ETF portfolios, with forms to set:
- Initial capital and additional periodic contributions
- Contribution frequency (weekly through annual)
- Projection timeframe (years)
- DRIP toggle (reinvest dividends or take as cash)

Output includes projected portfolio values, CAGR, and visual projections by component. Retirement analysis mode is the currently active calculator.

## Who it's for

NZ residents investing in ETFs, particularly US-domiciled holdings (VOO, VTI, SCHD, etc.) subject to FIF tax rules and dividend withholding. The calculator attempts to model NZ's foreign investment fund (FIF) regime and Prescribed Investor Rate (PIR) taxes.

## Status: Provisional outputs

**The calculation layer contains confirmed defects.** An independent audit on 2026-08-06 found critical bugs in the DRIP compounding logic, NZ tax treatment, and fee drag modelling. Outputs should be treated as indicative only, pending remediation.

See the full audit: [docs/AUDIT-2026-08-06.md](docs/AUDIT-2026-08-06.md)

## Tech stack

- **Framework:** Next.js 15.1.5 (App Router, Turbopack)
- **UI:** React 19, TypeScript (strict), Tailwind CSS + shadcn/ui (new-york / zinc)
- **Charts:** Chart.js + react-chartjs-2, Recharts
- **Forms:** react-hook-form
- **Analytics:** Vercel Analytics
- **Package manager:** pnpm
- **Linting:** ESLint

## Getting started

### Prerequisites

- Node.js 20.19+ (Vitest 4 / Vite 8 require `^20.19 || >=22.12`)
- pnpm (install via `npm install -g pnpm`)

### Installation

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Available scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Dev server with Turbopack (fast refresh) |
| `pnpm build` | Production build |
| `pnpm start` | Run production build locally |
| `pnpm lint` | Run ESLint (must pass before commit) |
| `pnpm test` | Run the Vitest suite once |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Coverage report (scoped to `lib/`) |

Note: Vitest is the test runner. TDD is mandatory for anything under `lib/` — see `docs/CONSTITUTION.md`.

## Project structure

```
app/
  page.tsx              # Home (renders RetirementAnalysis component)
  etf-comparison/       # ETF comparison route (separate calculator)
    page.tsx
components/
  ui/                   # shadcn/ui components (Card, Badge, etc.)
  RetirementAnalysis.tsx     # Main active calculator
  DripCalculator.tsx         # Dividend reinvestment model
  InvestmentProjectionCalculator.tsx  # Projection engine
  [...other calculators, mostly commented out or unused]
data/
  etfs.json             # ETF reference data
docs/
  AUDIT-2026-08-06.md   # Correctness audit and remediation plan
lib/                    # Shared utilities
types.ts                # Shared TypeScript types
```

## For contributors

Before working on calculations:

1. Read **[CLAUDE.md](./CLAUDE.md)** — project overview and correctness requirements
2. Read **[.claude/rules/nz-tax.md](./.claude/rules/nz-tax.md)** — NZ tax regime (FIF, PIE, PIR, withholding)
3. Read **[.claude/rules/calculator-invariants.md](./.claude/rules/calculator-invariants.md)** — maths rules and defect classes

The code follows strict conventions:
- ESLint must pass with zero warnings
- Comments explain *why*, not *what*; all tax rates cite IRD sources with verification dates
- Client components use `useMemo` for projection loops
- Never state tax rates from memory — verify at ird.govt.nz

## Known limitations

- No FX modelling; no brokerage or platform fees modelled
- Four divergent tax models across different components (consolidated fix needed)
- Test coverage is limited to `lib/nzTax.ts`; the projection and UI layers have none yet
- Silent zero-coercion of empty form fields (inputs should validate)
- Dead code present (InvestmentCalculator, DetailsTable, GrowthColumnChart unused)

See the audit for detailed findings and remediation priority.
