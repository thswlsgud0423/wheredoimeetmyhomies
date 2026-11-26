// What travelers recommend, from Wikivoyage (free, written by travelers, CC BY-SA).
// We find the guide pages closest to the meeting point (e.g. "Seoul/Jung", "Vienna/Innere Stadt")
// and read their See / Do / Buy / Eat / Drink listings, with Budget / Mid-range / Splurge for food.
import { haversine } from '../geo.js';

const API = 'https://en.wikivoyage.org/w/api.php';
const KINDS = new Set(['see', 'do', 'buy', 'eat', 'drink']);

async function api(params) {
  const u = new URL(API);
  Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  // public API: retry once if it is busy
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`Wikivoyage ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error.info || 'Wikivoyage error');
      return j;
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((r) => setTimeout(r, 900));
    }
  }
}

// Guide pages around a point, closest first.
export async function nearbyGuides(pos, radius = 10000, limit = 5) {
  const j = await api({ action: 'query', list: 'geosearch', gscoord: `${pos[1]}|${pos[0]}`, gsradius: String(Math.min(10000, radius)), gslimit: '20' });
  return (j.query?.geosearch || []).slice(0, limit).map((g) => ({ title: g.title, dist: g.dist }));
}

export async function guideListings(pos, { radius = 3000, pages = 4 } = {}) {
  let guides = [];
  try { guides = await nearbyGuides(pos, Math.max(radius * 3, 6000), pages); } catch { return { items: [], guides: [] }; }
  if (!guides.length) return { items: [], guides: [] };
  let j;
  try { j = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: guides.map((g) => g.title).join('|') }); }
  catch { return { items: [], guides: [] }; }
  const items = [];
  for (const p of j.query?.pages || []) {
    const text = p.revisions?.[0]?.slots?.main?.content;
    if (!text) continue;
    const rank = guides.findIndex((g) => g.title === p.title);
    for (const it of parseListings(text)) {
      it.page = p.title;
      it.pageRank = rank;
      if (it.lat != null) it.dist = haversine(pos, [it.lng, it.lat]);
      items.push(it);
    }
  }
  // Keep what is close by. Listings without coordinates only from the nearest guide page.
  const kept = items.filter((it) => (it.dist != null ? it.dist <= radius : it.pageRank === 0));
  return { items: dedupe(kept), guides: guides.filter((g) => kept.some((it) => it.page === g.title)) };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = norm(it.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
export const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// ---------- wikitext ----------
export function parseListings(text) {
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  let section = '', sub = '';
  let i = 0;
  const heading = /^(={2,4})\s*([^=]+?)\s*\1\s*$/gm;
  const heads = [];
  for (let m; (m = heading.exec(text));) heads.push({ at: m.index, level: m[1].length, name: m[2].trim().toLowerCase() });
  let h = 0;
  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open < 0) break;
    while (h < heads.length && heads[h].at < open) {
      if (heads[h].level === 2) { section = heads[h].name; sub = ''; } else sub = heads[h].name;
      h++;
    }
    const close = matchBraces(text, open);
    if (close < 0) break;
    const body = text.slice(open + 2, close);
    const name = body.split(/[|\n]/, 1)[0].trim().toLowerCase();
    if (KINDS.has(name) || name === 'listing') {
      const it = listing(name, splitParams(body), section, sub);
      if (it) out.push(it);
    }
    i = close + 2;
  }
  return out;
}

function matchBraces(s, open) {
  let depth = 0;
  for (let k = open; k < s.length - 1; k++) {
    if (s[k] === '{' && s[k + 1] === '{') { depth++; k++; }
    else if (s[k] === '}' && s[k + 1] === '}') { depth--; if (depth === 0) return k; k++; }
  }
  return -1;
}

function splitParams(body) {
  const parts = [];
  let cur = '', sq = 0, cb = 0;
  for (let k = 0; k < body.length; k++) {
    const c = body[k], n = body[k + 1];
    if (c === '[' && n === '[') { sq++; cur += '[['; k++; continue; }
    if (c === ']' && n === ']') { sq--; cur += ']]'; k++; continue; }
    if (c === '{' && n === '{') { cb++; cur += '{{'; k++; continue; }
    if (c === '}' && n === '}') { cb--; cur += '}}'; k++; continue; }
    if (c === '|' && sq === 0 && cb === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return params;
}

export function clean(s) {
  return String(s || '')
    .replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{(?:lang|nowrap|transl)\|[^|{}]*\|([^{}|]*)[^{}]*\}\}/gi, '$1')
    .replace(/\{\{(?:km|mi|m|ft)\|([^{}|]*)[^{}]*\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BUDGET = { budget: 'Low', cheap: 'Low', 'mid-range': 'Medium', midrange: 'Medium', moderate: 'Medium', splurge: 'High', expensive: 'High' };

function listing(tpl, p, section, sub) {
  const kind = tpl === 'listing'
    ? (KINDS.has((p.type || '').toLowerCase()) ? p.type.toLowerCase() : KINDS.has(section) ? section : null)
    : tpl;
  if (!kind) return null;
  const name = clean(p.name);
  if (!name) return null;
  const lat = parseFloat(p.lat), lng = parseFloat(p.long);
  const wiki = p.wikipedia ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.wikipedia.replace(/ /g, '_'))}` : '';
  return {
    name,
    alt: clean(p.alt),
    kind,
    budget: kind === 'eat' || kind === 'drink' ? BUDGET[sub] || null : null,
    group: sub ? sub.replace(/^\w/, (c) => c.toUpperCase()) : '',
    desc: clean(p.content || p.description),
    price: clean(p.price),
    hours: clean(p.hours),
    url: /^https?:\/\//.test(p.url || '') ? p.url : '',
    wiki,
    wikidata: p.wikidata || '',
    wikiTitle: p.wikipedia || '',
    img: p.image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.image.replace(/ /g, '_'))}?width=320` : '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    source: 'wikivoyage',
  };
}
