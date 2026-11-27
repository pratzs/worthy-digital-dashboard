# Worthy dashboard design playbook

Every rule Pratham has set for the Worthy Digital Dashboard and the Command Center, in one place. Read it before any visual change. If a change breaks a rule here, it does not ship. Last updated 27 Nov 2026.

## 1. Who it is for

- The dashboard is for **management**. The MCP connector is for management and a selected team. Write for decision makers.
- Bansri is customer service only; never name her as owner of stock, clearance, write-off or pricing actions.
- Older readers use it: type must be large and easy to read.

## 2. Truth before looks

- **No false or inferred figures.** Every number comes from a source system (Odoo, Ostendo, Shopify, GA4, Meta) on the agreed basis (docs/SALES-BASIS.md).
- Never divide one thing by another that it did not cause. Ads show only what the ad platform tracked (visits, tracked sales); never all sales divided by ad spend.
- New figures are checked against the headline to the cent before they ship (month by month where they can be).
- Free-in, free-out merchandise ($0 sale and $0 cost) never appears in report lists.
- No explanation paragraphs under figures. Labels only; the method goes in docs.
- No repeated numbers on one page (the old "From orders to profit" card repeated the headline strip and was removed).

## 3. Colour

- Three colours, about 60 / 30 / 10: page off-white `--page #f5f4ef`, ink `--ink #141614` (with `--ink2`, `--mute`), and **iris** accent `--orange #4B5BD6` (the variable name is historical). Iris as text uses `--orange-ink #3D4CC4` (6.6:1). Tint: `--accent-tint #eef0fd`.
- Orange is gone (Pratham, 27 Nov 2026). Never add a new hard-coded colour; use the variables (`COLORS` in app/design/ui.js for JS).
- The accent marks the one thing to look at on a card (latest period, a drop, the main action). Everything else is ink in steps of strength.
- No emoji, no loud gradients. The only gradients are the faint background washes behind the glass.

## 4. Glass and background

- Cards and headline strips are frosted glass: `background: var(--glass)` (white 58%), `backdrop-filter: blur(20px) saturate(160%)`, `border: 1px solid var(--glass-line)`.
- The body carries a soft, still wash (`body::before` in app/globals.css). Page wrappers are `background: transparent` so it shows through.

## 5. Spacing (the rule broken most often: check it every time)

| Thing | Value |
|---|---|
| Gap between cards, everywhere (dashboard and Command Center) | **14px** |
| Card padding | 20px (16px on phones) |
| Card corner radius | `--radius` 26px (22px on phones) |
| Card head to content | 14px (`.cardHead` margin-bottom) |
| Grid gaps (`ui.grid`, `ui.grid2`, `ui.grid3`, tiles) | 14px |
| Page footer (period's other figures) | 22px above, as designed |

- A new card copies its neighbours: in the dashboard pass `style={{ marginBottom: 14 }}` or `marginTop: 14` to match the cards around it; in the Command Center `marginTop: 14`. Never 16, 18 or 20.
- When a card moves to a new place (another page or position), its spacing must be re-checked there: a card that relied on its old neighbour's margin can land flush (0px) against the next one.
- Layout never changes as a side effect. Changing an existing layout is a deliberate decision, said to Pratham first.

### The spacing check (run before every deploy that touches layout)

Open each changed page on the live site and run in the console. Every gap must read 14 (the footer 22):

```js
const s=[...document.querySelectorAll('section')].filter(x=>x.getBoundingClientRect().height>40&&!x.parentElement.closest('section'));
s.map((x,i)=>{const r=x.getBoundingClientRect(),p=i&&s[i-1].getBoundingClientRect();return `${(x.innerText||'').split('\n')[0].slice(0,28)} gap ${i?Math.round(r.top-p.bottom):'-'}`})
```

Cards side by side share a top, so a negative or equal value between columns is fine; a 0 between stacked cards is a bug.

## 6. Type and touch

- Nothing under about 12.5px. Labels 13 to 14.5px, body 15px, figures 26px and up.
- Buttons at least 42px tall; date boxes 44px.
- Every icon-only button has an `aria-label`; tables have a caption for screen readers (`.sr-only`); page language is `en-NZ`.
- Focus is a 3px ink outline.

## 7. Hierarchy and grouping

- Group by relationship, most important first:
  - **Overview**: headline, sales and margin by month, weekly summary, forecast, then "Go deeper" tiles into each page.
  - **Sales**: Sales vs Target, Sales by Rep, sister company sales, month, week and year detail.
  - **Margin** (management only): what sets the margin, customer margin.
  - **Analytics**: products, Fast & Slow Movers (stock cards), customers.
- **Every card follows the company picked at the top** (Worthy Products North, South / Dutch Rusk, Oceania). Never show another company's figures there; sister company sales are the one deliberate exception and are labelled as such. Company-wide views (all three businesses) belong on the Command Center only.
- Secondary detail folds into an accordion (`Fold` in app/design/ui.js) that is closed by default but clearly visible and easy to open: a full-width header with its icon, title, a one-line count or figure, and a "Show" / "Hide" label with a chevron. The open state is remembered per browser.

## 8. Buttons

- Main actions (not toggles or tabs) use `Win` (app/design/ui.js): on hover or keyboard focus the label turns into the win it brings ("Open as email draft" to "Share this week's wins"). Both texts share one space, so nothing moves; touch screens keep the plain label.

## 9. Navigation

- Left sidebar, open by default, collapsible to icons (remembered), labelled groups with clear icons; the Command Center's tabs live inside it under "Ecommerce and Marketing" (no second menu bar). On a phone it opens from a menu button.
- Every page keeps a Back button and a trail.

## 10. Speed and Odoo

- Every Odoo or Ostendo read goes through a shared copy with a lock (`readWeeks` / `readFY`); never one read per viewer. Closed periods are kept for hours, not minutes.
- No hidden page sweeps or reads the page does not show.

## 11. Before saying it is done

1. Build, then push (`npm run build && git push`), wait for the deploy.
2. Open the changed pages live; run the spacing check; take a screenshot of the changed area.
3. Check figures against the headline or source.
4. Check at phone width (390px) for sideways spill.
5. Say what was checked and what was not.
