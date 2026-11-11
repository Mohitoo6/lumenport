# Metropolis

A 3D city-builder that runs in the browser, built with TypeScript, Vite and Three.js.

```
npm install
npm run dev        # http://localhost:5173
```

Other commands: `npm test` (simulation tests), `npm run check` (type check),
`npm run shots` (Playwright screenshots into `screenshots/`), `npm run assets` (re-download
CC0 textures and skies).

## Playing

Lay a street, place a power plant and a water tower beside it, then zone land along the
road for homes, shops and industry. Watch the demand bars, keep the budget in the black
(B), and add services and parks to raise happiness. The Views menu (V) shows what is
going on: power, water, traffic, pollution, crime, land value, happiness and coverage.

## Controls

| Action | Input |
|---|---|
| Move | W A S D or arrow keys, Shift + drag, or push the screen edge |
| Rotate / tilt | Q E / R F, or right-drag (Alt + drag on a trackpad) |
| Zoom | Scroll or pinch |
| Use a tool | Left click (drag to zone). Right click or Esc steps back |
| Inspect a building | Click it with no tool selected |
| Bulldoze / curved roads | X / C |
| Speed | Space to pause, 1 2 3 |
| Budget / data views / menu | B / V / M |
| Time of day | Click the clock: Auto, Day, Night |
| Dev overlay | ` (backtick) |

Cities are saved in the browser (Menu, M): three slots plus an autosave every two minutes.

## Project docs

- `PLAN.md`: architecture, data model, phases and acceptance criteria.
- `PROGRESS.md`: what is done, what is next, known issues and decisions.
- `ASSETS.md`: every third-party asset and its licence (all CC0).
