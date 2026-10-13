# Accuracy checklist

Each item is ticked only once it is fixed **and** re-verified against the source
system. Evidence is recorded beside each one.

## Worthy Products North (Odoo company 4)

- [x] **1. January 2026 is missing entirely - NZ$936,451.83 and 835 invoices.** FIXED.
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

- [x] **6. Total Discounts is wrong - it reads NZ$282.78 for September.** FIXED.
  `DISCOUNTAMOUNT` sums to NZ$146.81 for the whole year and the header's
  `LINEDISCOUNTAMOUNT` to NZ$14,548.93, because neither column is how this
  business records a discount. `DISCOUNTPERCENT` is populated on 208,736 of
  215,148 lines with real values (11–29%), and the money sits in the gap between
  `CUSTOMERUNITPRICE` and the price actually charged.

- [x] **7. Margin is understated by cost data that cannot be right.** ROOT CAUSE FOUND.
  Recorded margin swings 3.6%–18.4% across six months and tracks the cost faults
  exactly: June carries NZ$320,423 of impossible cost and reads 3.6%; April
  NZ$118,993 and reads 11.9%; May, August and September carry almost none and
  read 17.2%, 18.4%, 16.9%. Excluding only lines whose cost exceeds the sale  - 
  nothing estimated - every month lands 17.1%–18.7% and the year at 17.9%. The
  damage clusters on **22–30 June and 8–9 April**: the signature of a stock
  receipt corrupting the running average cost. No derived basis repairs it
  (item master 28.9%, per-item median 28.7%, invoiced 14.7%), so a
  **Margin (clean)** column sits beside the recorded one and the cost data needs
  correcting in Ostendo.
  Of FY26 stock sales: 97.0% of revenue runs at a **19.7%** margin. The
  remaining 3.0% carries NZ$554,321 of cost against NZ$244,735 of revenue - one
  band has cost at **4.3x** the revenue earned. That drags the reported figure to
  15.3% on stock lines, and to 13.4% overall once rebates are included.
  14,493 lines carry an invoiced cost more than **3x** the item master's buy
  price, which points at a pack-size/unit-of-measure problem in Ostendo rather
  than real trading.

- [x] **8. Fast-Moving SKU margins follow from item 7** - same root cause, now explained on screen. - the four Mars lines
  showing −4.6% to −6.7% are the same bad-cost lines, not loss-making trade.

- [x] **9. Slow-Moving "Sold" read 0 on every row** - it looked quantities up in
  the top 200 products by revenue, which a slow mover is never in. FIXED.

- [x] **10. Cause of the cost fault confirmed by Worthy's head of finance: a
  unit-of-measure problem, now resolved.** Data agrees exactly - ran Mar–Jul 2026,
  peaked in June, stopped by August. The dashboard shows Ostendo's own figures by
  default and flags only the months materially affected.

## Done

- [x] Sales-by-Rep month columns landed three months out - fixed, verified.
- [x] Weekly Gross Profit column read NZ$0.00 - fixed, verified.
- [x] Reps with no activity in the period listed as rows of zeros - removed.
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
      Only a true zero is blank. South's own figures are unchanged - the hidden
      NZ$95.36 simply became visible.

- [x] **15. The monthly footer summed each row's gross profit,** which would
      shrink away from the company figure wherever a margin is withheld. It
      derives gross profit from revenue minus cost instead - the same number for
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
  credit note of NZ$2,701.35 that carries no product lines - a price adjustment,
  not a return - so no goods came back and no cost reversed. Net revenue
  NZ$798.52 against NZ$2,883.90 of cost. The figure is correct.

### Checked against Odoo itself, not just against ourselves

Every figure above was first proven self-consistent (1,864 checks). That only
shows the dashboard agrees with itself. A temporary route then recomputed the
same numbers from whole Odoo records in plain JavaScript - no `read_group`, no
shared helper, no micro-dollar arithmetic, no reconciliation - and compared.

- [x] **18. 302 figures agree to the cent** across North FY26, the prior
      comparison period, all six started months, all 16 reps (revenue, cost and
      costed revenue each), the top 20 products, top 20 categories and top 30
      customers (revenue, order count and last-order date). Record counts were
      complete both times: 7,691 moves and 132,400 lines for FY26, matching
      Odoo's own `search_count`, with no orphaned lines and none missing a date.

