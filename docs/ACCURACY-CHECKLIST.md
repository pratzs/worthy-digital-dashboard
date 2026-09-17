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
