# BioCoord-Clear: How the Model Works (Reviewer Explanation)

Put this file in the project root or in a `docs/` folder. It explains the system, the algorithm, every number in it, the benchmark, and the limits. Where a value is an assumption, it says so.

---

## 1. One-paragraph summary

Four LLM specialist agents (Weather, Soil, Pest, Market) each read only their own data. Each returns its usual recommendation **and** a score sheet: how good each action (WAIT, IRRIGATE, SPRAY, SELL) would be on each of the next 3 days, judged from its own domain. A deterministic solver (`src/mechanism/biocoord.js`) then tries every possible 3-day schedule, adds up the confidence-weighted scores, subtracts penalties for harmful combinations, discards schedules that break risk, water or resistance limits, and returns the best legal one. The LLM does not choose the plan. It only writes the farmer-facing explanation.

## 2. System flow

```
Open-Meteo, data.gov.in, leaf photo
        |
  +-----+------+------+------+
  Weather  Soil  Pest  Market      <- 4 LLM agents, each sees only its own data
  agent    agent agent agent
  +-----+------+------+------+
        |   each returns: action, urgency, confidence, reason
        |                 + scores[3 days x 4 actions] + spread_hazard (pest)
        v
  BioCoord-Clear solver (plain code, no LLM)
        |   vetoes -> enumerate schedules -> score -> check limits -> pick best
        v
  plan + overridden agent + binding constraints + influence
        |
        v
  LLM writes the sentences only (cannot change the plan)  --> dashboard
```

The original LLM-only coordinator also runs on the same agent outputs as a live comparison baseline.

## 3. What is computed by the LLM and what by code

| Quantity | Produced by | Notes |
|---|---|---|
| `action`, `urgency`, `confidence`, `reason` | LLM, following each agent's prompt rules | Not used by the solver, except urgency as a fallback for spread hazard |
| `scores` (3 days x 4 actions) | LLM, following the score rubric | The solver's main input |
| `spread_hazard` (Pest only) | LLM | Fallback if missing: urgency low/medium/high -> 0.1/0.4/0.8 |
| Confidence as a number (0.3 / 0.6 / 0.9) | Code | Maps the LLM's low/medium/high |
| Agent weights (1.0 / 1.0 / 1.2 / 0.8) | Code constants | Hand-chosen |
| Vetoes, penalties, risk, limits | Code | Fixed numbers in `biocoord.js` |
| The final plan | Code (exact search) | Deterministic given the bids |
| Overridden agent, binding constraints, influence | Code | Computed from the solution |
| Farmer-facing sentences | LLM, from the solver's facts | Cannot change the plan |

## 4. The agents

An agent here is one LLM call with a fixed role prompt, a private data slice, a required JSON output, and no access to the other agents. It perceives live data, applies domain rules, and reports a typed message. It has no memory or planning loop. The contribution is the coordination mechanism, not agent autonomy.

| Agent | Sees | Key rules in its prompt |
|---|---|---|
| Weather | Max rain probability next 12 h, 3-day daily rain (mm) | >= 60% rain probability: advise against spraying; < 20% with dry forecast: dry-spell risk |
| Soil | Soil moisture (m3/m3, Open-Meteo top 1 cm) | < 0.15 severe deficit; 0.15-0.20 mild; 0.20-0.35 optimal; > 0.35 waterlogging risk |
| Pest | One leaf photo | Affected leaf area: < 10% low, 10-30% medium, > 30% high |
| Market | Up to 5 mandi price records | Fall of more than 10% across records: high urgency to sell; rising: hold |

**How `action`, `urgency` and `confidence` are decided.** Not by code. The LLM applies the numeric rules above to its input and fills the JSON. `urgency` follows a scale defined in each prompt (for example for soil: high = crop stress risk within 24 h, medium = act within 1-3 days, low = nothing needed). `confidence` is the LLM's own low/medium/high report; each prompt forces "low" when data is missing or unclear. It is a reliability signal, not a statistical probability, and it is not calibrated yet.