- [x] **19. Category units were summed after rounding.** Each product's units
      were rounded to a whole item before being added into its category, so half
      a unit per product accumulated - Soft Drinks read 19,299 against a true
      19,296.71. Raw quantities are summed and rounded once.

- [x] **20. On Hand was blank on all 20 Fast-Moving rows.** Odoo had the figure;
      the route never asked. Fetched for the ~60 products actually shown, with
      company context - without it Odoo sums stock across every company.

- [x] **21. Margins were quoted two ways on one screen.** The Monthly Breakdown
      footer rounded to whole numbers and read 14% while the rep table read 13.8%
      for the same trading; a KPI card read 12% where September is 12.1%. Seven
      call sites now share one helper and every margin carries one decimal.

- [x] **22. Three Orders columns were empty on every row.** Top Customers read
      `orders` where the getter emits `orderCount`; At Risk and Lapsed built a
      correct `orderCount` then overwrote it with an undefined `c.orders`. A
      sweep of every table on the page now finds no all-blank column.

### 23. The uncosted revenue is NOT missing product costs - corrected

Pratham challenged the claim that NZ$37,029.70 of North's sales carry no cost
"because Odoo holds no cost for them". He was right to. Checked against Odoo:

- Of the **1,480 products** North sold in FY26, **1,470 carry a cost price**.
- The **10 that do not** account for **NZ$1,287.52** - and five of those are
  display stands and promo shirts given away at nil revenue (Pringles display
  stand, KitKat F1 polo shirt, Warheads towel, Fruity Ice freezer, Fruity Burst
  stand). The only one of any size is `B0055` BIC Razor Flex 3, NZ$958.32.
- The real gap is **NZ$35,742.18 across 428 invoice lines with no product on
  them at all** - freight recharges, pallet rent, expense reimbursements,
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
context. The cost basis is sound. (`qty_available` *is* company-sensitive  - 
that read does carry context.)

### Known, not a defect

- The service account cannot read `product.product` records belonging to other
  companies ("security restrictions … Product Variant"). It does not affect any
  figure - every product North sells is readable - but a query that sweeps
  products without a company filter will fail.
- Oceania (company 1) still returns `sequence item 1: expected str instance,
  bool found` on any product read. The independent route, using plain
  `search_read` with no grouping, fails identically - so the fault is a broken
  product-variant record in Odoo, not the dashboard's query. Oceania therefore
  shows revenue but no margin, products or categories, and says so on screen.


## Visual double-verification, North and South - 18 Sep 2026

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
      in - the panel never read it.

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
      count-up into a 40s one - load the dashboard, switch away, come back, and
      Total Revenue was still climbing through numbers that were not the answer.
      Hidden tabs now show the real figure at once.

- [x] **29. Category units were summed after rounding** (see item 19) - retested
      and holding: largest category now within 0.5 of a whole unit.

### North and South are not like-for-like on cost

Worth stating plainly to anyone comparing the two margins: **North's cost is
each product's standard cost as it stands today; South's is what the item
actually cost on the day it was invoiced.** North's figures round to the dollar,
South's are exact to the cent. The two margins are both correct and are not
measuring quite the same thing.

## Both companies checked against their own source systems - 18 Sep 2026

North had been recomputed from Odoo's raw records; South had only ever been
checked screen-against-API, which proves the page matches the payload, not that
the payload matches Ostendo. Both now have an outside check.

**South** - a temporary route recomputed every figure from Ostendo sharing
nothing with the route it checks: `>= start AND < day-after-end` instead of
`BETWEEN` (so a boundary bug cannot hide behind the same predicate - an earlier
check reused `BETWEEN` and could never have caught one), aggregation per invoice
rather than per day and salesperson, and `COUNT(DISTINCT)` for the document
count. **104 figures agree**: FY24, FY25 and FY26 totals, the prior-comparison
window, all six months queried as separate windows, and all eight reps on
revenue, cost, invoices and credits. `netSales` independently equals the sum of
header nett amounts and GST comes out at exactly 1.1500.

**North** - FY25 rebuilt from 13,015 invoices and 213,571 lines, FY26 from
7,692 and 132,402, every count matching Odoo's own, no orphaned lines.

