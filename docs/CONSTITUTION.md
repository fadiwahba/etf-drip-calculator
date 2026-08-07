# CONSTITUTION — ETF Investment Calculator (NZ)

Injected into every agent dispatch. Kept short deliberately.

## Stack

Next.js 15.1.5 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind + shadcn/ui
(new-york, zinc, lucide) · Chart.js + Recharts · **pnpm** · **Vitest** (`pnpm test`).
Path alias `@/*` → project root. Shared types in root `types.ts`.

## Principles

1. **The failure mode is a wrong number, not a crash.** A projection always returns something
   plausible; nobody notices it's wrong. Prefer failing loudly over coercing bad input to zero.
   Fady acts on this output with real money.
2. **One engine per concern.** All tax logic lives in `lib/nzTax.ts`; all projection maths in one
   place. Per-component maths is banned — that is exactly how four contradictory tax models shipped.
3. **Never state a tax rate or threshold from memory.** Verify at ird.govt.nz, cite the URL and the
   date checked in a comment beside the value.
4. **`.claude/rules/nz-tax.md` and `.claude/rules/calculator-invariants.md` are binding.** Read both
   before touching any calculation. The 16 invariants each exist because the rule was found violated.
5. **NZ taxes a deemed return, not received dividends.** `tax = dividends × rate` is wrong by
   construction for a foreign holding above the threshold, whatever rate is used.
6. **Price return = total return − dividend yield**, derived in one place. Never add a yield on top of
   a total return. Long-run assumptions use the **10-year CAGR**, never trailing 1-year.
7. **Report in NZD.** The FIF threshold is a statutory NZ$50,000 and must not drift with FX.
8. **Provenance or `null`.** Every fund figure carries `asOf` and `source`. Unverifiable means `null`,
   never `0` — zero-as-unknown is a bug this project has already been bitten by.
9. **Comments explain why, not what** — a tax rule, a chosen convention, a citation.
10. **Don't record derivable state in docs.** Which component renders, what's commented out — it rots.
    Docs hold decisions, domain rules and gotchas only.

## Delegation

`spec` → opus/high · `implement` → sonnet/medium · `review` → opus/high · `plan` → session.
The agent that writes code never reviews it. Reviewer verdict `APPROVE` is required to close;
`BLOCKED` stops the line and escalates to Fady.

## Quality Bars

- **TDD mandatory for `lib/`** — RED before GREEN, every slice. Money-maths tests use hand-computed
  fixtures; each tax test names the IRD rule it encodes.
- **UI-only slices may relax it** via `bin/lean-spec advance --no-tdd` with a logged reason. Do not
  block a UI slice on a test that measures nothing.
- `pnpm lint` clean (zero warnings) · `pnpm build` succeeds · `pnpm test` green — all three before close.
- Any change to a calculation ships a **before/after comparison**: these numbers may already have been
  planned around.
- Validate inputs and surface errors. `NaN`/`Infinity` must never reach the UI.

## Process

One slice at a time: `spec` → `implement` → `review` → (`fix` loop) → `close`. No upfront
decomposition. Slice order is set in `docs/PRD.md`; the shared tax engine comes first because three
CRITICAL defects collapse into it, and building UI on wrong maths wastes the UI work.

Background and rationale (read once, don't re-litigate): `docs/AUDIT-2026-08-06.md` (confirmed
defects) and `docs/PRODUCT-NOTES.md` (every design decision already made).

## Non-Goals

Not tax advice. NZ tax residents only — no second jurisdiction. No capital-drawdown model in the
first pass (dividends-only). No live market data feed, account linking or brokerage integration.
No trader-intent CGT. Not a rebuild — fix the calculation layer on the existing codebase.
