# Sales basis: one set of numbers everywhere

Agreed 25 Nov 2026 after Kishan found the Sunday email, the dashboard and ChatGPT giving three different figures for the week 16 to 22 Nov. The dashboard, the management chat and connector (`get_sales_summary`), and the Odoo Sunday email (scheduled action 105) all use these rules, and were checked to the cent against each other and against Odoo.

## Names

| People say | It means |
|---|---|
| Worthy Products, Worthy Products North, North, WP, Odoo | Odoo company 4 |
| Dutch Rusk, Worthy Products South, South, DR, Ostendo | Dutch Rusk, in Ostendo |
| Worthy Oceania, Oceania, fabric | Odoo company 1 |

Code: `lib/salesTool.js` `resolveBusinesses` (management) and `lib/systemNames.js` `resolveSystem` (Vishva's connector). The rules are also in the management connector's instructions and the dashboard chat's system prompt (`NAME_AND_BASIS_RULES` in `lib/mcpRoles.js`).

## Worthy Products (Odoo company 4)

- **Sales:** product lines on posted customer invoices less credit notes, before GST (finance's basis).
- **Freight is never counted** (Pratham, 25 Nov 2026): not in sales, not in margin, not in any total. Freight = any line on 6030 Freight Recovered or 7310 Outward Freight, or a shipping/delivery product (Standard Shipping 77932, 79478, 77497; delivery method product 76579), with or without a product on the line (`FREIGHT_ACCOUNTS`, `FREIGHT_PRODUCT_IDS`, `NOT_FREIGHT` in `lib/salesBasis.js`).
- **Other lines with no product** (discounts typed as lines, rebates, management fees, interest): not sales, never margin.
- **Cost:** the cost Odoo booked on each invoice: the cost-of-goods lines (`display_type = 'cogs'`) on the 7xxx accounts, which is what accounts reports. Today's standard cost only for a product with no booked cost. A product with neither is left out of the margin base.
- **Margin %:** (costed sales - cost) / costed sales.
- **Sister companies:** sales to Dutch Rusk (partner 27830, Worthy Products South Ltd-Dutch Rusk) and Worthy Oceania (partner 32490) are transfers between our own companies. They are never inside the Worthy Products figure; they are shown separately with the same rules, and the bottom row is all product sales (Worthy Products + sisters).

## Worthy Oceania (Odoo company 1), same basis since 25 Nov 2026

Product sales only (it used to count management fees, interest and other non-product lines as revenue, about $600K FY26), booked cost, no freight. Its sister / related companies are Worthy Products Ltd (partner 9271), Dutch Rusk (32462), Worthy Enterprises (7397) and Worthy Properties (7391): kept out and shown separately (`SISTER_SETS` in `lib/salesBasis.js`). The four fabric variants Odoo cannot name (28085, 28084, 6691, 7503) stay out of product groupings as before; their sales are reported separately on the page.

## Where it lives

| Place | Code |
|---|---|
| Dashboard figures (months, weeks, products, reps, year) | `lib/odooFy.js` (`notSisterMove`, `notSisterLine`, `costByKey` + `ledgerCostByProductMonth` in `lib/odooCost.js`) |
| Dashboard weekly margin | `app/api/odoo/weeks/route.js` |
| Team-lead connector (My Account) and Vishva's connector | `lib/repData.js` (booked cost per customer and product, no freight, no sisters), `lib/bdData.js`, `lib/accountData.js`, `lib/bdTools.js`, `lib/priceData.js` (no freight) |
| Dashboard "Sister company sales" section | `SisterSalesCard` in `app/Dashboard.js`, data from `sisterDaily` / `sumSisters` in `lib/salesBasis.js` |
| Management chat and connector | `get_sales_summary` (`lib/salesTool.js`), Worthy Products from `wpSales` in `lib/salesBasis.js`; Dutch Rusk and Oceania from the dashboard's own rows |
| Sunday email | Odoo scheduled action 105 "Weekly Sales Report (Overall)"; code kept in the catalog-manager repo `.scratch_docs/odoo_weekly_sales_overall_report.py` (backup of the old version `..._BACKUP_2026-11-25.py`) |

## Checked 25 Nov 2026

Read from Odoo at 12 pm on 25 Nov, each place separately:

| | Sunday email | Dashboard | Chat tool | Odoo ledger |
|---|---|---|---|---|
| Worthy Products, 16 to 22 Nov | $319,418.77, 16.47% | $319,418.77, 16.47% | $319,418.77, 16.47% | cost $266,771.77 |
| Worthy Products, 1 to 25 Nov | | $1,116,077.84, 15.74% | $1,116,077.84, 15.74% | cost $940,253.09 |
| Worthy Products, FY to 25 Nov | | $9,550,450.33, 15.12% | $9,550,450.33, 15.12% | cost $8,104,830.61 |
| Dutch Rusk (sister), 16 to 22 Nov | $111,900.14, 0.22% | same | same | |
| All product sales, 16 to 22 Nov | $431,481.71, 12.25% | same | same | |
| Worthy Oceania, FY to 25 Nov | | $4,998,950.73, 42.5% | same | sales match |

Report 151 (Weekly Sales Report - All Reps): 94 of 94 figures match. Every other rebuilt scheduled action (103, 104, 107, 108, 110, 111, 123, 137) was checked against Odoo and re-sent to Kishan, cc Pratham, on 25 Nov.

Cost rule, exactly: booked cost-of-goods for the product and period, plus today's standard cost on any quantity that had no booked cost line. The dashboard, the shared calculation (`wpSales`) and the Sunday emails all do this, so they agree to the cent, month by month and week by week. Figures read minutes apart can differ slightly as invoices are posted; the dashboard shows the time it read Odoo.

What went wrong before: the dashboard counted sales to Dutch Rusk and Oceania inside Worthy Products (week $431,541.71 at 10.4%); the email counted Dutch Rusk's $20,073.68 of recharged freight and customs as profit (51.84% "margin"); ChatGPT answered from confirmed sales orders ($601K) because nothing told it which basis to use.