- [x] **30. The year's totals were two cents wrong.** They were built by adding
      up twelve already-rounded months, so half a cent per month accumulated.
      FY25's cost came out two cents above the true sum - and because per-rep
      costs are reconciled to that company figure, the two cents were pushed onto
      the largest rep, where they showed. Totals now add the untouched
      accumulators and round once.

- [x] **31. Fixing that broke the column.** With the year rounded once and each
      month rounded on its own, the twelve months no longer summed to the total
      printed beneath them. The same largest-remainder pass used for the reps now
      settles the months, so the column adds up and the year stays right.

- [x] **32. The screen still did not add up, a level above the cents.** North
      printed whole dollars, so six visible cost figures came to NZ$6,732,940
      against a footer of NZ$6,732,941 - a dollar that existed only in the
      display. Precision now follows the data, not the source system: every
      financial-year view shows cents, as South already did.

- [x] **33. The rep Gross Profit column is legitimately short, and says so.**
      Three reps show a blank gross profit because their cost is unknown, so the
      column adds to NZ$42,176.05 less than its total. Both figures are right;
      the note now states the gap and its size rather than leaving a reader to
      find it.

### Reconciliation audit

**1,238 checks across both companies and both years**: months sum to the year,
reps sum to the year, each rep's months sum to that rep, each rep's weeks sum to
that rep's month, company weeks sum to the company month, and gross profit is
exactly revenue minus cost everywhere both are shown. Zero failures. Re-run on
screen afterwards: every additive column on both companies now equals the total
printed under it (AOV excepted - it is an average, and its footer correctly
shows the period figure, not the sum of monthly ones).

## Worthy Oceania - 18 Sep 2026

Oceania is two businesses in one Odoo company, trading in three currencies. Both
facts were being ignored.

- [x] **34. Revenue was adding US dollars to New Zealand ones.** Oceania raises
      invoices in USD (204), NZD (763) and AUD (56). The route summed
      `amount_untaxed`, which is stated in each invoice's OWN currency, so the
      dashboard showed **NZ$3,207,414 against a true NZ$4,429,231** - 28% of the
      company missing. Line figures had the same fault through `price_subtotal`.
      Both now use the company-currency fields Odoo maintains for this:
      `amount_untaxed_signed` on the document and `balance` on the line.

      Each was verified on this database before use: identical to hand-signed
      arithmetic on 762 same-currency documents; `-balance` identical to
      `price_subtotal` on home-currency invoice lines and its exact opposite on
      credit-note lines; USD lines converting at 1.7106 NZD.

      North was affected too, though barely - one AUD invoice, NZ$174.80. It
      would have grown silently.

- [x] **35. The two departments are Odoo sales teams.** Odoo carries three  - 
      Textiles, WOL Products and Fashion - but Worthy runs Fashion as part of the
      fabric business, so it is reported inside Textiles:

      | Department | Revenue | Share | vs last year |
      |---|---|---|---|
      | Textiles (incl. Fashion) | NZ$3,530,149.48 | 79.7% | +17.1% |
      | WOL Products | NZ$899,081.05 | 20.3% | −5.9% |

      Folding Fashion in lifts the fabric side's growth from +12.6% to +17.1%,
      because Fashion grew from almost nothing (NZ$660 last year). The panel
      names the teams behind any department covering more than one, so nobody
      thinks Fashion was dropped. North uses teams too (Route, Online, Direct),
      none of which map, so it is unchanged.

      Departments, months, reps, currencies, invoice counts and credit counts
      each add up to the company total.

- [x] **36. Products, categories and margin were entirely absent.** Four fabric
      variants have an attribute value Odoo cannot render, and any query that has
      to name a product then fails outright - so the whole company was reduced to
      a revenue figure. Excluding those four by id lets the other **2,842**
      products through. Only two had sales in the period (COTGREYCAL36,
      COTGREYCAL48, NZ$1,521.67); the page names them and says their sales are
      still in every total. **Fixing those four records in Odoo removes the need
      for any of this.**

- [x] **37. Oceania still shows no margin, and that is correct.** Not one of the
      2,842 products it sells carries a standard cost in Odoo - 0% coverage,
      measured. The margin columns are absent rather than reading 100%, and the
      banner says why. Populating standard costs in Odoo is the only thing that
      changes this.

Teams, months, reps and the currency split each add up to the company total, and
`problems` is empty.

