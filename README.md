# Multi-Agent Farm Decision Support — Framework

## Structure
```
src/
  dataSources/
    weatherApi.js   -> Open-Meteo (free, no key) — weather + soil moisture
    marketApi.js    -> data.gov.in Agmarknet (free, needs key) — mandi prices
  agents/
    weatherAgent.js -> reasons only about rain/forecast
    soilAgent.js    -> reasons only about soil moisture / irrigation
    pestAgent.js    -> reasons about a real leaf photo (uses Claude vision directly)
    marketAgent.js  -> reasons only about mandi prices
  coordinator.js    -> the novelty: takes all 4 agent outputs, finds conflicts, resolves them
  llm/
    claudeClient.js -> shared function every agent/coordinator calls through
  index.js          -> wires everything together, runs one full end-to-end decision
```

## Setup
1. Install Node.js (v18+, for built-in `fetch`).
2. `npm install`
3. Copy `.env.example` to `.env` and fill in:
   - `GEMINI_API_KEY` — free at aistudio.google.com, no credit card needed
   - `DATAGOVIN_API_KEY` — free signup at data.gov.in, search "Variety wise Daily Market Prices of Commodity", click "API" tab, generate key
4. Put a real crop leaf photo in the project root named `sample-leaf.jpg` (or edit the path in `src/index.js`).
5. Edit `LAT`/`LON`/`COMMODITY`/`STATE` in `src/index.js` to match your test case.
6. `npm start`

## What happens when you run it
1. Fetches **live** weather/soil data (Open-Meteo) and **live** mandi prices (data.gov.in).
2. Runs all 4 agents **independently and in parallel** — each only sees its own slice of data, and each is a separate Claude API call with its own role prompt.
3. Runs the **Coordinator** as a final, separate Claude call — it reads all 4 agents' structured outputs, checks for conflicts (e.g. "spray now" vs "rain incoming"), and produces one unified plan with the conflict explicitly named.
4. Prints each agent's individual reasoning AND the final coordinated decision to the console — so the whole reasoning trace is visible, not hidden.

## Running the dashboard (frontend)
The `server.js` + `public/` files add a browser dashboard on top of the exact same
backend files above — nothing in `src/` was changed for this.

1. Make sure `.env` is filled in (same keys as above) and `sample-leaf.jpg` is in the
   project root.
2. `npm install` (adds Express, one new dependency)
3. `npm run web`
4. Open **http://localhost:3000** in your browser.
5. Pick a location/crop preset (or enter custom values), click **Run live analysis**,
   and watch the agent network, agent cards, and final plan populate in real time from
   the same live API calls `npm start` uses — just streamed to the browser via
   Server-Sent Events instead of printed to the terminal.

Every number on that page is real: rain probability and soil moisture from Open-Meteo,
mandi price record count from data.gov.in, and every agent's action/urgency/confidence
from an actual Claude call. Nothing is mocked or pre-scripted — if the pest agent can't
find `sample-leaf.jpg`, the card will say so honestly instead of faking a result.

## Next steps (after this framework works)
- Swap the console output for a small web UI (can reuse the HTML demo style from earlier).
- Add a feedback loop: let the farmer accept/reject the plan, log it.
- Add RAG: ground the Pest Agent's advice in a real agri-extension knowledge base instead of general Claude knowledge.
- Test across more scenarios (different crops, states, seasons) to see how well the coordinator's conflict resolution generalizes.
