# Where do I meet my homies?

Find the fairest place to meet 1–10 friends. Everyone's **isochrone** (how far they can get in N minutes) grows on a 3D map; the first place where all of them overlap is the fair spot. Then watch everyone travel there by walking, bus, subway, train, car, ferry or plane, and see what travelers recommend doing there. Free: no API keys, no server.

Works inside one city (real rail lines from OpenStreetMap), between cities, and across countries (flights between major airports on a 3D globe).

## Fairness modes
| Mode | Picks the place where… |
|---|---|
| ⚖️ Equal | everyone's travel times are as similar as possible (only among places that aren't much worse than the best "longest trip") |
| 🛟 No one suffers | the longest trip is as short as possible |
| ⚡ Efficient | the group's total travel time is lowest |

## Run
```bash
npm install
npm run dev
```
`npm run build` makes a static site in `dist/` that any static host (GitHub Pages, Vercel, Netlify) can serve.

- `npm test` runs the engine tests (Vienna U-Bahn/tram, Seoul subway, East Asia flights, Europe, across the Pacific).
- `npm run data` rebuilds `src/data/` (airports, cities, bundled Vienna and Seoul rail networks); `node scripts/build-data.mjs vienna` rebuilds one city.

## How it works
- **Engine** (`src/engine/`): a web-mercator grid around the friends + rail stops + airports form one graph. Dijkstra from each person gives minutes to every cell. Candidate places (stations in a city, real cities otherwise) are scored in all three modes.
- **Map** (`src/map/`): MapLibre globe with 3D buildings; isochrones are `d3-contour` outlines of each person's time field; the overlap is the contour of the *max* over everyone.
- **What to do there** (`src/data/guide.js`, `src/data/wikivoyage.js`): reads the closest Wikivoyage guide pages (See / Do / Buy / Eat / Drink listings, with Budget / Mid-range / Splurge), adds photos and famous sights from Wikipedia, ranks by fame and distance, and filters by vibe and budget. A simple day plan is built from the top picks.

## Limits
Travel times are model estimates: average speeds for walking, cars, buses and intercity travel, timetable-free rail, and flights assumed between any two large airports. No prices, visas or schedules yet.

Data: © OpenStreetMap contributors (ODbL), Wikivoyage and Wikipedia contributors (CC BY-SA), OpenFreeMap tiles, OurAirports and Natural Earth (public domain).