- [x] **38. North's sales now match the head of finance's MTD sales-rep report.**
      His report (30 Sep 2026) counts product lines only and groups the
      non-field reps as "Direct". The dashboard counted every invoice line, so it
      was NZ$9,221 above him in September (NZ$1,734,128 vs NZ$1,724,907) and its
      gross profit read NZ$220,636 (12.7%) against his NZ$212,449 (12.3%),
      because income with no product on it was counted as profit with no cost.

      The gap was invoice lines with no product: an NZ$5,456 intercompany expense
      reimbursement, NZ$2,738 rent, NZ$1,080 supplier rebate, NZ$1,272 freight,
      NZ$1,925 of hand-typed "Sales - Local" lines, less NZ$3,226 "Discounts
      Given". North (company 4 only) now takes those lines out of every revenue
      aggregate - months, weeks, reps, teams, customers, currencies - so they still
      add up. Oceania is untouched and its payload was compared field by field
      before and after: identical.

      Checked against his report for September, per rep, sales difference NZ$0 on
      all nine lines (total NZ$1,724,906.53 vs NZ$1,724,907). Reps: Hari, Naitik,
      Nayan, Rubin, Savan, Albert, Nish, Nimesh, and "Direct" (Kishan, Pratham,
      Pooja, Bansri, Rashmi, unassigned).

      Open: gross profit is NZ$211,414 (12.3%) against his NZ$212,449 (12.3%),
      0.5% apart, each rep within NZ$270 and 0.2 points. The dashboard costs at
      today's product standard cost; his figure is NZ$1,035 lower in cost, which
      points to cost as at the invoice date. Not reproducible without his cost
      source. Stock-valuation layers were tried and do not match.

      The lines excluded are reported in `nonStockRevenue` and stated on the page.
      New customers on the Shopify side (Online/POS) are now counted on the
      customer's first-ever order, once, instead of every order from a customer
      created that month - March had read 555 against a true 16.

      Correction, same day: the first deploy printed the currency line as
      "NZD (0), NZD (0), ..." hundreds of times, because the non-product
      adjustments were listed as rows instead of being folded into their currency.
      It had been checked through the API but not looked at on the page. Fixed,
      then checked in the rendered page: North, Oceania, South, and the North
      Online tab. A change to what the page shows is not verified until the page
      has been looked at.

      Gross profit, later the same day: product standard costs were edited in
      Odoo at 01:22 UTC on 6 Oct (about 11 products touched, including R0179 to
      9.94). North's September GP moved from NZ$211,414 to NZ$212,230 (12.3%)
      with no change to the code or to sales, which is now NZ$219 (0.1%) from the
      head of finance's NZ$212,449. That supports the earlier reading: the
      remaining gap is cost as of a different date, because the dashboard costs at
      today's standard cost and any later edit moves every past month.
      The non-product lines are now read once per request (about 1.7s) and sliced
      by date, rather than once per panel.

- [x] **39. North "Sales vs Target" table agrees with the Odoo KPI emails.** The Odoo
      tab on Worthy Products North shows each rep's annual target against
      year-to-date sales, using the same three targets and selection rules as
      the KPI scheduled actions (ir.cron 107 Rubin $650,000, 110 Savan $350,000,
      111 Naitik $300,000). Checked 7 Oct 2026 against the emails Odoo had
      already sent: Rubin $375,786 (57.8%) and Naitik $268,568 (89.5%) to
      4 Oct, Savan $230,338 (65.8%) to 27 Sep, all to the dollar. The basis is
      calendar year, ex GST, invoices less credit notes, so it deliberately
      differs from the April-March finance basis used elsewhere on the page.
      The targets live as constants in the crons, not as Odoo fields, so a change
      there must be copied to lib/kpiTargets.js. `/api/odoo/kpi?asOf=YYYY-MM-DD`
      reproduces an earlier email.

- [x] **40. Debtors match Odoo's receivable ledger.** Checked 7 Oct 2026 on Worthy
      Products North two independent ways: open invoices and credit notes
      (outstanding balance) total $2,486,152.55 over 2,021 documents, and the
      receivable-account lines (unreconciled, posted) total the same to the cent.
      Overdue by due date agrees too: $461,599.11 over 457. The ageing buckets add
      back to the total. The page figure is live, so it moves as invoices are
      raised and paid. Route: /api/odoo/debtors.
