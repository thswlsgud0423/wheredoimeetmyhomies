// Bottom timeline: play/pause, scrub, speed, skip. Drives one animation at a time.
const SPEEDS = [1, 2, 4, 0.5];

export function createPlayer(root) {
  const btn = root.querySelector('[data-act="toggle"]');
  const speedBtn = root.querySelector('[data-act="speed"]');
  const skipBtn = root.querySelector('[data-act="skip"]');
  const scrub = root.querySelector('.pl-scrub');
  const label = root.querySelector('.pl-label');
  let cur = null; // { durationMs, onFrame, onEnd, f, playing, last }
  let speedIdx = 0;
  let raf = 0;

  const loop = (now) => {
    raf = 0;
    if (!cur) return;
    if (cur.playing) {
      const dt = cur.last ? now - cur.last : 0;
      cur.f = Math.min(1, cur.f + (dt * SPEEDS[speedIdx]) / cur.durationMs);
    }
    cur.last = now;
    scrub.value = String(Math.round(cur.f * 1000));
    cur.onFrame(cur.f);
    if (cur.f >= 1 && cur.playing) {
      cur.playing = false;
      btn.textContent = '↻';
      const done = cur.onEnd; cur.onEnd = null;
      done?.();
    }
    if (cur && (cur.playing || cur.dirty)) { cur.dirty = false; raf = requestAnimationFrame(loop); }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  btn.addEventListener('click', () => {
    if (!cur) return;
    if (cur.f >= 1) { cur.f = 0; }
    cur.playing = !cur.playing;
    cur.last = 0;
    btn.textContent = cur.playing ? '⏸' : '▶';
    kick();
  });
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speedBtn.textContent = SPEEDS[speedIdx] + '×';
  });
  skipBtn.addEventListener('click', () => {
    if (!cur) return;
    cur.f = 1; cur.playing = true; kick();
  });
  scrub.addEventListener('input', () => {
    if (!cur) return;
    cur.f = +scrub.value / 1000;
    cur.playing = false; btn.textContent = '▶';
    cur.dirty = true; kick();
  });

  return {
    play({ durationMs, onFrame, onEnd, text }) {
      root.hidden = false;
      label.textContent = text;
      cur = { durationMs, onFrame, onEnd, f: 0, playing: true, last: 0 };
      btn.textContent = '⏸';
      kick();
      return new Promise((resolve) => {
        const end = cur.onEnd;
        cur.onEnd = () => { end?.(); resolve(); };
      });
    },
    stop() { cur = null; root.hidden = true; },
    get active() { return !!cur; },
  };
}
