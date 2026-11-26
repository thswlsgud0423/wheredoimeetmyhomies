import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListings, clean } from '../src/data/wikivoyage.js';
import { merge, sections, dayPlan } from '../src/data/guide.js';

const WIKI = `==See==
* {{see | name=Stephansdom | alt=St. Stephen's | lat=48.2085 | long=16.3731 | wikipedia=St. Stephen's Cathedral, Vienna | content=The '''cathedral''' of [[Vienna|the city]]. }}
==Eat==
===Budget===
* {{eat | name=Würstelstand | lat=48.21 | long=16.37 | price=€4 | content=Sausages {{lang|de|Käsekrainer}}. }}
===Splurge===
* {{eat | name=Steirereck | lat=48.205 | long=16.38 | content=Famous fine dining in the Stadtpark. }}
==Drink==
* {{drink | name=Café Central | lat=48.2104 | long=16.3653 | content=Classic Viennese coffee house. }}
`;

test('parses Wikivoyage listings with sections and budgets', () => {
  const items = parseListings(WIKI);
  assert.deepEqual(items.map((i) => [i.kind, i.name, i.budget]), [
    ['see', 'Stephansdom', null], ['eat', 'Würstelstand', 'Low'], ['eat', 'Steirereck', 'High'], ['drink', 'Café Central', null],
  ]);
  assert.equal(items[0].desc, 'The cathedral of the city.');
  assert.equal(items[1].desc, 'Sausages Käsekrainer.');
  assert.equal(clean('[[A|b]] [http://x.y link] {{x|y}}'), 'b link');
});

test('merges Wikipedia fame, filters by vibe and budget, builds a day plan', () => {
  const items = parseListings(WIKI).map((i) => ({ ...i, dist: 300 }));
  const merged = merge(items, [{ name: "St. Stephen's Cathedral, Vienna", wiki: "en:St. Stephen's Cathedral, Vienna", size: 190000, img: 'x.jpg', kind: 'attraction', lat: 48.2, lng: 16.37 }]);
  assert.equal(merged.length, 4, 'the cathedral is matched, not duplicated');
  assert.equal(merged[0].img, 'x.jpg');
  const secs = sections(merged, { vibes: ['Food', 'Cafés'], budget: 'Low' }, 2000);
  assert.equal(secs[0].items[0].name, 'Stephansdom');
  assert.equal(secs.find((s) => s.key === 'Food').items[0].name, 'Würstelstand');
  assert.equal(secs.find((s) => s.key === 'Cafés').items[0].name, 'Café Central');
  const plan = dayPlan(secs, new Date('2026-11-26T12:00:00').getTime());
  assert.deepEqual(plan.map((p) => p.it.name), ['Stephansdom', 'Würstelstand', 'Café Central']);
});