- [x] **41. Year-end forecast is arithmetic on figures already on the page.**
      Sales to date, plus the rest of last year's sales multiplied by this year's
      pace against the same days last year. It is shown with the "rest matches last
      year" case beside it as the low end. Not a budget.
- [x] **42. Company summary and CSV export use the same payloads as the tables.**
      The summary reads each company's financial-year payload and says when it was
      read and whether anything failed. Companies are not added together because
      North sells to South and Oceania. CSV exports exactly the rows a table shows,
      with the period in the file name.
- [x] **43. South debtors match Ostendo, and "over 90" is defined.** Checked 7 Oct 2026
      against totals computed inside Ostendo itself: unpaid invoices and credit
      notes $2,184,278.16, less $29,397.95 of payments received and not applied,
      gives $2,154,880.21 owed; overdue $231,393.50 over 394 documents; over 90
      days late $11,903.17; Red Circle Wholesale $189,645.55 with $86,169.18
      overdue. All agree with the page. Amounts include GST.
      "Over 90" means more than 90 days past the DUE date, which is how Odoo ages
      it. North measured that way is $61,557.76 (82 documents, confirmed from the
      ledger lines too). Aged from invoice date instead, North would be $147,913.77
      (146 invoices), because terms are 20th of the following month. If finance
      age from invoice date, the buckets will not match theirs until that is changed.
- [x] **44. Light theme only.** The dashboard no longer has a dark mode, including
      when the browser or operating system is set to dark.
- [x] **45. A month whose cost is incomplete shows no margin (13 Oct 2026).** Worthy
      Products North showed 25.3% gross margin for October against about 12% every
      other month. Only 88.3% of October's revenue had a cost behind it (15 products
      with a zero standard cost, among them the new Allen's lines, $66,497 of sales),
      so the API correctly withheld the margin, but the page recomputed it from
      revenue less the part-cost and showed the result. A month, week or prior-year
      row flagged `marginWithheld` now shows a dash. The full-year figure is still
      worked from the API's own totals (99.2% costed), so Total 13.9% / $1,242,810.53
      agrees with the API to the cent.
- [x] **46. North reads cost in company 4 only (13 Oct 2026).** Cost is held per
      company in Odoo. The cost read in /api/odoo/fy and /api/odoo/weeks carried no
      company context, so it returned the API user's default company's cost, which
      is only right while that default is Worthy Products. North now reads with
      `allowed_company_ids: [4]`. Worthy Oceania (company 1) is deliberately left as
      it was: its costs sit in company 1 and the old read returned zero for them
      (company 1 context gives about 98.8% coverage), so "Oceania carries no costs"
      was an artefact. Decide whether to switch Oceania before changing it.
- [x] **47. Loading (13 Oct 2026).** Odoo's login call took 3-13s under load and was
      repeated by every route on every request (15s limit); the user id is now kept
      for 30 minutes (lib/odooAuth.js). The Yearly view no longer starts five years
      at once: the selected year goes first, then older years one at a time. Stock
      value and weekly rep cost wait for the year's own figures. A failed figures
      load now shows a red "did not load" banner with Try again, instead of NZ$0.00.
- [x] **48. North and Oceania main figures are shared in five-minute slots (13 Oct 2026).**
      /api/odoo/fy takes 35-45s against Odoo and was timing out on Vercel (90s) when
      Odoo was busy, leaving the page on NZ$0.00. The result is now worked out once
      per five-minute slot and shared (lib/odooFyCache.js). Accuracy rules: the slot
      is in the cache key, so nothing older than the slot is ever served; only
      COMPLETE results are stored (any `problems` and the result is returned but not
      kept); failures are never stored; `?fresh=1` skips the cache (the page's Try
      again uses it). The page prints "Odoo figures as of HH:MM NZ". The first person
      in each slot still waits for a live read. A warm-up route exists
      (/api/cron/warm, needs CRON_SECRET) but is NOT scheduled: Vercel rejected a
      five-minute cron on this plan and the deploy failed. Schedule it from outside
      (any 5-minute pinger with the Bearer secret) or on a plan that allows it. Tested: cached, fresh and
      warm-up results identical (revenue 8,944,455.47, margin 13.9%); cached reads
      20-60ms; the warm-up refuses requests without the secret.