## 5. The bid (score sheet)

Each agent returns `scores`: 3 objects (day 0, day 1, day 2), each with numbers in [-1, 1] for WAIT, IRRIGATE, SPRAY, SELL.

- **What a score means:** how good that action would be on that day, judged only from the agent's own domain. +1 strongly beneficial, 0 neutral or outside its domain, -1 harmful.
- **-1 is reserved for a hard veto**, for example spraying when rain would wash it off.
- **How the number is decided:** the LLM judges it from the same domain rules and thresholds it uses for its recommendation, guided by the scale above. It is a rule-guided judgment, not a computed function. This is the weakest link (see section 12).
- **Days 2 and 3:** only the Weather agent has real per-day data (3-day rain forecast). The other agents have only today's reading, so the prompt tells them to repeat today's scores multiplied by 0.7. See section 8.

Turning a bid into points: `points = agent_weight x confidence_number x score`.

## 6. Confidence and weights

**Confidence number.** low = 0.3, medium = 0.6, high = 0.9. This is a design choice. It makes a low-confidence agent count one third as much as a high-confidence one and keeps it from vetoing.

**Agent weights.** Weather 1.0, Soil 1.0, Pest 1.2, Market 0.8. These are **not calculated**; they are hand-set from a stated priority: the harder an error is to undo, the higher the weight. Crop disease damage is hardest to undo (Pest highest). Water stress and weather timing are neutral (1.0). Price timing is the most recoverable (Market lowest). Weather's real authority comes from vetoes, not its weight.

**How they could be calculated (and how to defend them):**
1. Sensitivity sweep: vary weights randomly (for example from a Dirichlet distribution) and report how often the day-0 action changes.
2. A structured method such as pairwise comparison (AHP) with an agronomist to derive the weights.
3. Learn them from sparse farm outcomes (planned, not implemented).

Until one of these is done, call them stated priorities, not optimal values.

## 7. Vetoes

A veto is a hard rule that removes an action for a day. It applies when an agent with confidence >= 0.5 (medium or high) scores that action <= -0.9. Reason: some actions are physically pointless or harmful (spraying before heavy rain), and no amount of positive points from other agents should be able to buy them back. A low-confidence agent cannot veto, so one unsure reading cannot delete options. If every action for a day is vetoed, the vetoes are ignored for that day so the solver always has options. The thresholds -0.9 and 0.5 are design choices and are covered by sensitivity analysis.

## 8. Why 0.7 for days 2 and 3

Soil moisture is today's reading, the leaf photo is today's photo, and prices are today's records. They say little about what will be true on day 2 or 3, so those agents' later bids are extrapolations. Multiplying by 0.7 shrinks their influence for later days, a simple uncertainty discount, while the Weather agent keeps its real per-day signal. The value 0.7 is a design choice, applied once (not compounded) to both later days, and it is an instruction inside the prompt, so the LLM may not follow it exactly. Better: apply the discount in code. Test 0.5, 0.7, 0.9 and 1.0 and report how often the plan changes.

## 9. The solver, step by step

1. Collect bids; convert confidence to numbers; clamp scores to [-1, 1]; treat a failed agent as zero confidence.
2. Apply vetoes per day.
3. Enumerate every combination of allowed actions: 4^3 = 64 schedules in the live app (one zone, three days).
4. Score each schedule: sum of points over days and agents, minus penalties.
5. Compute landscape risk for each schedule (section 11).
6. Keep schedules that satisfy: risk <= tau (0.2 live), at most 1 irrigation per day, at most 2 sprays (resistance cap), at most 1 sale.
7. Return the legal schedule with the highest score. If none is legal, return the least-violating one and mark `feasible: false`.
8. Compute explanations: overridden agent, binding constraints, independent plan, influence.

**Formula.** Maximise, over schedules x:

`sum over days and agents of [ w_g * c_g * s_g(day, x_day) ]  -  sum over consecutive days of Q(x_day, x_next_day)`

