# Accuracy checklist

Each item is ticked only once it is fixed **and** re-verified against the source
system. Evidence is recorded beside each one.

## Worthy Products North (Odoo company 4)

- [x] **1. January 2026 is missing entirely — NZ$936,451.83 and 835 invoices.** FIXED.
  The invoice fetch carries `limit: 10000`. Odoo holds **10,870** matching
  invoices for 2026, and `account.move` returns newest first, so the 870 oldest
  were dropped. Reported FY-to-date revenue is understated by roughly NZ$936k.
  (2025 is a different story: Odoo genuinely holds nothing before April 2025, so
  Jan–Mar 2025 being empty is correct.)

- [ ] **2. No cost, so no gross profit and no margin.** Cost, Gross Profit and
  Margin columns are all NZ$0 / dash. Nothing supplies COGS for Odoo.

- [ ] **3. No discounts.** Total Discounts is never populated.

- [ ] **4. New customers are inferred from the partner's `create_date`,** which is
  when the contact record was made, not when they first bought.

## Worthy Oceania (Odoo company 1)

- [ ] **5. Same as items 2, 3 and 4.** Volume is far below the row limit
  (1,659 invoices in 2026) so item 1 does not affect Oceania.

## Worthy Products South / Dutch Rusk (Ostendo)

- [x] **6. Total Discounts is wrong — it reads NZ$282.78 for September.** FIXED.
  `DISCOUNTAMOUNT` sums to NZ$146.81 for the whole year and the header's
  `LINEDISCOUNTAMOUNT` to NZ$14,548.93, because neither column is how this
  business records a discount. `DISCOUNTPERCENT` is populated on 208,736 of
  215,148 lines with real values (11–29%), and the money sits in the gap between
  `CUSTOMERUNITPRICE` and the price actually charged.

- [x] **7. Margin is understated by cost data that cannot be right.** ROOT CAUSE FOUND.
  Recorded margin swings 3.6%–18.4% across six months and tracks the cost faults
  exactly: June carries NZ$320,423 of impossible cost and reads 3.6%; April
  NZ$118,993 and reads 11.9%; May, August and September carry almost none and
  read 17.2%, 18.4%, 16.9%. Excluding only lines whose cost exceeds the sale —
  nothing estimated — every month lands 17.1%–18.7% and the year at 17.9%. The
  damage clusters on **22–30 June and 8–9 April**: the signature of a stock
  receipt corrupting the running average cost. No derived basis repairs it
  (item master 28.9%, per-item median 28.7%, invoiced 14.7%), so a
  **Margin (clean)** column sits beside the recorded one and the cost data needs
  correcting in Ostendo.
  Of FY26 stock sales: 97.0% of revenue runs at a **19.7%** margin. The
  remaining 3.0% carries NZ$554,321 of cost against NZ$244,735 of revenue — one
  band has cost at **4.3x** the revenue earned. That drags the reported figure to
  15.3% on stock lines, and to 13.4% overall once rebates are included.
  14,493 lines carry an invoiced cost more than **3x** the item master's buy
  price, which points at a pack-size/unit-of-measure problem in Ostendo rather
  than real trading.

- [x] **8. Fast-Moving SKU margins follow from item 7** — same root cause, now explained on screen. — the four Mars lines
  showing −4.6% to −6.7% are the same bad-cost lines, not loss-making trade.

- [x] **9. Slow-Moving "Sold" read 0 on every row** — it looked quantities up in
  the top 200 products by revenue, which a slow mover is never in. FIXED.

- [x] **10. Cause of the cost fault confirmed by Worthy's head of finance: a
  unit-of-measure problem, now resolved.** Data agrees exactly — ran Mar–Jul 2026,
  peaked in June, stopped by August. The dashboard shows Ostendo's own figures by
  default and flags only the months materially affected.

## Done

- [x] Sales-by-Rep month columns landed three months out — fixed, verified.
- [x] Weekly Gross Profit column read NZ$0.00 — fixed, verified.
- [x] Reps with no activity in the period listed as rows of zeros — removed.
- [x] New Customers and Returns populated for South.
- [x] Revenue, cost, invoice and credit figures for South tie to Ostendo to the
      cent, cross-checked against a query sharing no code with the dashboard.

## Worthy Products North and Oceania (Odoo)

- [x] **11. Per-week margins on the Sales by Rep table.** Weekly cost comes from
      `/api/odoo/weeks`, one month at a time. Verified against `/api/odoo/fy`:
      all 48 September rep-weeks agree to the cent, and each rep's week costs sum
      exactly to that rep's September cost.

