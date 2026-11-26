// Results: the fair spot for each mode, everyone's trip, alternatives, and AI ideas.
import { MODES } from '../engine/fairness.js';
import { fmtMinutes } from '../geo.js';
import { MODE_ICON, MODE_NAME } from '../map/journey.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function placeTitle(c) {
  if (!c) return '';
  if (c.kind === 'station') return `${c.name}${c.nameEn && c.nameEn !== c.name ? ` · ${c.nameEn}` : ''}`;
  if (c.kind === 'city') return c.name;
  return c.name || 'This spot';
}
export function placeSub(c) {
  if (c.kind === 'station') {
    const refs = [...new Set((c.lines || []).map((l) => l.ref || l.name).filter(Boolean))].slice(0, 6);
    return `Station${refs.length ? ' · lines ' + refs.join(', ') : ''}`;
  }
  if (c.kind === 'city') return `${c.country}${c.capital ? ' · capital' : ''}${c.pop ? ' · ' + (c.pop / 1e6 >= 1 ? (c.pop / 1e6).toFixed(1) + 'M' : Math.round(c.pop / 1e3) + 'k') + ' people' : ''}`;
  return 'Area';
}

export const VIBES = ['🍜 Food', '🍻 Nightlife', '☕ Cafés', '🏛️ Culture', '🌳 Nature', '🛍️ Shopping', '🎳 Activities', '📸 Photo spots', '🧘 Chill', '🌧️ Rainy day'];
const LANGS = ['English', '한국어', '日本語', '中文', 'Español', 'Français', 'Deutsch'];

export function seasonFor(lat, date = new Date()) {
  const m = date.getMonth();
  const north = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'][m];
  if (lat >= 0) return north;
  return { Winter: 'Summer', Summer: 'Winter', Spring: 'Autumn', Autumn: 'Spring' }[north];
}