subject to risk(x) <= tau, irrigations per day <= 1, sprays <= 2, sales <= 1, vetoed actions excluded. Here w_g is the agent weight, c_g the confidence number, s_g the score.

## 10. Penalties (joint-interaction cost) Q

| Consecutive days | Penalty | Reason |
|---|---|---|
| Irrigate, then spray | 0.5 | Wet canopy weakens a foliar spray |
| Spray, then irrigate | 0.4 | Irrigation can wash the spray off |
| Irrigate, then irrigate | 0.15 | Leaching and extra humidity |

**Basis.** The three pairs encode plausible agronomic interactions between actions. The key idea is that the value of two actions together is not the sum of their separate values. The magnitudes are assumptions chosen relative to the bid scale (a single confident agent contributes roughly 0.5 to 1.1 points per day), so a penalty of 0.5 can flip a plan when preferences are moderate but cannot override a strong need. They are not calibrated on data. Only consecutive days are penalised because the model assumes the interaction fades within about a day.

## 11. Risk model

Hazard at a day-node q depends on the Pest agent's spread hazard H and on what is done:

`h_q = 0.2*H*(0.4 if SPRAY else 1) + (0.1 + 0.4*H if IRRIGATE else 0) + sum over earlier nodes p of W_pq * H * 0.3 * (1 + 0.8*[p irrigates] - 0.6*[p sprays])`

W_pq = 0.6 from a day to the next day of the same zone (carry-over), and an adjacency weight (default 0.5) between neighbouring zones on the same day when several zones are used. Landscape risk is the average of h over nodes. Signs: irrigation raises hazard, spraying lowers it. The coefficients are assumptions chosen for correct direction and plausible relative size; they are not fitted to data. The model is a one-step footprint and does not track infection over time.

## 12. Output explanations

- **Overridden agent.** For today's chosen action, each agent's loss = its weight x (confidence x its best score - confidence x its score for the chosen action). The largest loss above 0.3 is reported.
- **Binding constraints.** The solver also solves with no limits. A limit that changes the answer is reported (`landscape_risk`, `water`, `resistance_cap`).
- **Independent plan.** What each day would pick alone, ignoring limits and penalties; the dashboard shows its risk and the harmful combinations it would create.
- **Influence.** Re-solve with one agent's weight set to 0; influence = welfare the other agents lose because that agent is present (Clarke pivot style). Attribution only; agents are not strategic, so no incentive-compatibility claim.

## 13. Worked example (real solver output)

Situation: Weather high confidence, rain today (IRRIGATE and SPRAY scored -1 today), dry after; Soil high confidence, dry soil, IRRIGATE +0.8; Pest medium confidence, spread hazard 0.5, SPRAY +0.7, IRRIGATE -0.5; Market low confidence, almost neutral.

- Today: weather vetoes IRRIGATE and SPRAY, so only WAIT or SELL remain. WAIT = 1.0 x 0.9 x 0.3 (weather) + 0.8 x 0.3 x 0.2 (market) = 0.32.
- Day 2, SPRAY: weather 0.27 + pest 1.2 x 0.6 x 0.49 = 0.35, total 0.62. IRRIGATE: weather 0.18 + soil 0.50 - pest 0.25 = 0.43.

| Schedule | Points | Penalty | Final |
|---|---|---|---|
| WAIT, SPRAY, SPRAY | 1.564 | 0 | **1.564** |
| WAIT, IRRIGATE, IRRIGATE | 1.182 | 0.15 | 1.032 |
| WAIT, SPRAY, IRRIGATE | 1.373 | 0.4 | 0.973 |
| WAIT, IRRIGATE, SPRAY | 1.373 | 0.5 | 0.873 |

Chosen: WAIT, SPRAY, SPRAY with risk 0.102 (cap 0.2). Overridden agent: soil (wanted IRRIGATE, gave up 0.72). In this example no limit bound and the independent plan is the same, so the benefit of the method appears only when penalties or limits bite.

## 14. Benchmark (`npm run bench`)