- [x] **49. A partly-costed month shows margin on the costed sales (13 Oct 2026).** For
      a month where 80% or more of sales have a cost but the rest do not, the Monthly
      cards show margin and gross profit worked out on the sales that have a cost,
      with the coverage printed under the card (October: 15.5% on 88.3% of sales,
      $77,688.63 gross profit). Sales with no cost are left out of both sides. Below
      80% the card stays blank with an explanation. The monthly table still shows a
      dash for such a month. Examples with no standard cost in Odoo company 4 in
      October: Allen's Frogs Alive Peg Bag 190G (A0148), Nesquik Milkshakes (A0152),
      Ripe Raspberries (A0158), Pineapples (A0153), Mountain Dew (A0154).
- [x] **50. Margin and gross profit are on sales that have a cost, everywhere (13 Oct 2026).**
      Dropship and inter-company products carry no cost in Odoo by design (confirmed
      by Pratham). Margin = (sales that have a cost - their cost) / sales that have a
      cost; gross profit = the same top line less cost; revenue stays the full
      figure and cost coverage is printed. Applied in the API (/api/odoo/fy rows,
      totals, reps, /api/odoo/weeks) and in every North/Oceania card and table.
      Reconciles: the twelve monthly gross profits sum to the year's exactly. Effect
      on FY26 to date: gross profit $1,173,392.47, margin 13.2% on 99.2% of sales
      (the earlier 13.9% / $1,242,810.53 counted $69.6k of no-cost sales as pure
      profit). October: 15.5% / $77,689.23 on 88.3% of sales. Revenue - Cost will not
      equal Gross Profit in a month with no-cost sales, and the table note says so.
- [x] **51. Dropshipped products use the cost booked on the dropship receipt (13 Oct 2026).**
      A dropship (vendor straight to customer) never enters the warehouse, so the
      product's own cost stays 0. For a North product with no standard cost, the
      unit cost is now the quantity-weighted average of the stock valuation layers
      on its vendor->customer receipts (lib/odooCost.js). It is taken from the layer,
      in NZD, NOT from the purchase order: the Allen's POs are in AUD ($27.60 AUD =
      NZD 34.32, and they are sold at NZD 34.32, so about 0% margin). A product with
      no standard cost and no dropship receipt stays uncosted and is left out of
      margin. North only; Oceania unchanged. Supersedes the October figures in item
      49/50: October 13.7% / $77,696.59 on 100% of sales (only $190.86 of freight
      lines uncosted); FY26 to date 13.1% / $1,173,399.83. Verified against an
      independent calculation from Odoo to the cent. Dropship lines in October:
      revenue $66,306.24, cost $66,298.88.
- [x] **52. Sales by Rep also shows on the Overview page (13 Oct 2026).** For North,
      Oceania and South, under the monthly table. Same component and same figures as
      the Sales by Rep page. Checked on North: the rep revenue and gross profit rows
      add up to the table total exactly within one load. Between two loads minutes
      apart the figures can move by tens of dollars because cost is the product's
      cost today and Odoo updates it as stock is received.
- [x] **53. South margin leaves out invoice lines with impossible costs (13 Oct 2026).**
      Ostendo has invoice lines whose recorded cost is more than twice the price the
      line sold at (a Cadbury block costed at $63.75 against a sale of about a dollar).
      FY26 to 13 Oct has 2,164 such lines across 128 items; 1,546 of them fell in
      June, which showed 5.1% against 16-20% for every other month. Gross profit and
      margin are now worked out without those lines (lib: app/api/ostendo/fy, present
      and restate); revenue and cost stay the full Ostendo figures, `marginRevenue`
      and `marginCost` carry what the margin rests on. Result FY26: 18.0% /
      $1,682,335.82 (was 15.2%); June 16.1%; October 20.0%. Verified: the June bad-line
      count (1,546), sales ($52,803.58) and recorded cost ($212,289.01) match an
      independent Ostendo query exactly; the monthly and rep gross profits add up to
      the year to the cent. The cards say "Margin leaves out N invoice lines whose
      recorded cost in Ostendo cannot be right". The item list for finance is in
      south-bad-cost-items-FY26.csv.
- [x] **54. One tab: "Overview and Sales" (14 Oct 2026).** The separate Sales by Rep tab is
      gone. The rep table sits on the Overview and Sales page for North (Odoo, POS and
      Online), Oceania and South. The old /reps address redirects to the Overview.