export function createResults(root, h) {
  let view = null; // { plan, mode, chosen: {mode: cand}, legs, sameArrival }

  function render() {
    const { plan, mode, chosen } = view;
    const c = chosen[mode];
    if (!c) {
      root.innerHTML = `<button class="ghost back">← Edit friends</button>
        <div class="empty-result"><h2>No place works for everyone</h2><p>Nobody can reach a common place in this model. Try public transport or a car instead of walking.</p></div>`;
      return;
    }
    const agree = ['equal', 'minimax', 'efficient'].every((m) => chosen[m]?.id === c.id);
    const legs = view.legs;
    const max = c.stats.max;
    root.innerHTML = `
      <button class="ghost back">← Edit friends</button>
      <div class="tier">${esc(plan.tierLabel)} · ${plan.cands.length} candidate places scored</div>
      <div class="mode-tabs">
        ${Object.values(MODES).map((m) => `
          <button class="mtab ${m.key === mode ? 'on' : ''}" data-fair="${m.key}">
            <span>${m.icon} ${m.name}</span><b>${esc(placeTitle(chosen[m.key]) || '—')}</b>
          </button>`).join('')}
      </div>
      <div class="winner">
        <div class="winner-kicker">${MODES[mode].icon} ${MODES[mode].name} pick${agree ? ' · <span class="agree">all 3 modes agree</span>' : ''}</div>
        <h2 class="winner-name">${esc(placeTitle(c))}</h2>
        <div class="winner-sub">${esc(placeSub(c))}</div>
        <div class="stats">
          <div><b>${fmtMinutes(c.stats.max)}</b><span>longest trip</span></div>
          <div><b>${fmtMinutes(c.stats.spread)}</b><span>gap</span></div>
          <div><b>${fmtMinutes(c.stats.sum)}</b><span>total</span></div>
        </div>
        <ul class="trips">
          ${plan.people.map((p, i) => `
            <li class="trip" data-i="${i}" style="--c:${p.color}" title="Follow ${esc(p.name)}">
              <div class="trip-top"><span class="dot"></span><b>${esc(p.name)}</b><span class="trip-time">${fmtMinutes(c.times[i])}</span></div>
              <div class="bar"><span style="width:${Math.max(3, (c.times[i] / max) * 100)}%"></span></div>
              <div class="legs">${(legs?.[i] || []).map(legChip).join('<i>›</i>')}</div>
            </li>`).join('')}
        </ul>
        <div class="row">
          <button class="primary go" data-same="0">▶ Watch everyone travel</button>
          <button class="ghost go" data-same="1" title="Everyone arrives at the same time: see who must leave first">⏰ Arrive together</button>
        </div>
      </div>
      <details class="alts" open>
        <summary>Other good spots (${MODES[mode].name})</summary>
        <ol>
          ${plan.ranked[mode].slice(0, 6).map((a) => `
            <li class="alt ${a.id === c.id ? 'on' : ''}" data-id="${esc(a.id)}">
              <span>${esc(placeTitle(a))}</span><small>max ${fmtMinutes(a.stats.max)} · gap ${fmtMinutes(a.stats.spread)}</small>
            </li>`).join('')}
        </ol>
      </details>
      ${plan.notes.map((n) => `<p class="note">ℹ️ ${esc(n)}</p>`).join('')}
      <section class="ideas">
        <h2>What should we do there?</h2>
        <div class="prefs">
          <label>Season <select class="p-season">${['Spring', 'Summer', 'Autumn', 'Winter'].map((s) => `<option ${s === view.prefs.season ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Budget <select class="p-budget">${['$ cheap', '$$ medium', '$$$ splurge'].map((s) => `<option ${s === view.prefs.budget ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Language <select class="p-lang">${LANGS.map((s) => `<option ${s === view.prefs.lang ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        <div class="vibes">${VIBES.map((v) => `<button class="chip ${view.prefs.vibes.includes(v) ? 'on' : ''}" data-vibe="${esc(v)}">${v}</button>`).join('')}</div>
        <textarea class="p-notes" rows="2" placeholder="Anything else? e.g. one of us is vegetarian, we love karaoke, it's a birthday…">${esc(view.prefs.notes)}</textarea>
        <button class="primary ask">🤖 Get ideas</button>
        <div class="ideas-out"></div>
      </section>
    `;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, .alt, .trip');
    if (!t || !view) return;
    if (t.classList.contains('back')) return h.onBack();
    if (t.dataset.fair) return h.onMode(t.dataset.fair);
    if (t.classList.contains('alt')) return h.onSelect(view.plan.ranked[view.mode].find((a) => a.id === t.dataset.id));
    if (t.classList.contains('go')) return h.onJourney(t.dataset.same === '1');
    if (t.classList.contains('trip')) return h.onFollow(+t.dataset.i);
    if (t.dataset.vibe) {
      const v = t.dataset.vibe, list = view.prefs.vibes;
      list.includes(v) ? list.splice(list.indexOf(v), 1) : list.push(v);
      t.classList.toggle('on');
      return;
    }
    if (t.classList.contains('ask')) {
      readPrefs();
      return h.onIdeas(view.prefs, root.querySelector('.ideas-out'));
    }
  });

  function readPrefs() {
    const p = view.prefs;
    p.season = root.querySelector('.p-season').value;
    p.budget = root.querySelector('.p-budget').value;
    p.lang = root.querySelector('.p-lang').value;
    p.notes = root.querySelector('.p-notes').value;
  }

  return {
    show(v) { view = v; render(); root.hidden = false; },
    update(patch) { if (view) { const out = root.querySelector('.ideas-out')?.innerHTML; Object.assign(view, patch); render(); if (out && !patch.clearIdeas) root.querySelector('.ideas-out').innerHTML = out; } },
    hide() { root.hidden = true; },
    get view() { return view; },
  };
}

function legChip(l) {
  const label = l.line ? (l.line.ref || l.line.name).slice(0, 14) : l.mode === 'flight' ? `${l.from?.[0]}→${l.to?.[0]}` : '';
  const style = l.line?.colour ? ` style="--lc:${esc(l.line.colour)}"` : '';
  return `<span class="leg"${style} title="${esc(MODE_NAME[l.mode] || l.mode)} · ${fmtMinutes(l.end - l.start)}${l.stopNames?.length ? ' · ' + esc(l.stopNames[0]) + ' → ' + esc(l.stopNames[l.stopNames.length - 1]) : ''}">${MODE_ICON[l.mode] || '•'}${label ? `<em>${esc(label)}</em>` : ''}</span>`;
}

export function renderIdeas(out, data, pois, onShow) {
  const byName = new Map(pois.map((p) => [p.name, p]));
  out.innerHTML = `
    <div class="idea-head"><h3>${esc(data.headline)}</h3><p>${esc(data.summary)}</p></div>
    <ul class="picks">
      ${data.picks.map((p, k) => `
        <li class="pick cat-${esc(p.category)}">
          <div class="pick-top"><b>${esc(p.title)}</b><span class="cost">${esc(p.cost)}</span></div>
          <div class="pick-place">${esc(p.place_name)}${byName.has(p.place_name) ? ` <button class="mini show" data-k="${k}">📍 map</button>` : ''}</div>
          <p>${esc(p.why)}</p>
          <small>🕒 ${esc(p.when)}</small>
        </li>`).join('')}
    </ul>
    ${data.day_plan?.length ? `<h3>Day plan</h3><ol class="dayplan">${data.day_plan.map((d) => `<li><b>${esc(d.time)}</b> ${esc(d.activity)}</li>`).join('')}</ol>` : ''}
    ${data.tips?.length ? `<h3>Tips</h3><ul class="tips">${data.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <p class="hint small fine">AI suggestions by ${esc(data.model || 'Claude')} — check opening hours and prices before you go.</p>
  `;
  out.querySelectorAll('.show').forEach((b) => b.addEventListener('click', () => onShow(byName.get(data.picks[+b.dataset.k].place_name))));
}

const GROUPS = [
  ['🍜 Food & drink', /restaurant|cafe|bar|pub|ice_cream|food_court/],
  ['🏛️ Sights & culture', /attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium/],
  ['🌳 Parks', /park|garden/],
  ['🛍️ Shopping & fun', /mall|department_store|books|bowling|escape|arcade/],
];

export function renderPoiFallback(out, message, pois, onShow) {
  out.innerHTML = `<p class="note">${esc(message)}</p>` + (pois.length ? GROUPS.map(([label, re]) => {
    const list = pois.filter((p) => re.test(p.kind)).slice(0, 8);
    if (!list.length) return '';
    return `<h3>${label}</h3><ul class="poi-list">${list.map((p) => `<li data-n="${esc(p.name)}"><b>${esc(p.name)}</b>${p.nameEn && p.nameEn !== p.name ? ` <small>${esc(p.nameEn)}</small>` : ''} <span>${esc(p.cuisine || p.kind.replace(/_/g, ' '))}</span></li>`).join('')}</ul>`;
  }).join('') : '<p class="hint">No places found nearby in OpenStreetMap.</p>');
  out.querySelectorAll('.poi-list li').forEach((li) => li.addEventListener('click', () => onShow(pois.find((p) => p.name === li.dataset.n))));
}