No LLM and no internet. It creates 300 random 2-zone, 3-day scenarios (infection, soil moisture, rain, price trend). Mock agents (rule functions) bid. Each method picks a schedule from the same bids. A separate "truth" simulator, with different constants from the solver, scores each schedule. Methods: priority-rule, independent weighted optimisation, BioCoord-Clear, and three ablations. An exact sign test compares methods on the same scenarios (paired).

| Method | Profit | Mean infection | P90 infection |
|---|---|---|---|
| Priority rule | -0.040 | 0.116 | 0.211 |
| Independent weighted | -0.039 | 0.112 | 0.204 |
| BioCoord-Clear | -0.032 | 0.108 | 0.171 |

- BioCoord vs priority rule: profit wins 138, losses 95, ties 67 (p ~ 0.006); lower final infection 113 vs 78 (p ~ 0.014).
- BioCoord vs independent weighted: not significant (profit p ~ 0.21, infection p ~ 0.20); the lower 90th-percentile infection is promising but untested.
- Ablations: removing coupling raises tail infection slightly; removing joint penalties changes almost nothing (their value is not shown here); removing the resistance cap lowers infection but also profit (a trade-off).
- Effects are small (profit gap ~ 0.007 vs spread ~ 0.25) and the benchmark is synthetic and partly circular.

## 15. What is new, what is not

**Claim.** A coordination formulation where LLM agents submit typed per-action, per-day bids and a deterministic solver clears them under cross-day risk footprints, joint-interaction costs, and water and resistance limits, with the overridden agent and binding constraints computed. The LLM only explains.

**Do not claim.** First multi-agent farm system; use of LLMs or agents; use of optimisation; incentive compatibility; calibrated coefficients.

## 16. Limitations (state these before the reviewer does)

1. Scores come from LLM judgment; run-to-run stability untested; temperature not set to 0.
2. Weights, confidence mapping, veto thresholds, penalties and hazard coefficients are assumptions.
3. Day-2 and day-3 bids for Soil, Pest, Market are extrapolations.
4. Live app uses one zone; spatial coupling is shown only in the benchmark.
5. Soil moisture is a model estimate of the top 1 cm; market trend uses at most 5 records; Pest agent is an uncalibrated vision judgment.
6. No uncertainty model (CVaR/scenarios), no farmer-compliance model, no learning from outcomes.
7. Missing baselines: greedy multi-agent, quantity auction, MARL, statistically measured LLM-only coordinator, oracle.

## 17. Planned improvements (in priority order)

1. Score-stability study with the real LLM (20 repeats per scenario).
2. Compute Weather, Soil and Market scores in code from the same thresholds (leave only the Pest agent to the LLM), and apply the 0.7 discount in code.
3. Sensitivity analysis on weights, confidence mapping, 0.7, tau, penalties and hazard coefficients.
4. Multi-zone live mode.
5. More baselines and stronger statistics (Wilcoxon with Holm correction, effect sizes, bootstrap CIs, tail-risk test).
6. Calibrate hazard and penalty coefficients on a calibrated simulator or real scouting data.

## 18. Speaking script

**30 seconds.** "We keep four LLM specialist agents but replace the LLM coordinator with a constrained solver. Each agent bids a score for every action on each of the next three days. The solver tries every schedule, adds up confidence-weighted bids, subtracts penalties for harmful combinations, and rejects schedules that break risk, water or resistance limits. The overridden agent and binding constraints are computed, and the LLM only explains."

**2 minutes.** Add: what each agent sees; what a bid is; why vetoes exist; the worked example in section 13; the benchmark result with its honest limits; then the limitations list.

## 19. Glossary

- **Bid:** an agent's score sheet (3 days x 4 actions).
- **Veto:** a hard removal of an action by a confident agent.
- **Joint-interaction cost:** penalty when two actions together are worse than the sum of their parts.
- **Landscape risk:** average disease hazard across the plan's day-nodes.
- **Binding constraint:** a limit that changed the answer.
- **Influence:** welfare others lose because an agent is present.
- **Ablation:** removing one component to test its value.
- **Paired test:** comparing methods on the same scenarios.
