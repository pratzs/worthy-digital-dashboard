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
- **Other invoiced lines:** lines with no product (freight recharged, customs, clearance and other charges). Shown on their own row, counted in "all invoiced", never in margin.
- **Cost:** the cost Odoo booked on each invoice: the cost-of-goods lines (`display_type = 'cogs'`) on the 7xxx accounts, which is what accounts reports. Today's standard cost only for a product with no booked cost. A product with neither is left out of the margin base.
- **Margin %:** (costed sales - cost) / costed sales.
- **Sister companies:** sales to Dutch Rusk (partner 27830, Worthy Products South Ltd-Dutch Rusk) and Worthy Oceania (partner 32490) are transfers between our own companies. They are never inside the Worthy Products figure; they are shown separately with the same rules, and the last row adds everything back to "all invoiced".

## Where it lives

| Place | Code |
|---|---|
| Dashboard figures (months, weeks, products, reps, year) | `lib/odooFy.js` (`notSisterMove`, `notSisterLine`, `costByKey` + `ledgerCostByProductMonth` in `lib/odooCost.js`) |
| Dashboard weekly margin | `app/api/odoo/weeks/route.js` |
| Dashboard "Sister company sales" section | `SisterSalesCard` in `app/Dashboard.js`, data from `sisterDaily` / `sumSisters` in `lib/salesBasis.js` |
| Management chat and connector | `get_sales_summary` (`lib/salesTool.js`), Worthy Products from `wpSales` in `lib/salesBasis.js`; Dutch Rusk and Oceania from the dashboard's own rows |
| Sunday email | Odoo scheduled action 105 "Weekly Sales Report (Overall)"; code kept in the catalog-manager repo `.scratch_docs/odoo_weekly_sales_overall_report.py` (backup of the old version `..._BACKUP_2026-11-25.py`) |

## Checked 25 Nov 2026

| | Email | Dashboard | Chat tool | Odoo ledger |
|---|---|---|---|---|
| Worthy Products, 16 to 22 Nov | $319,478.77, 16.47% | $319,478.77, 16.47% | $319,478.77, 16.47% | cost $266,771.77 |
| Worthy Products, 1 to 25 Nov | $1,105,468.65, 15.70% | $1,105,468.65, 15.7% | $1,105,468.65, 15.7% | cost $931,589.37 |
| Worthy Products, FY to 25 Nov | $9,540,181.14, 15.12% | $9,540,181.14, 15.1% | | |
| Dutch Rusk (sister), 16 to 22 Nov | $111,900.14, 0.22% | same | same | |
| All invoiced, 16 to 22 Nov | $453,077.92 | same | same | |

Known difference: for a product-month where only some lines have a booked cost, the dashboard uses the booked cost alone while `wpSales` adds standard cost for the unbooked lines. April to October 2026 that was $820 on $7.16M of cost (0.01%), invisible at one decimal place.

What went wrong before: the dashboard counted sales to Dutch Rusk and Oceania inside Worthy Products (week $431,541.71 at 10.4%); the email counted Dutch Rusk's $20,073.68 of recharged freight and customs as profit (51.84% "margin"); ChatGPT answered from confirmed sales orders ($601K) because nothing told it which basis to use.
