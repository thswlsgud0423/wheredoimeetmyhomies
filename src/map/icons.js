// Simple line icons for vehicles (24×24, drawn with currentColor). Planes point north.
const svg = (body, fill = false) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  walk: svg('<circle cx="13" cy="4.5" r="2"/><path d="M9 21l2.5-6.5L14 17v4"/><path d="M8 11l3-3.5 3 1.5 2 3"/><path d="M11 7.5l-1 5 4 2.5"/>'),
  bus: svg('<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14"/><path d="M8 21v-3M16 21v-3"/><circle cx="8.5" cy="14.5" r=".6" fill="currentColor"/><circle cx="15.5" cy="14.5" r=".6" fill="currentColor"/>'),
  subway: svg('<rect x="6" y="3" width="12" height="14" rx="4"/><path d="M6 10h12"/><path d="M8.5 20.5L10 17M15.5 20.5L14 17"/><circle cx="9.5" cy="13.5" r=".6" fill="currentColor"/><circle cx="14.5" cy="13.5" r=".6" fill="currentColor"/>'),
  train: svg('<path d="M7 3h10a2 2 0 012 2v9a3 3 0 01-3 3H8a3 3 0 01-3-3V5a2 2 0 012-2z"/><path d="M5 9h14M12 3v6"/><path d="M8 21l2-4M16 21l-2-4"/>'),
  tram: svg('<rect x="6" y="6" width="12" height="11" rx="3"/><path d="M9 3h6M12 3v3M6 11h12M9 20.5l1-3.5M15 20.5l-1-3.5"/>'),
  car: svg('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M4 16h16"/><path d="M5 11h14"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/>'),
  ferry: svg('<path d="M3 15l2 4h14l2-4H3z"/><path d="M6 15V9h12v6"/><path d="M12 4v5"/><path d="M3 21c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/>'),
  flight: svg('<path d="M12 2c.8 0 1.4.8 1.4 2v5.2l7.6 4.4v2l-7.6-2.3v4.4l2.2 1.6V21L12 20l-3.6 1v-1.7l2.2-1.6v-4.4L3 15.6v-2l7.6-4.4V4c0-1.2.6-2 1.4-2z"/>', true),
  wait: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  done: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

export const UI = {
  play: svg('<path d="M8 5.5v13l10-6.5z"/>', true),
  pause: svg('<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>', true),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>'),
  skip: svg('<path d="M5 6l8 6-8 6zM13 6l8 6-8 6z"/>', true),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pin: svg('<path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', true),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
};
