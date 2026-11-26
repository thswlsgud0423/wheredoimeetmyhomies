// "What to do there" without AI: Wikivoyage listings (what travelers recommend) merged with
// Wikipedia's famous places, ranked by fame and distance, filtered by vibe and budget.
import { guideListings, norm } from './wikivoyage.js';
import { famousPlaces } from './load.js';
import { haversine } from '../geo.js';

const FOODISH = /restaurant|cafe|bar|pub|biergarten|marketplace|food_court|ice_cream|bakery|confectionery|pastry|chocolate/;

export async function loadGuide(pos, tier) {
  const radius = tier === 'city' ? 1800 : 4000;
  const [wv, famous] = await Promise.all([
    guideListings(pos, { radius, pages: tier === 'city' ? 4 : 3 }).then(async (g) => { await addFame(g.items); return g; }),
    famousPlaces(pos, tier === 'city' ? 2500 : 6000),
  ]);
  for (const f of famous) f.dist = haversine(pos, [f.lng, f.lat]);
  return { items: merge(wv.items, famous.filter((f) => f.dist <= radius * 1.4)), guides: wv.guides, radius };
}

// How famous a listing is: in how many languages Wikipedia has an article about it (Wikidata sitelinks).
// The Louvre has ~200, a neighbourhood museum a handful.
async function addFame(items) {
  const withId = items.filter((it) => /^Q\d+$/.test(it.wikidata) && it.kind !== 'buy');
  for (let k = 0; k < withId.length; k += 50) {
    const batch = withId.slice(k, k + 50);
    const u = new URL('https://www.wikidata.org/w/api.php');
    Object.entries({ action: 'query', format: 'json', formatversion: '2', origin: '*', prop: 'pageprops', ppprop: 'wb-sitelinks', titles: batch.map((it) => it.wikidata).join('|') })
      .forEach(([key, v]) => u.searchParams.set(key, v));
    try {
      const links = new Map(((await (await fetch(u)).json()).query?.pages || []).map((pg) => [pg.title, +(pg.pageprops?.['wb-sitelinks'] || 0)]));
      for (const it of batch) {
        it.langs = links.get(it.wikidata) || 0;
        it.fame = Math.max(it.fame || 0, it.langs * 1500);
      }
    } catch { /* keep the default */ }
  }
}

// Wikivoyage first; Wikipedia adds photos, a "famous" signal, and sights the guide lacks.
export function merge(voyage, famous) {
  const items = voyage.map((it) => ({ ...it, fame: Math.max(it.fame || 0, it.wikidata || it.wiki ? 6000 : 0) }));
  const index = new Map();
  items.forEach((it) => [it.name, it.alt, it.wikiTitle].forEach((n) => n && index.set(norm(n), it)));
  for (const f of famous) {
    const hit = [f.name, f.nameEn, f.wiki?.split(':').slice(1).join(':')].map(norm).find((k) => k && index.has(k));
    if (hit) {
      const it = index.get(hit);
      it.fame = Math.max(it.fame, f.size || 0);
      if (!it.img && f.img) it.img = f.img;
      if (!it.wiki && f.url) it.wiki = f.url;
      continue;
    }
    const kind = FOODISH.test(f.kind) ? (/cafe|bar|pub|biergarten|ice_cream/.test(f.kind) ? 'drink' : 'eat') : 'see';
    items.push({
      name: f.nameEn || f.name, alt: f.nameEn && f.nameEn !== f.name ? f.name : '', kind, budget: null, group: '',
      desc: f.desc || '', price: '', hours: '', url: '', wiki: f.url || '', img: f.img || '',
      lat: f.lat, lng: f.lng, dist: f.dist, fame: f.size || 0, source: 'wikipedia',
    });
    [f.name, f.nameEn].forEach((n) => n && index.set(norm(n), items[items.length - 1]));
  }
  return items;
}

export function score(it, radius) {
  const fame = it.fame ? Math.log10(Math.max(10, it.fame)) - 2.5 : 0; // ~0 .. 3
  const words = Math.min(1.5, (it.desc || '').length / 160);
  const closeness = it.dist != null ? 1 - Math.min(1, it.dist / radius) : 0.25;
  const food = it.kind === 'eat' || it.kind === 'drink';
  // sights: how famous matters most; food and drinks: being close matters more
  const near = closeness * (food ? 1.6 : 0.7) + (food && it.dist != null && it.dist < 400 ? 0.8 : 0);
  return fame * (food ? 1.2 : 1.8) + words + near + (it.img ? 0.4 : 0) + (it.url ? 0.2 : 0) + (it.source === 'wikivoyage' ? 0.5 : 0);
}

const text = (it) => `${it.name} ${it.alt} ${it.group} ${it.desc}`;
const isCafe = (it) => (it.kind === 'eat' || it.kind === 'drink') && /caf[eé]|coffee|kaffee|tea ?house|teahouse|bakery|konditorei|patisser|dessert|cake|bingsu|gelat|ice cream/i.test(text(it));
const isNature = (it) => /\b(park|garden|gardens|forest|woods|river|lake|mountain|hill|trail|hike|beach|island|botanic|zoo|nature|promenade)\b/i.test(text(it));
const isIndoor = (it) => /museum|gallery|mall|shopping cent|department store|market hall|cinema|spa|bath|aquarium|library|theat|opera|concert|arcade|karaoke|bowling/i.test(text(it)) || isCafe(it);

