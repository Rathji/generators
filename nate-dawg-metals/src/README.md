# Scrap & Metal Recycling — Profitability Calculator

A single-page profitability calculator for a small metal recycling / scrap business.

## What it does

- **Run calculator** — enter the metals picked up on a job (weight, the price you *paid* the business for the scrap, and the price your *yard* pays you) plus trip costs (distance, fuel, vehicle wear, labour hours, tool maintenance, tolls/scale/tip fees). It computes sale value, purchase cost, gross margin, operating profit, income tax, **net profit**, profit-per-hour, margin %, and cash needed to buy the metal.
- **Price list & rates** — editable per-pound sale prices for ~28 common metals (copper, aluminium, brass, steel, stainless, lead, zinc, tin, motors, radiators…), plus standing defaults: fuel $/gal, truck MPG, vehicle $/mile, labour $/hr, tool budget/run, income tax %, and monthly overhead (rent, insurance, licensing).
- **Run history** — save runs, see a period summary (totals, est. overhead applied over the date span, net after overhead, avg profit/hr), delete runs.

## Architecture

- All logic lives in `index.html` (CSS + a single classic `<script>`). `main.pjs` only sets the page title.
- State (prices, rates, current in-progress run, saved history) is persisted to `localStorage` under key `scrapProfitCalcState_v1` — auto-saved on every input change.
- Core math is `calcRun(run, rates)` in `index.html`. Per-metal line = weight × (sell − buy). Fuel = distance ÷ MPG × $/gal when "estimate fuel" is on, else a manual $ amount. Tax = income-tax% × operating profit (only when positive). Everything is itemized in the results panel.
- Responsive: two-column desktop layout (sticky results panel); below 700px the metal and history tables switch to labelled card stacks.

## Notes / gotchas

- Prices are starting points, not quotes — commodity scrap values move; the note in the app says to verify with the yard.
- Sold weight assumes the yard pays for what's weighed (deduct contamination yourself).
- The manual "Fuel cost ($)" field is ignored while "Estimate fuel from distance" is checked; the computed value is shown there instead.
- When adding a metal from the price list, buy price defaults to 65% of sale price as a negotiation starting guess — always verify against the actual deal.
