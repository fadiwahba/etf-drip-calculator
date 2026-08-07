# CLAUDE.md — ETF Investment Calculator (NZ)

Guidance for Claude Code working in this repository. Keep this file lean; depth lives in
`.claude/rules/`.

## What this is, and why correctness is the bar

A New Zealand DRIP / investment projection calculator. **Fady uses its output to make real
investment decisions about his own money.** A wrong number here does not throw an exception — it
returns something plausible and gets acted on. Treat "looks reasonable" as unverified.

**Read before touching any calculation:**

- @.claude/rules/nz-tax.md — the NZ tax regime (FIF/FDR/CV, PIE vs direct, PIR, US WHT). The
  authority on tax. NZ's rules are genuinely unusual; do not reason from general/US intuitions.
- @.claude/rules/calculator-invariants.md — the maths rules (compounding, fee drag, dividend growth,
  double-counting, reported metrics). Every rule there was written because it was found violated.

## Standing findings (2026-08-06 audit — see `docs/AUDIT-2026-08-06.md`)

The calculation layer is **known to contain confirmed defects**. Until they are fixed, treat any
output as provisional and do not add features on top of the broken engines.

- **Tax is applied on the wrong base** in the projection calculator — an FDR-derived rate (a % of
  *portfolio value*) applied to *dividends*, understating tax ~100×.
- **No FIF modelling anywhere**, despite it being the dominant NZ rule for the US-domiciled ETFs
  this project is about.
- **Four components implement four different tax models.** None is authoritative.
- **Dividend growth double-compounds with price growth**; **fee drag does not compound**;
  **an off-by-one** compounds `term + 1` years.

The single highest-value change is a **shared tax/fee engine** that every calculator calls. Do not
fix these one component at a time — that is how the four divergent models happened.

## Domain vocabulary

**DRIP** — dividends automatically buy more shares instead of paying cash. **FIF** — NZ's Foreign
Investment Fund regime, taxing a *deemed* return on foreign holdings above a cost threshold.
**FDR** — Fair Dividend Rate, the 5%-of-opening-value deemed income method. **CV** — Comparative
Value, the actual-gain alternative; an individual may use the lower of the two. **PIE** —
NZ-domiciled fund taxed at a capped **PIR**. **W-8BEN** — the form that cuts US withholding on
dividends from 30% to 15%.

## Stack

Next.js 15 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind + shadcn/ui
(new-york, zinc, lucide) · Chart.js **and** Recharts (both present — consolidating is an open
question) · react-hook-form · Vercel Analytics. Package manager: **pnpm**.

```bash
pnpm dev      # dev server (Turbopack)
pnpm build    # production build
pnpm lint     # ESLint — must pass clean
```

There is **no test runner installed.** Adding one is a prerequisite for trusting any fix to the
calculation layer, not a nice-to-have.

## Conventions

- Path alias `@/*` → project root. Shared types in root `types.ts`.
- Calculator components are client components (`"use client"`); `useMemo` for the projection loops,
  `useCallback` for anything in a `useEffect` dependency array.
- ESLint must pass with **zero** warnings before committing.
- shadcn/ui components in `components/ui/`; calculators in `components/`.
- **Comments explain *why*, not *what*** — a tax rule, a chosen convention, a source citation.
  Every hardcoded rate carries the IRD URL it came from and the date checked.

## Working style here

- **Verify, don't assume.** Check a claim against the code before acting on it — including claims in
  this file and in audit documents. State assumptions explicitly; if a tax question has more than
  one defensible reading, ask rather than pick silently.
- **Never state a tax rate or threshold from memory.** Look it up at ird.govt.nz and cite it.
- **Don't record derivable state here.** Which component `app/page.tsx` renders, what's commented
  out, how many files exist — all of that changes and a stale note is worse than none. This file
  holds decisions, domain rules and gotchas only.
- Lifecycle for changes is **lean-spec** (`/lean-spec:init` → `plan` → `spec` → `implement` →
  `review` → `close`). The mutating phase skills are human-invoked by design — never work around
  that.
