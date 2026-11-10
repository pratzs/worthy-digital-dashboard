// Checks lib/adhocMatch.js: matching a typed (non-coded, ZZZSTOCK) line description to an item-master item and its cost.
// Run: node scripts/adhoc-match-test.mjs   (no Ostendo needed; the cases are real October 2026 lines and finance's costs for them)
import { adhocMatcher } from '../lib/adhocMatch.js';

const master = [
  { ITEMCODE: '609364', ITEMDESCRIPTION: '47g Mars Salted Caramel x 25ct', AVERAGECOST: 24.05225, STDBUYPRICE: 24.05 },
  { ITEMCODE: '71340', ITEMDESCRIPTION: 'Wonka Nerds 46.7g Watermelon Cherry x36ct', AVERAGECOST: 47.711572, STDBUYPRICE: 53.28 },
  { ITEMCODE: '71348', ITEMDESCRIPTION: 'Wonka Nerds 46.7g Grape and Strawberry x 36ct', AVERAGECOST: 51.5, STDBUYPRICE: 51.5 },
  { ITEMCODE: 'W0210', ITEMDESCRIPTION: 'Wonka Nerds 46.7g Grape and Strawberry x 24ct', AVERAGECOST: 34, STDBUYPRICE: 35 },
  { ITEMCODE: '4319563', ITEMDESCRIPTION: 'TNCC Berry Gummy Bears Family Bag 220g x 18ct', AVERAGECOST: 2.341, STDBUYPRICE: 2.341 },
  { ITEMCODE: '200280206314', ITEMDESCRIPTION: 'Arnotts Mint Slices Family Pack 365g', AVERAGECOST: 5.785, STDBUYPRICE: 5.785 },
  { ITEMCODE: '4052698', ITEMDESCRIPTION: 'Cadbury 180g Black Forest Block x 15ct', AVERAGECOST: 3.29, STDBUYPRICE: 3.29 },
  { ITEMCODE: '602925', ITEMDESCRIPTION: 'Bounty Trio Kingsize 75g x 21ct', AVERAGECOST: 37.59, STDBUYPRICE: 37.59 },
  { ITEMCODE: 'J0038', ITEMDESCRIPTION: 'Jarritos Lime 370ml x 24ct', AVERAGECOST: 60, STDBUYPRICE: 60 },
  { ITEMCODE: 'J0040', ITEMDESCRIPTION: 'Jarritos Mango 370ml x 24ct', AVERAGECOST: 60, STDBUYPRICE: 60 },
  { ITEMCODE: 'X1', ITEMDESCRIPTION: 'Solo Energy 250ml Lemon Lime x 24ct', AVERAGECOST: 30, STDBUYPRICE: 30 },
  { ITEMCODE: 'Z0', ITEMDESCRIPTION: 'Nothing With A Cost 100g x 10ct', AVERAGECOST: 0, STDBUYPRICE: 0 },
];
const find = adhocMatcher(master);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : 'FAIL  '}${m}`); if (!c) fails++; };
const near = (a, b) => a != null && Math.abs(a - b) <= b * 0.01;

let r = find('47g Mars Salted Caramel x 25ct ', 10.87);
ok(r?.code === '609364' && near(r.unitCost, 24.05), 'an exact description takes the master carton cost, even when sold below cost on clearance');
r = find('Wonka Nerds Watermellon and Cherry 46g x 36ct ', 21.92);
ok(r?.code === '71340' && near(r.unitCost, 47.71), 'a typing slip and 46g for 46.7g still find the right item, not another flavour or the 24ct');
r = find('TNCC Berry Gummy Bears Family Bag 220g x 18ct', 23.47);
ok(r?.perUnitTimesCount && near(r.unitCost, 42.14), 'a master cost held per single unit is multiplied by the carton count');
r = find('Arnotts Mint Slices 365g x 12ct ', 10.44);
ok(r?.perUnitTimesCount && near(r.unitCost, 69.42), 'a master item with no count is a per-unit cost, so a 12ct line is 12 times it');
r = find('Cadbury 180g Black Forest Block', 1.3);
ok(r && !r.perUnitTimesCount && near(r.unitCost, 3.29), 'a single block sold on its own keeps the single cost');
r = find('Bounty Trio Kingzize 75g x 21ct ', 18.27);
ok(r?.code === '602925', 'one wrong letter in a long word is allowed');
r = find('Jarritos Mandarine 370ml x 24ct ', 20.88);
ok(r == null || near(r.unitCost, 60), 'a flavour that is not in the master is only accepted when the near matches cost the same');
ok(find('Solo Energy 250ml 24ct Crushed Lemon ', 12.52) == null, 'a different flavour name with too little in common is not matched');
ok(find('Wonka Nerds Grape and Strawberry 46g x 30ct', 20) == null, 'a pack count that no master item has is not matched');
ok(find('Nothing With A Cost 100g x 10ct', 5) == null, 'an item with no cost in the master is never used');
ok(find('Rebate for UCSA - Chiltons Milk Sante bars ', 29.37) == null, 'a rebate line typed as stock is not matched');
ok(find('47g Mars Salted Caramel x 25ct', 1.5) == null, 'a cost more than 8 times the price is refused');
ok(find('Freight', 7) == null && find('', 5) == null && find('47g Mars Salted Caramel x 25ct', 0) == null, 'one-word, empty and zero-price lines are refused');
console.log(fails ? `${fails} FAILED` : 'adhoc match ok');
process.exit(fails ? 1 : 0);
