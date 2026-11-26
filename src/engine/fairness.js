// Three ways to call a meeting place "fair".
export const MODES = {
  equal: {
    key: 'equal', icon: '⚖️', name: 'Equal',
    blurb: 'Everyone travels about the same time (among places that are not too far for anyone).',
  },
  minimax: {
    key: 'minimax', icon: '🛟', name: 'No one suffers',
    blurb: 'The longest trip is as short as possible.',
  },
  efficient: {
    key: 'efficient', icon: '⚡', name: 'Efficient',
    blurb: "The group's total travel time is the lowest.",
  },
};

export function stats(times) {
  let max = -Infinity, min = Infinity, sum = 0;
  for (const t of times) { if (t > max) max = t; if (t < min) min = t; sum += t; }
  return { max, min, sum, spread: max - min, mean: sum / times.length };
}

// candidates: [{ times: number[] , ... }]. Returns candidates sorted best-first for `mode`,
// each with .stats. `slackMin` keeps "Equal" from picking a place that is equally
// terrible for everyone: only places whose longest trip is within 30% (+slack) of
// the best possible longest trip are eligible.
export function rank(candidates, mode, slackMin = 15) {
  const ok = candidates
    .filter((c) => c.times.every((t) => Number.isFinite(t)))
    .map((c) => ({ ...c, stats: c.stats ?? stats(c.times) }));
  if (!ok.length) return [];
  const bestMax = Math.min(...ok.map((c) => c.stats.max));
  const by = {
    minimax: (a, b) => a.stats.max - b.stats.max || a.stats.sum - b.stats.sum,
    efficient: (a, b) => a.stats.sum - b.stats.sum || a.stats.max - b.stats.max,
    // mostly "same time for everyone", but a little extra travel for all also counts against a place
    equal: (a, b) => eq(a) - eq(b) || a.stats.sum - b.stats.sum,
  }[mode];
  const eq = (c) => c.stats.spread + 0.5 * (c.stats.max - bestMax);
  let pool = ok;
  if (mode === 'equal') {
    const limit = bestMax * 1.25 + slackMin;
    pool = ok.filter((c) => c.stats.max <= limit);
  }
  return pool.slice().sort(by);
}