- [x] **55. Sales vs Target is now the financial-year rep budget (14 Oct 2026).** The old
      calendar-year table (Rubin, Savan, Naitik, from the Odoo KPI emails) is removed,
      with its /api/odoo/kpi route. The new table works to the business's monthly
      budget per rep for the financial year April to March (lib/repTargets.js).
      Savan Patel FY26: budget $2,568,000 (Apr 199k, May 232k, Jun 184k, Jul 221k,
      Aug 216k, Sep 190k, Oct 220k, Nov 214k, Dec 248k, Jan 204k, Feb 212k, Mar 228k),
      target GP 18% = $462,240. Sales are the same figures as Sales by Rep. Vs budget
      to date = sales less (finished months in full + the elapsed share of this month).
      Checked by hand on 14 Oct: pace $1,341,355, sales $1,301,794, behind $39,561.
      Other reps are added one at a time as their budgets are supplied.
- [x] **56. Hari Patel's FY26 budget added to Sales vs Target (14 Oct 2026).** Apr 104k, May 118k,
      Jun 101k, Jul 106k, Aug 104k, Sep 100k, Oct 114k, Nov 128k, Dec 121k, Jan 112k, Feb 117k,
      Mar 132k = $1,357,000; target GP 18% = $244,260 (both agree with the budget sheet).
      Sales checked from Odoo directly: Apr-Sep match the dashboard to the cent (Sep $70,963.20,
      the figure that matched finance's report); October moves as invoices are posted.
- [x] **57. Nayan Patel's FY26 budget added to Sales vs Target (14 Oct 2026).** Apr 136k, May 170k,
      Jun 148k, Jul 152k, Aug 168k, Sep 150k, Oct 174k, Nov 144k, Dec 177k, Jan 145k, Feb 166k,
      Mar 168k = $1,898,000; target GP 18% = $341,640 (both agree with the budget sheet). Sales
      checked from Odoo directly: Apr-Sep match the dashboard to the cent (Sep $140,469.18);
      October moves as invoices are posted.
- [x] **58. Naitik Trivedi's FY26 budget added to Sales vs Target (14 Oct 2026).** Apr 177k, May 197k,
      Jun 172k, Jul 204k, Aug 219k, Sep 201k, Oct 235k, Nov 212k, Dec 228k, Jan 193k, Feb 194k,
      Mar 216k = $2,448,000; average $204,000; target GP 18% = $440,640 (all agree with the budget
      sheet). Sales checked from Odoo directly: every month Apr-Oct matches the dashboard to the
      cent (Sep $244,340.36).
- [x] **59. Rubin Monpara's FY26 budget added; Sales vs Target shows cents (14 Oct 2026).** Rubin: Apr 241k,
      May 284k, Jun 243k, Jul 324k, Aug 308k, Sep 262k, Oct 301k, Nov 300k, Dec 336k, Jan 275k,
      Feb 290k, Mar 298k = $3,462,000; target GP 18% = $623,160. All five reps (Savan, Hari, Nayan,
      Naitik, Rubin) now carry the sheet's own total and GP $ (lib/repTargets.js), and the page
      refuses to build if the twelve months do not add to the sheet total or the GP $ is not exactly
      the GP % of it. Every amount in the table is shown to the cent, as the sheet prints it. The
      sheet's "Avg. Monthly Budget" is a rounded figure and is not used. Rubin's sales checked from
      Odoo: Apr-Sep match the dashboard to the cent (Sep $281,329.92).
- [x] **60. Nimesh Darjee's FY26 budget added (14 Oct 2026).** Apr nil (new rep, started May), May 50k,
      Jun 50k, Jul 50k, Aug 75k, Sep 75k, Oct 75k, Nov 100k, Dec 100k, Jan 80k, Feb 80k, Mar 100k =
      $835,000; target GP 18% = $150,300 (both agree with the budget sheet). Measured exactly like the
      other reps: invoices he raised, no special basis. He raised no invoices before August
      ($0 Apr-Jul), so he reads behind budget to date; his Aug $7,603.55, Sep $68,247.03 match the
      dashboard to the cent. (For information: customers assigned to him bought $374,674.57 Apr-Oct.
      Not used, by decision.)
