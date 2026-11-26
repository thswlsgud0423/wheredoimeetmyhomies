// Left: the fair spot per mode and everyone's trip. Right: plans for what to do there.
import { MODES } from '../engine/fairness.js';
import { fmtMinutes, fmtKm } from '../geo.js';
import { ICONS, UI } from '../map/icons.js';
import { MODE_NAME } from '../map/journey.js';
import { esc } from './setup.js';
import { VIBES, sections, dayPlan } from '../data/guide.js';

export function placeTitle(c) {
  if (!c) return '';
  if (c.kind === 'station') return c.nameEn && c.nameEn !== c.name ? `${c.name} · ${c.nameEn}` : c.name;
  return c.name || 'Meeting spot';
}
export function placeSub(c) {
  if (c.kind === 'station') {
    const refs = [...new Set((c.lines || []).map((l) => l.ref || l.name).filter(Boolean))].slice(0, 5);
    return `Station${refs.length ? ' · ' + refs.join(', ') : ''}`;
  }
  if (c.kind === 'city') return `${c.country}${c.pop ? ' · ' + (c.pop >= 1e6 ? (c.pop / 1e6).toFixed(1) + 'M' : Math.round(c.pop / 1e3) + 'k') + ' people' : ''}`;
  return 'Area';
}

function legChip(l) {
  const label = l.line ? (l.line.ref || l.line.name).slice(0, 12) : l.mode === 'flight' ? `${l.from?.[0]}–${l.to?.[0]}` : '';
  const style = l.line?.colour ? ` style="--lc:${esc(l.line.colour)}"` : '';
  const stops = l.stopNames?.length > 1 ? ` · ${esc(l.stopNames[0])} → ${esc(l.stopNames[l.stopNames.length - 1])}` : '';
  return `<span class="leg${l.line?.colour ? ' lined' : ''}"${style} title="${esc(MODE_NAME[l.mode] || l.mode)} · ${fmtMinutes(l.end - l.start)}${stops}">${ICONS[l.mode] || ICONS.walk}${label ? `<em>${esc(label)}</em>` : ''}</span>`;
}

export function createResults(root, h) {
  let view = null; // { plan, mode, chosen: {mode: cand}, legs }

  function render() {
    const { plan, mode, chosen } = view;
    const c = chosen[mode];
    if (!c) {
      root.innerHTML = `<button class="link back">${UI.back} Friends</button>
        <div class="card"><h2>No place works for everyone</h2><p class="hint">With these ways to travel, nobody can reach a common place in time. Go back and allow more options, like flights between countries or trains between cities.</p></div>`;
      return;
    }
    const agree = ['equal', 'minimax', 'efficient'].every((m) => chosen[m]?.id === c.id);
    const max = c.stats.max;
    root.innerHTML = `
      <button class="link back">${UI.back} Friends</button>
      <div class="seg wide">
        ${Object.values(MODES).map((m) => `<button class="${m.key === mode ? 'on' : ''}" data-fair="${m.key}">${m.name}</button>`).join('')}
      </div>
      <div class="card winner">
        <div class="kicker">${MODES[mode].name}${agree ? ' · same pick in all 3 modes' : ''}</div>
        <h2 class="winner-name">${esc(placeTitle(c))}</h2>
        <div class="hint">${esc(placeSub(c))}</div>
        <div class="stats">
          <div><b>${fmtMinutes(c.stats.max)}</b><span>Longest trip</span></div>
          <div><b>${fmtMinutes(c.stats.spread)}</b><span>Difference</span></div>
          <div><b>${fmtMinutes(c.stats.sum)}</b><span>Total</span></div>
        </div>
        <ul class="trips">
          ${plan.people.map((p, i) => `
            <li class="trip" data-i="${i}" style="--c:${p.color}" title="Follow ${esc(p.name)} during the trip">
              <div class="trip-top"><span class="avatar-sm">${esc(p.name.slice(0, 1).toUpperCase())}</span><b>${esc(p.name)}</b><span class="trip-time">${fmtMinutes(c.times[i])}</span></div>
              <div class="bar"><span style="width:${Math.max(3, (c.times[i] / max) * 100)}%"></span></div>
              <div class="legs">${(view.legs?.[i] || []).map(legChip).join('')}</div>
            </li>`).join('')}
        </ul>
        <div class="row">
          <button class="secondary go" data-same="0">${UI.play} Replay trips</button>
          <button class="secondary go" data-same="1" title="Everyone arrives at the same time: see who has to leave first">Arrive together</button>
        </div>
        <button class="primary plans-open">${UI.list} What to do there</button>
      </div>
      <div class="group-head"><h2>Other good spots</h2></div>
      <ol class="list alts">
        ${plan.ranked[mode].slice(0, 6).map((a, k) => `
          <li class="alt ${a.id === c.id ? 'on' : ''}" data-id="${esc(a.id)}">
            <span class="rank">${k + 1}</span>
            <span class="alt-name">${esc(placeTitle(a))}</span>
            <small>${fmtMinutes(a.stats.max)} max</small>
          </li>`).join('')}
      </ol>
      ${plan.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
      <p class="hint small fine">${esc(plan.tierLabel)} · ${plan.cands.length} places compared</p>
    `;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, .alt, .trip');
    if (!t || !view) return;
    if (t.classList.contains('back')) return h.onBack();
    if (t.dataset.fair) return h.onMode(t.dataset.fair);
    if (t.classList.contains('alt')) return h.onSelect(view.plan.ranked[view.mode].find((a) => a.id === t.dataset.id));
    if (t.classList.contains('go')) return h.onJourney(t.dataset.same === '1');
    if (t.classList.contains('plans-open')) return h.onPlans();
    if (t.classList.contains('trip')) return h.onFollow(+t.dataset.i);
  });

  return {
    show(v) { view = v; render(); root.hidden = false; },
    update(patch) { if (view) { Object.assign(view, patch); render(); } },
    hide() { root.hidden = true; },
    get view() { return view; },
  };
}

