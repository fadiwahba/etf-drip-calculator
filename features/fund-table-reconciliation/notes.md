# fund-table-reconciliation — notes

## Status: BLOCKED before implementation

No code was written. `spec.md`'s numeric Acceptance Criteria contradict the data source it is
supposed to be built from, and the Coder Guardrails require raising a blocker rather than picking
one side silently: "If a number in this spec disagrees with that doc, stop and raise a blocker; do
not pick one."

## What was built

Nothing. No `data/funds.json`, `lib/funds.ts`, or `lib/__tests__/funds.test.ts` were created.
`data/dividend_portfolio.json` was not deleted. No RED tests were written because the fixture
values they'd assert are the disputed ones.

## The conflict

`docs/fund-data-2026-08-07.md` states its own supersession rule: the section headed
"FINAL — all six, primary source, 2026-08-07" (line 205) "Supersedes every table above it in the
file." Under that section:

| Ticker | totalReturnAnnualised | dividendYield | expenseRatio |
|---|---|---|---|
| SCHD | 0.1237 | 0.0325 | 0.0006 |
| DGRO | 0.1338 | 0.0198 | 0.0008 |
| VIG  | 0.1299 | 0.0144 | 0.0004 |
| VYMI | 0.1098 | **null** | 0.0007 |
| EUFN | 0.1436 | 0.0305 | 0.0049 |
| FDVV | **null** | 0.0259 | not stated ("—") |

Derived `priceGrowth` per the FINAL section's own arithmetic: SCHD 0.0912, DGRO 0.1140, VIG 0.1155,
EUFN 0.1131, VYMI **null**, FDVV **null**.

`spec.md` instead hard-codes an earlier pass from the same doc (the pre-FINAL "secondary source,
AAII" table, doc §2/§3):

- **AC3** — SCHD `0.127 / 0.0313 / 0.0006`; FDVV `0.1388 / 0.0277 / 0.0015`;
  VYMI `0.110 / 0.0349 / 0.0007`; DGRO `0.134 / 0.0189 / 0.0008`;
  EUFN `0.145 / 0.0397 / 0.0049`; VIG `0.130 / 0.0150 / 0.0004`.
- **AC2** — `priceGrowth`: SCHD 0.0957, FDVV 0.1111, VYMI 0.0751, DGRO 0.1151, EUFN 0.1053,
  VIG 0.1150.
- **AC8** — FDVV `totalReturnIsSinceInception === true`, window ≈ 9.9 — implying FDVV has a
  non-null `totalReturnAnnualised`/`priceGrowth`.

For VYMI's `dividendYield` and FDVV's `totalReturnAnnualised`/`priceGrowth`, the spec's ACs require
**non-null** values while the FINAL section (and the dispatch instructions) require the same
fields to be **`null`** — the exact null-vs-unverified distinction this slice exists to fix. A
test suite satisfying spec AC2/AC3/AC8 cannot simultaneously satisfy the FINAL section's null
requirement for those two rows; the two sources are mutually exclusive on this point, not just
differently rounded.

## Guardrail invoked

Coder Guardrails, `spec.md` line 132-134: "If a figure you need is not there, it is `null` — do
not invent one... If a number in this spec disagrees with that doc, stop and raise a blocker; do
not pick one." That is what happened here — reconciling silently would mean either violating the
dispatch instruction (use only the FINAL section) or violating the spec's literal ACs.

## How to verify

Not applicable — no code was written to verify. To unblock: `spec.md`'s numeric ACs (2, 3, 8, and
the FDVV/VYMI null-handling implied by AC1) need to be regenerated against the FINAL section of
`docs/fund-data-2026-08-07.md` (line 205 onward), or the orchestrator needs to state explicitly
which table in that doc is authoritative despite its own stated supersession rule.

## TDD

Not started. No RED tests were written, because the fixture values an AC-faithful RED test would
assert (spec AC2/AC3/AC8) are the disputed values themselves — writing them would bake in one side
of the conflict without authorization.