- [x] **12. Three reps showed a 100% margin because Odoo holds no cost for what
      they sell.** Pooja Jani read 100% on NZ$37,891 of FY26 sales; FY25 had a
      month reading 102.2%. They sell freight and service lines, which carry no
      standard cost, so revenue minus cost came out as the whole revenue. Where
      cost covers less than 95% of a row's own revenue the margin and gross
      profit are now left blank, and the panel names the reps and says why.
      Revenue and recorded cost are untouched, so every row still adds up to the
      company total. Company-wide the gap is NZ$37,029.70 (0.5%), stated in the
      banner.

- [x] **13. Cost coverage was measured against the whole year, not the month.**
      Each rep's costed revenue was tracked only at year level and handed to
      every month, so one rep's June read 3,066% coverage and two months with no
      recorded cost at all passed the new check and still reported 100%. Costed
      revenue is now accumulated per month alongside cost.

- [x] **14. Negative weeks and months rendered as an em dash while still counting
      in the row total,** so the visible columns did not add up to the total
      printed beside them. Rashmi Jani's September read NZ$5,025 across her weeks
      against a NZ$4,752 month total; Chris, August, South showed NZ$85,519.56 of
      weeks against an NZ$85,424.20 total. Negative figures now show, in red.
      Only a true zero is blank. South's own figures are unchanged — the hidden
      NZ$95.36 simply became visible.

- [x] **15. The monthly footer summed each row's gross profit,** which would
      shrink away from the company figure wherever a margin is withheld. It
      derives gross profit from revenue minus cost instead — the same number for
      every row that has both, verified across all 116 South rows. The footer now
      reads NZ$7,811,769 / NZ$1,076,720 / 13.8%, exactly the company KPI.

- [x] **16. Oceania shows no margin at all, which is honest.** Odoo holds no
      product costs for company 1, so the margin columns are absent rather than
      reading 100%, and the banner says so.

- [x] **17. Full audit: 1,864 checks pass, 0 fail** across North FY25/FY26,
      Oceania FY25/FY26, the weeks endpoint and South. Covers: no margin above
      99.5% anywhere; a margin exists only where cost covers ≥95% of that row's
      own revenue; withheld rows carry no gross profit either; reps reconcile to
      the company total to the cent; each rep's months sum to the rep and weeks
      to the month; gross profit equals revenue minus cost wherever both show;
      the weeks endpoint agrees with the FY payload rep by rep; and South's
      headline figures are unchanged (revenue 8,061,635.47, cost 6,891,411.46,
      net sales 7,960,712.62).

### Known, explained, not a defect

- Albert Lee, April 2025, reads −261.2%. Six invoices worth NZ$3,499.87 and one
  credit note of NZ$2,701.35 that carries no product lines — a price adjustment,
  not a return — so no goods came back and no cost reversed. Net revenue
  NZ$798.52 against NZ$2,883.90 of cost. The figure is correct.

### Checked against Odoo itself, not just against ourselves

Every figure above was first proven self-consistent (1,864 checks). That only
shows the dashboard agrees with itself. A temporary route then recomputed the
same numbers from whole Odoo records in plain JavaScript — no `read_group`, no
shared helper, no micro-dollar arithmetic, no reconciliation — and compared.

- [x] **18. 302 figures agree to the cent** across North FY26, the prior
      comparison period, all six started months, all 16 reps (revenue, cost and
      costed revenue each), the top 20 products, top 20 categories and top 30
      customers (revenue, order count and last-order date). Record counts were
      complete both times: 7,691 moves and 132,400 lines for FY26, matching
      Odoo's own `search_count`, with no orphaned lines and none missing a date.

- [x] **19. Category units were summed after rounding.** Each product's units
      were rounded to a whole item before being added into its category, so half
      a unit per product accumulated — Soft Drinks read 19,299 against a true
      19,296.71. Raw quantities are summed and rounded once.

- [x] **20. On Hand was blank on all 20 Fast-Moving rows.** Odoo had the figure;
      the route never asked. Fetched for the ~60 products actually shown, with
      company context — without it Odoo sums stock across every company.

- [x] **21. Margins were quoted two ways on one screen.** The Monthly Breakdown
      footer rounded to whole numbers and read 14% while the rep table read 13.8%
      for the same trading; a KPI card read 12% where September is 12.1%. Seven
      call sites now share one helper and every margin carries one decimal.

- [x] **22. Three Orders columns were empty on every row.** Top Customers read
      `orders` where the getter emits `orderCount`; At Risk and Lapsed built a
      correct `orderCount` then overwrote it with an undefined `c.orders`. A
      sweep of every table on the page now finds no all-blank column.

### 23. The uncosted revenue is NOT missing product costs — corrected

Pratham challenged the claim that NZ$37,029.70 of North's sales carry no cost
"because Odoo holds no cost for them". He was right to. Checked against Odoo:

- Of the **1,480 products** North sold in FY26, **1,470 carry a cost price**.
- The **10 that do not** account for **NZ$1,287.52** — and five of those are
  display stands and promo shirts given away at nil revenue (Pringles display
  stand, KitKat F1 polo shirt, Warheads towel, Fruity Ice freezer, Fruity Burst
  stand). The only one of any size is `B0055` BIC Razor Flex 3, NZ$958.32.
- The real gap is **NZ$35,742.18 across 428 invoice lines with no product on
  them at all** — freight recharges, pallet rent, expense reimbursements,
  insurance write-off claims and supplier rebate claims (Nestlé King Share Bar,
  Bundaberg, Mars), all typed in by hand. Real income, nothing bought to earn
  it, so no cost of sales exists to show. This is also why the three withheld
  reps have no margin: it is what they invoice.

The arithmetic was always right; the explanation was not. `/api/odoo/fy` now
measures the no-product share itself (`nonStockRevenue`) instead of the copy
guessing at the cause, and the banner and rep note say what it actually is.

**Also checked and ruled out:** `standard_price` is `company_dependent: false`
on this database, the service login already defaults to Worthy Products Ltd
(company 4), and **not one of the 1,480 prices changes** when read with company
context. The cost basis is sound. (`qty_available` *is* company-sensitive —
that read does carry context.)

### Known, not a defect

- The service account cannot read `product.product` records belonging to other
  companies ("security restrictions … Product Variant"). It does not affect any
  figure — every product North sells is readable — but a query that sweeps
  products without a company filter will fail.
- Oceania (company 1) still returns `sequence item 1: expected str instance,
  bool found` on any product read. The independent route, using plain
  `search_read` with no grouping, fails identically — so the fault is a broken
  product-variant record in Odoo, not the dashboard's query. Oceania therefore
  shows revenue but no margin, products or categories, and says so on screen.


## Visual double-verification, North and South — 18 Sep 2026

Every rendered cell read back out of the browser and compared against the API
response that produced it. **2,190 cells: 1,165 on North, 1,025 on South.** No
mismatches beyond three customer/product names where Odoo holds a double space
and HTML collapses it. Chart lines and bars were decoded from their SVG path
coordinates and match the payload month by month.

Six defects found and fixed in this pass:

- [x] **24. "Today" was the server's UTC date, not New Zealand's.** Vercel runs
      on UTC, 12-13 hours behind Auckland. At 7:47am on 18 September the period
      read "1 Apr to 17 Sep" and the banner said figures were complete to the
      17th, while the office had been invoicing for eight hours. Every NZ morning
      was reported as the previous day, and the financial-year rollover would
      have happened half a day late on 1 April. All four routes now use
      `nzToday()` / `nzFinancialYear()`, and each payload carries `asOfNZ`.

- [x] **25. South's Fast-Moving SKUs listed the wrong products.** The panel took
      the top fifty products *by revenue* and re-sorted those by units, which
      cannot surface a fast mover that earns little. Nine of twenty rows were
      wrong: TNCC Party Mix (4,676 units), Pascall Party Pack (4,568) and seven
      others were absent, displaced by items ranking high only on revenue. The
      endpoint already built the correct list and the client already mapped it
      in — the panel never read it.

- [x] **26. April was dropped from the charts' month axis.** South's YoY chart
      drew six bars but eleven labels; Recharts discards ticks it thinks will not
      fit and a negative left margin pushed April off. The axis read "May Jun
      Jul…", so every bar was labelled with the wrong month. North escaped only
      because its wider y-axis labels happened to leave room. Every month axis
      now prints every tick.

- [x] **27. A raw float reached the screen as "▲ 0.5999999999999996%".** Self-
      inflicted: moving margins to one decimal meant the margin card subtracted
      two one-decimal numbers. The difference is rounded now, the prior-year
      margin it subtracts is on the same precision, and both percentage badges
      round again at the point of display.

- [x] **28. KPI counters animated into background tabs.** Browsers throttle
      `setInterval` to about once a second when a tab is hidden, turning a 0.8s
      count-up into a 40s one — load the dashboard, switch away, come back, and
      Total Revenue was still climbing through numbers that were not the answer.
      Hidden tabs now show the real figure at once.

- [x] **29. Category units were summed after rounding** (see item 19) — retested
      and holding: largest category now within 0.5 of a whole unit.

### North and South are not like-for-like on cost

Worth stating plainly to anyone comparing the two margins: **North's cost is
each product's standard cost as it stands today; South's is what the item
actually cost on the day it was invoiced.** North's figures round to the dollar,
South's are exact to the cent. The two margins are both correct and are not
measuring quite the same thing.
