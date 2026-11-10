# Metropolis

A 3D city-builder that runs in the browser, built with TypeScript, Vite and Three.js.

```
npm install
npm run dev        # http://localhost:5173
```

Other commands: `npm test` (simulation tests), `npm run check` (type check),
`npm run shots` (Playwright screenshots into `screenshots/`), `npm run assets` (re-download
CC0 textures and skies).

## Controls

| Action | Input |
|---|---|
| Move | W A S D or arrow keys, Shift + drag, or push the screen edge |
| Rotate / tilt | Q E / R F, or right-drag (Alt + drag on a trackpad) |
| Zoom | Scroll or pinch |
| Speed | Space to pause, 1 2 3 |
| Dev overlay | ` (backtick) |

## Project docs

- `PLAN.md`: architecture, data model, phases and acceptance criteria.
- `PROGRESS.md`: what is done, what is next, known issues and decisions.
- `ASSETS.md`: every third-party asset and its licence (all CC0).