// ---------- right panel: what to do there (Wikivoyage + Wikipedia, no AI) ----------
const KIND_LABEL = { see: 'Sight', do: 'Do', buy: 'Shop', eat: 'Eat', drink: 'Drink' };
const BUDGET_SIGN = { Low: '$', Medium: '$$', High: '$$$' };

export function createPlans(root, h) {
  let prefs = null, place = null, guide = null, arriveAt = 0, shown = [];

  function render() {
    root.innerHTML = `
      <div class="plans-head">
        <div>
          <div class="kicker">What to do near</div>
          <h2>${esc(place)}</h2>
        </div>
        <button class="icon-btn close" aria-label="Close">${UI.close}</button>
      </div>
      <div class="budget-row"><span class="hint small">Budget</span>
        <div class="seg small-text">${['Low', 'Medium', 'High'].map((b) => `<button class="${prefs.budget === b ? 'on' : ''}" data-budget="${b}">${BUDGET_SIGN[b]}</button>`).join('')}</div>
      </div>
      <div class="vibes">${Object.keys(VIBES).map((v) => `<button class="chip ${prefs.vibes.includes(v) ? 'on' : ''}" data-vibe="${esc(v)}">${esc(v)}</button>`).join('')}</div>
      <div class="plans-out">${guide ? '' : '<div class="loading"><span></span>Reading travel guides for this area…</div>'}</div>
    `;
    if (guide) fill();
  }

  function fill() {
    const out = root.querySelector('.plans-out');
    const secs = sections(guide.items, prefs, guide.radius);
    const plan = dayPlan(secs, arriveAt);
    shown = [];
    const card = (it) => {
      const k = shown.push(it) - 1;
      const meta = [
        it.dist != null ? `${fmtKm(it.dist)} away` : '',
        it.budget ? BUDGET_SIGN[it.budget] : '',
        it.price && it.price.length < 40 ? it.price : '',
      ].filter(Boolean).map(esc).join(' · ');
      return `<li class="spot" data-k="${k}" title="Show on the map">
        ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" />` : `<span class="spot-ph">${UI.pin}</span>`}
        <div class="spot-body">
          <div class="spot-top"><b>${esc(it.name)}</b>${it.alt && it.alt !== it.name && it.alt.length < 40 ? ` <span class="hint small">${esc(it.alt)}</span>` : ''}</div>
          ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
          <small class="hint">${meta}</small>
          <span class="spot-links">${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">Website</a>` : ''}${it.wiki ? `<a href="${esc(it.wiki)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</span>
        </div>
      </li>`;
    };
    out.innerHTML = !secs.length
      ? '<p class="note">The travel guides have nothing listed right around here. Try a nearby option from the bar below, or pick other vibes.</p>'
      : `${plan.length ? `<div class="group-head"><h2>A simple plan</h2><span class="hint small">after everyone arrives</span></div>
          <ol class="timeline">${plan.map((p) => `<li data-k="${shown.push(p.it) - 1}"><b>${esc(p.time)}</b><span><em>${esc(p.label)}</em> ${esc(p.it.name)}</span></li>`).join('')}</ol>` : ''}
        ${secs.map((s) => `<div class="group-head"><h2>${esc(s.title)}</h2></div><ul class="list spots">${s.items.map(card).join('')}</ul>`).join('')}
        <p class="hint small fine">Recommendations from travelers on ${guide.guides.map((g) => `<a href="https://en.wikivoyage.org/wiki/${encodeURIComponent(g.title.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wikivoyage: ${esc(g.title)}</a>`).join(', ') || 'Wikivoyage'} and photos from Wikipedia / Wikimedia Commons (CC BY-SA). Check opening hours before you go.</p>`;
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const t = e.target.closest('button, .spot, .timeline li');
    if (!t) return;
    if (t.classList.contains('close')) return h.onClose();
    if (t.dataset.budget) { prefs.budget = t.dataset.budget; render(); return; }
    if (t.dataset.vibe) {
      const v = t.dataset.vibe, list = prefs.vibes;
      list.includes(v) ? list.splice(list.indexOf(v), 1) : list.push(v);
      render();
      return;
    }
    if (t.dataset.k != null) h.onShow(shown[+t.dataset.k]);
  });

  return {
    open(placeName, p, at) { place = placeName; prefs = p; arriveAt = at; guide = null; render(); root.hidden = false; },
    setGuide(g) { guide = g; if (!root.hidden) render(); },
    close() { root.hidden = true; },
    get isOpen() { return !root.hidden; },
  };
}
