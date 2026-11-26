// Left: the fair spot per mode and everyone's trip. Right: plans for what to do there.
import { MODES } from '../engine/fairness.js';
import { fmtMinutes } from '../geo.js';
import { ICONS, UI } from '../map/icons.js';
import { MODE_NAME } from '../map/journey.js';
import { esc } from './setup.js';

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

export const VIBES = ['Food', 'Nightlife', 'Cafés', 'Culture', 'Nature', 'Shopping', 'Activities', 'Photo spots', 'Chill', 'Rainy day'];
const LANGS = ['English', '한국어', '日本語', '中文', 'Español', 'Français', 'Deutsch'];

export function seasonFor(lat, date = new Date()) {
  const north = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'][date.getMonth()];
  return lat >= 0 ? north : { Winter: 'Summer', Summer: 'Winter', Spring: 'Autumn', Autumn: 'Spring' }[north];
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
        <div class="card"><h2>No place works for everyone</h2><p class="hint">In this model nobody can reach a common place. Try public transport or a car instead of walking.</p></div>`;
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

// ---------- right panel: plans ----------
export function createPlans(root, h) {
  let prefs = null, place = null;

  function render() {
    root.innerHTML = `
      <div class="plans-head">
        <div>
          <div class="kicker">Plans near</div>
          <h2>${esc(place)}</h2>
        </div>
        <button class="icon-btn close" aria-label="Close plans">${UI.close}</button>
      </div>
      <div class="prefs">
        <label>Season<select class="p-season">${['Spring', 'Summer', 'Autumn', 'Winter'].map((s) => `<option ${s === prefs.season ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Budget<select class="p-budget">${['Low', 'Medium', 'High'].map((s) => `<option ${s === prefs.budget ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Language<select class="p-lang">${LANGS.map((s) => `<option ${s === prefs.lang ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      <div class="vibes">${VIBES.map((v) => `<button class="chip ${prefs.vibes.includes(v) ? 'on' : ''}" data-vibe="${esc(v)}">${v}</button>`).join('')}</div>
      <textarea class="p-notes" rows="2" placeholder="Anything else? A vegetarian friend, a birthday, love karaoke…">${esc(prefs.notes)}</textarea>
      <button class="secondary ask">${UI.sparkle} Update plans</button>
      <div class="plans-out"></div>
    `;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('close')) return h.onClose();
    if (t.dataset.vibe) {
      const v = t.dataset.vibe, list = prefs.vibes;
      list.includes(v) ? list.splice(list.indexOf(v), 1) : list.push(v);
      t.classList.toggle('on');
      return;
    }
    if (t.classList.contains('ask')) { read(); h.onAsk(prefs); }
  });
  function read() {
    prefs.season = root.querySelector('.p-season').value;
    prefs.budget = root.querySelector('.p-budget').value;
    prefs.lang = root.querySelector('.p-lang').value;
    prefs.notes = root.querySelector('.p-notes').value;
  }

  return {
    open(placeName, p) { place = placeName; prefs = p; render(); root.hidden = false; },
    close() { root.hidden = true; },
    get out() { return root.querySelector('.plans-out'); },
    get isOpen() { return !root.hidden; },
  };
}

const CAT = { food: 'Food', drinks: 'Drinks', cafe: 'Café', sights: 'Sights', culture: 'Culture', nature: 'Nature', shopping: 'Shopping', activity: 'Activity', nightlife: 'Nightlife', event: 'Event', stay: 'Stay' };

export function renderIdeas(out, data, pois, onShow) {
  const byName = new Map(pois.map((p) => [p.name, p]));
  out.innerHTML = `
    <p class="summary"><b>${esc(data.headline)}</b> ${esc(data.summary)}</p>
    <ul class="list picks">
      ${data.picks.map((p, k) => `
        <li class="pick ${byName.has(p.place_name) ? 'mappable' : ''}" data-k="${k}">
          <div class="pick-top"><span class="cat cat-${esc(p.category)}">${CAT[p.category] || esc(p.category)}</span><span class="hint">${esc(p.cost)}</span></div>
          <b>${esc(p.title)}</b>
          <div class="pick-place">${esc(p.place_name)}${byName.has(p.place_name) ? ' · show on map' : ''}</div>
          <p>${esc(p.why)}</p>
          <small class="hint">${esc(p.when)}</small>
        </li>`).join('')}
    </ul>
    ${data.day_plan?.length ? `<div class="group-head"><h2>Day plan</h2></div><ol class="timeline">${data.day_plan.map((d) => `<li><b>${esc(d.time)}</b><span>${esc(d.activity)}</span></li>`).join('')}</ol>` : ''}
    ${data.tips?.length ? `<div class="group-head"><h2>Tips</h2></div><ul class="tips">${data.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <p class="hint small fine">Ideas by ${esc(data.model || 'Claude')}. Check opening hours and prices before you go.</p>
  `;
  out.querySelectorAll('.pick.mappable').forEach((li) => li.addEventListener('click', () => onShow(byName.get(data.picks[+li.dataset.k].place_name))));
}

const GROUPS = [
  ['Food & drink', /restaurant|cafe|bar|pub|ice_cream|food_court/],
  ['Sights & culture', /attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium/],
  ['Parks', /park|garden/],
  ['Shopping & fun', /mall|department_store|books|bowling|escape|arcade/],
];

export function renderPoiFallback(out, message, pois, onShow) {
  out.innerHTML = `<p class="note">${esc(message)}</p>` + (pois.length ? GROUPS.map(([label, re]) => {
    const list = pois.filter((p) => re.test(p.kind)).slice(0, 8);
    if (!list.length) return '';
    return `<div class="group-head"><h2>${label}</h2></div><ul class="list poi-list">${list.map((p) => `<li data-n="${esc(p.name)}"><b>${esc(p.name)}</b>${p.nameEn && p.nameEn !== p.name ? ` <span class="hint">${esc(p.nameEn)}</span>` : ''}<small class="hint">${esc(p.cuisine || p.kind.replace(/_/g, ' '))}</small></li>`).join('')}</ul>`;
  }).join('') : '<p class="hint">No places found nearby in OpenStreetMap.</p>');
  out.querySelectorAll('.poi-list li').forEach((li) => li.addEventListener('click', () => onShow(pois.find((p) => p.name === li.dataset.n))));
}
