// "Who's coming" editor: you plus up to 10 friends, each with a start point and a way to travel.
import { searchPlaces } from '../data/load.js';
import { MODES } from '../engine/fairness.js';
import { ICONS, UI } from '../map/icons.js';

// Apple system colors (blue is kept for the meeting place / accent).
export const COLORS = ['#ff9500', '#34c759', '#af52de', '#ff2d55', '#30b0c7', '#5856d6', '#ff3b30', '#e6b800', '#a2845e', '#00c7be', '#8e8e93'];
export const MAX_FRIENDS = 10;
const TRAVEL = [
  { key: 'transit', icon: ICONS.subway, label: 'Public transport' },
  { key: 'car', icon: ICONS.car, label: 'Car' },
  { key: 'walk', icon: ICONS.walk, label: 'Walk' },
];

export const SAMPLES = {
  seoul: {
    label: 'Seoul',
    people: [
      ['You', 'Gangnam Station', 127.0276, 37.4979],
      ['Minji', 'Hongik Univ. (Hongdae)', 126.9237, 37.5563],
      ['Jun', 'Jamsil', 127.1001, 37.5133],
      ['Sora', 'Nowon', 127.0617, 37.6551],
    ],
  },
  asia: {
    label: 'East Asia',
    people: [
      ['You', 'Seoul', 126.978, 37.566],
      ['Yuki', 'Tokyo', 139.692, 35.69],
      ['Wei', 'Taipei', 121.565, 25.033],
      ['Lin', 'Shanghai', 121.474, 31.23],
    ],
  },
  europe: {
    label: 'Europe',
    people: [
      ['You', 'London', -0.1276, 51.5072],
      ['Léa', 'Paris', 2.3522, 48.8566],
      ['Max', 'Berlin', 13.405, 52.52],
      ['Lucía', 'Madrid', -3.7038, 40.4168],
      ['Marco', 'Rome', 12.4964, 41.9028],
    ],
  },
  world: {
    label: 'Worldwide',
    people: [
      ['You', 'Seoul', 126.978, 37.566],
      ['Sam', 'New York', -74.006, 40.7128],
      ['Priya', 'Mumbai', 72.8777, 19.076],
      ['Ella', 'London', -0.1276, 51.5072],
    ],
  },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createSetup(root, { state, onChange, onFind, onPickOnMap, getBias }) {
  function render() {
    const friends = state.people.length - 1;
    root.innerHTML = `
      <div class="samples">
        <span class="hint">Examples</span>
        ${Object.entries(SAMPLES).map(([k, s]) => `<button class="chip" data-sample="${k}">${s.label}</button>`).join('')}
      </div>
      <div class="group-head"><h2>Who's coming</h2><span class="hint">You + ${friends} friend${friends === 1 ? '' : 's'}</span></div>
      <ul class="people list">
        ${state.people.map((p, i) => `
          <li class="person" data-i="${i}" style="--c:${p.color}">
            <span class="avatar-sm">${esc(p.name.slice(0, 1).toUpperCase())}</span>
            <div class="person-main">
              <div class="person-top">
                <input class="name" value="${esc(p.name)}" maxlength="16" aria-label="Name" />
                <div class="seg small" role="group" aria-label="How ${esc(p.name)} travels">
                  ${TRAVEL.map((t) => `<button class="${p.mode === t.key ? 'on' : ''}" data-mode="${t.key}" title="${t.label}" aria-label="${t.label}">${t.icon}</button>`).join('')}
                </div>
              </div>
              <div class="where">
                <input class="place" placeholder="Search a place or address" value="${esc(p.place || '')}" autocomplete="off" aria-label="Where ${esc(p.name)} starts" />
                <button class="icon-btn pick" title="Pick on the map" aria-label="Pick on the map">${UI.pin}</button>
                ${i > 0 ? `<button class="icon-btn remove" title="Remove" aria-label="Remove ${esc(p.name)}">${UI.close}</button>` : ''}
                <ul class="suggest" hidden></ul>
              </div>
            </div>
          </li>`).join('')}
      </ul>
      <button class="link add" ${friends >= MAX_FRIENDS ? 'disabled' : ''}>Add a friend <span class="hint">${friends}/${MAX_FRIENDS}</span></button>

      <div class="group-head"><h2>What counts as fair?</h2></div>
      <div class="seg wide">
        ${Object.values(MODES).map((m) => `<button class="${state.mode === m.key ? 'on' : ''}" data-fair="${m.key}">${m.name}</button>`).join('')}
      </div>
      <p class="hint small">${MODES[state.mode].blurb} All three are computed, so you can switch later.</p>

      <button class="primary find" ${state.people.filter((p) => p.pos).length < 2 ? 'disabled' : ''}>Find the fair spot</button>
      <p class="hint small fine">Travel times are estimates: real rail lines from OpenStreetMap in cities, average road and rail speeds between cities, and flights between major airports.</p>
    `;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const li = t.closest('.person');
    const i = li ? +li.dataset.i : -1;
    if (t.dataset.sample) {
      const s = SAMPLES[t.dataset.sample];
      state.people = s.people.map(([name, place, lng, lat], k) => ({ id: k, name, place, pos: [lng, lat], mode: 'transit', color: COLORS[k] }));
      render(); onChange(); return;
    }
    if (t.dataset.mode) { state.people[i].mode = t.dataset.mode; render(); onChange(); return; }
    if (t.classList.contains('remove')) { state.people.splice(i, 1); recolor(); render(); onChange(); return; }
    if (t.classList.contains('add')) {
      const k = state.people.length;
      state.people.push({ id: Date.now(), name: `Friend ${k}`, place: '', pos: null, mode: 'transit', color: COLORS[k] });
      render(); onChange();
      root.querySelector(`.person[data-i="${k}"] .place`)?.focus();
      return;
    }
    if (t.classList.contains('pick')) { onPickOnMap(i); return; }
    if (t.dataset.fair) { state.mode = t.dataset.fair; render(); onChange(); return; }
    if (t.classList.contains('find')) onFind();
  });

  root.addEventListener('input', (e) => {
    const li = e.target.closest('.person');
    if (!li) return;
    const i = +li.dataset.i;
    if (e.target.classList.contains('name')) {
      state.people[i].name = e.target.value || `Friend ${i}`;
      li.querySelector('.avatar-sm').textContent = state.people[i].name.slice(0, 1).toUpperCase();
      onChange();
    }
    if (e.target.classList.contains('place')) suggest(li, i, e.target.value);
  });

  let timer = 0, seq = 0;
  function suggest(li, i, q) {
    clearTimeout(timer);
    const box = li.querySelector('.suggest');
    if (q.trim().length < 2) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      let items = [];
      try { items = await searchPlaces(q, getBias()); } catch { /* offline */ }
      if (my !== seq) return;
      box.innerHTML = items.length
        ? items.map((it, k) => `<li data-k="${k}"><b>${esc(it.name)}</b><span>${esc(it.sub)}</span></li>`).join('')
        : '<li class="empty">No matches</li>';
      box.hidden = false;
      box.onclick = (ev) => {
        const row = ev.target.closest('li[data-k]');
        if (!row) return;
        const it = items[+row.dataset.k];
        Object.assign(state.people[i], { pos: it.pos, place: it.name });
        render(); onChange();
      };
    }, 280);
  }

  function recolor() { state.people.forEach((p, k) => { p.color = COLORS[k]; }); }

  render();
  return { render };
}
