/**
 * The two systems the Marketing (business development) login can see, and every name people use for them.
 *
 *   NORTH = Worthy Products North = Worthy Products (NZ) = Odoo      (Odoo company 4)
 *   SOUTH = Worthy Products South = Dutch Rusk                       (Ostendo)
 *
 * Worthy Oceania (fabric, also in Odoo) is a different business and is NOT included.
 * No imports, so it can be tested on its own.
 */
export const NORTH_LABEL = 'Worthy Products North (Odoo)';
export const SOUTH_LABEL = 'Worthy Products South (Dutch Rusk, Ostendo)';
export const SYSTEM_LABEL = { North: NORTH_LABEL, South: SOUTH_LABEL, north: NORTH_LABEL, south: SOUTH_LABEL };

const BOTH_WORDS = new Set(['', 'both', 'all', 'either', 'every', 'everything', 'combined', 'worthy', 'worthy products', 'total', 'company', 'group']);

/**
 * 'north' | 'south' | null (both) from whatever was said: north, odoo, worthy products north, south, ostendo, dutch rusk,
 * worthy products south, dr... A plain "Worthy Products" is ambiguous (both businesses carry the name), so it means both.
 * Anything that is not recognised throws a plain sentence rather than quietly showing the wrong system.
 */
export function resolveSystem(value) {
  const s = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (BOTH_WORDS.has(s)) return null;
  const north = /\b(north|odoo|wpn)\b/.test(s);
  const south = /\b(south|ostendo|dutch|rusk|dutchrusk|dr|wps)\b/.test(s);
  if (north && south) return null;
  if (north) return 'north';
  if (south) return 'south';
  throw new Error("system must be 'north' (Worthy Products North, Odoo) or 'south' (Worthy Products South, Dutch Rusk, Ostendo), or left out for both.");
}

/** What each name means, for the profile answer and the connector instructions. */
export const GLOSSARY = {
  systems: [
    { name: NORTH_LABEL, alsoCalled: ['Worthy Products North', 'North', 'Odoo', 'Worthy Products (NZ)'], what: 'Worthy Products Ltd, the main wholesale business, run in Odoo.' },
    { name: SOUTH_LABEL, alsoCalled: ['Worthy Products South', 'South', 'Dutch Rusk', 'Ostendo'], what: 'Dutch Rusk, the South Island wholesale business, run in Ostendo.' },
  ],
  notIncluded: 'Worthy Oceania (fabric, also in Odoo) is a different business and is not in this view. Intercompany trading and staff accounts are left out of rankings.',
  terms: {
    group: 'The head account that bills, for example CSB Group, Foodstuffs South Island or Night n Day Foodstores.',
    banner: 'The chain or brand, for example Mobil, Caltex, Fresh Choice, Pak n Save or Four Square.',
    channel: 'The type of customer (Dairy, Supermarket, Fuel, School...). Recorded for South; for North only fuel and liquor stores.',
    region: 'Taken from each system\'s own records, so not identical between North and South.',
    status: 'Active = ordered in the last 45 days. At risk = 45 to 90 days quiet. Lapsed = over 90 days quiet.',
    new: 'North: first invoice ever in the period. South: customer created in the period and invoiced since.',
  },
};

export const MARKETING_INSTRUCTIONS = [
  'This connector gives business development access to Worthy sales and costing from TWO systems, and people use several names for them.',
  `"Worthy Products North", "Worthy Products", "North" and "Odoo" mean ${NORTH_LABEL}. "Worthy Products South", "South", "Dutch Rusk" and "Ostendo" mean ${SOUTH_LABEL}. Worthy Oceania is not included.`,
  'If someone says just "Worthy Products" without North or South, show both systems side by side, label each, and say so; do not pick one silently. To compare the two, use system_overview, or run a tool once per system with its system argument.',
  'Every figure says which system it came from. Never add North and South together without saying they are two businesses, and never describe an Ostendo figure as Odoo or the other way round.',
  'Revenue is posted invoices less credit notes, product lines, before GST, by calendar month; this month is part-way through. Costs are what is recorded today, per the unit the product is stocked in.',
  'There is no salesperson, sales rep, team or weekly information in this view. If asked for any, say it is not available here.',
  'Group = head account that bills; banner = chain or brand; channel = type of customer; status Active/At risk/Lapsed is by days since the last invoice.',
].join(' ');