export const VIBES = {
  Food: { label: 'Food', test: (it) => it.kind === 'eat' && !isCafe(it) },
  Cafés: { label: 'Cafés & desserts', test: isCafe },
  Culture: { label: 'Culture', test: (it) => it.kind === 'see' && /museum|gallery|palace|church|cathedral|temple|shrine|castle|theat|opera|histor|monument|art|library|tomb|memorial|gate/i.test(text(it)) },
  Nature: { label: 'Parks & nature', test: (it) => (it.kind === 'see' || it.kind === 'do') && isNature(it) },
  Nightlife: { label: 'Bars & nightlife', test: (it) => it.kind === 'drink' && !isCafe(it) },
  Shopping: { label: 'Shopping', test: (it) => it.kind === 'buy' },
  Activities: { label: 'Things to do', test: (it) => it.kind === 'do' },
  'Photo spots': { label: 'Photo spots', test: (it) => (it.kind === 'see' || it.kind === 'do') && /view|tower|observ|lookout|bridge|skyline|panoram|square|plaza|fountain|street|alley|rooftop/i.test(text(it)) },
  'Rainy day': { label: 'Good on a rainy day', test: (it) => it.kind !== 'buy' && isIndoor(it) && !isNature(it) },
};

const BUDGET_ORDER = { Low: 0, Medium: 1, High: 2 };
function budgetFit(it, budget) {
  if (!it.budget) return 0;
  const d = Math.abs(BUDGET_ORDER[it.budget] - BUDGET_ORDER[budget]);
  return d === 0 ? 0.8 : d === 1 ? -0.3 : -2;
}

// "The Louvre", "Musée du Louvre" and "Louvre Palace" are one place: close together and sharing a name word.
const GENERIC = new Set(['museum', 'musee', 'church', 'eglise', 'palace', 'palais', 'cathedral', 'temple', 'garden', 'gardens', 'street', 'market', 'station', 'square', 'tower', 'gallery', 'house', 'hotel', 'restaurant', 'saint', 'national', 'royal', 'grand']);
const words = (it) => new Set(`${it.name} ${it.alt}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !GENERIC.has(w)));
function samePlace(a, b) {
  if (a.lat == null || b.lat == null) return false;
  const d = Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180));
  if (d > 250) return false;
  const wa = words(a);
  return [...words(b)].some((w) => wa.has(w));
}

// Sections to show for the chosen vibes and budget. Each place appears once.
export function sections(items, { vibes, budget }, radius) {
  const ranked = items.map((it) => ({ it, s: score(it, radius) }));
  const used = new Set();
  const take = (test, n, bonus = () => 0) => {
    const list = [];
    const sorted = ranked.filter(({ it }) => !used.has(it) && test(it))
      .map(({ it, s }) => ({ it, s: s + bonus(it) }))
      .sort((a, b) => b.s - a.s);
    for (const { it } of sorted) {
      if (list.length >= n) break;
      if ([...used].some((u) => samePlace(u, it))) continue;
      list.push(it);
      used.add(it);
    }
    return list;
  };
  const out = [];
  const must = take((it) => it.kind === 'see' && (!vibes.includes('Rainy day') || isIndoor(it)), 6);
  if (must.length) out.push({ key: 'must', title: 'Must-see', items: must });
  for (const v of vibes) {
    const def = VIBES[v];
    if (!def) continue;
    const food = v === 'Food' || v === 'Cafés' || v === 'Nightlife';
    const list = take(def.test, food ? 6 : 5, food ? (it) => budgetFit(it, budget) : undefined);
    if (list.length) out.push({ key: v, title: def.label, items: list });
  }
  return out;
}

// A simple day plan: sight, meal, another sight or activity, café or drinks.
export function dayPlan(secs, arriveAt) {
  const pick = (keys) => {
    for (const k of keys) for (const s of secs) if (s.key === k && s.items.length) return s.items.find((it) => !chosen.has(it));
    return null;
  };
  const chosen = new Set();
  const step = (it) => { if (it) chosen.add(it); return it; };
  const t = new Date(arriveAt);
  t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);
  const meal = (h) => (h < 11 ? 'Brunch' : h < 16 ? 'Lunch' : 'Dinner');
  const plan = [];
  const add = (label, it, mins) => {
    if (!it) return;
    plan.push({ time: t.toTimeString().slice(0, 5), label, it });
    t.setMinutes(t.getMinutes() + mins);
  };
  add('First stop', step(pick(['must', 'Culture', 'Photo spots', 'Nature'])), 75);
  add(meal(t.getHours()), step(pick(['Food', 'Cafés'])), 75);
  add('Then', step(pick(['Culture', 'Activities', 'Nature', 'Photo spots', 'Shopping', 'must', 'Rainy day'])), 75);
  add(t.getHours() >= 18 ? 'Drinks' : 'Coffee break', step(pick(t.getHours() >= 18 ? ['Nightlife', 'Cafés'] : ['Cafés', 'Nightlife'])), 60);
  return plan;
}
