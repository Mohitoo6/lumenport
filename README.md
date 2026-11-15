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

## AI city council

Problems in the city (rush-hour jams, shortages, pollution, missing services, deficits)
bring the responsible minister to you. Call the council and nine AI ministers debate the
options the game has worked out, in English or Hindi; you approve the result.

To use real AI, copy `.env.example` to `.env`, add one or more OpenAI-compatible providers
(Gemini, Groq, OpenRouter and similar), and restart `npm run dev`. Without keys, or when a
free tier is rate-limited, the meeting runs offline with rule-based ministers at no cost.
Keys stay on your machine and are never sent to the browser.

### How the council works

The council is a multi-agent decision-support pipeline with the game as the source of
truth. The model argues; code decides what is possible, checks what was said, and carries
out what the mayor approves.

```
detect -> triage -> round 1 -> [round 2] -> chair -> guardrails -> mayor -> execute
 code      code      model      model       model      code        human     code
```

| Stage | What happens |
|---|---|
| Detect | Detectors in the simulation raise an issue with a severity and measured facts. |
| Triage | All nine ministries score how urgent it is for them; the lead and top three are seated. |
| Options | The game drafts valid options and runs each on a copy of the city to measure its effect. |
| Debate | Each minister sees only its own department and its slice of each option. Round 2 runs only if they disagree. |
| Chair | The Chief Secretary recommends one option, as schema-checked JSON. |
| Guardrails | Code checks the recommendation: it exists, the game accepts it, the city can pay, the figures quoted were in the facts shown. |
| Mayor | You approve, overrule or defer. |
| Execute | The option runs as one transaction and the city is compared with what the option card promised. |

A meeting is capped at 8 model calls (typically 4 or 5). Press **I** in the chamber, or open
Council > AI inspector, to watch it: the pipeline state, each agent's prompt and JSON,
latency, token counts, schema results and guardrail findings. Past decisions are
remembered per city and shown to the ministers they concern.

`docs/GENAI_GUIDE.md` explains the design, the trade-offs and the numbers in full.
`npm test` covers all of it without calling a model; `REAL_COUNCIL=1 npx vitest run
tests/game/zz-real.test.ts` holds one real meeting and prints its telemetry.

## Project docs

- `PLAN.md`: architecture, data model, phases and acceptance criteria.
- `PROGRESS.md`: what is done, what is next, known issues and decisions.
- `docs/GENAI_GUIDE.md`: the AI council explained end to end, with interview questions.
- `ASSETS.md`: every third-party asset and its licence (all CC0).
