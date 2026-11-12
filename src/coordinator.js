import { callClaude } from './llm/claudeClient.js';

const ROLE = `You are the Coordinator Agent in a multi-agent farm decision support system.
You receive the independent, structured outputs of four specialist agents: weather, soil,
pest, and market. Each includes an action, an urgency level, a confidence level, and a
one-sentence reason.

YOUR JOB, IN ORDER:
1. Read all four agents' outputs carefully.
2. Identify any CONFLICT — a case where following one agent's recommendation would waste,
   undo, or contradict another's (for example: pest agent says "spray now" while weather
   agent says heavy rain is coming, which would wash the spray off before it works).
3. Identify COMPOUNDING cases — where two agents reinforce each other (for example: soil
   agent flags low moisture and weather agent flags an incoming dry spell) — these are not
   conflicts, but should still shape the plan.
4. When a genuine conflict exists, resolve it using this priority order, unless the
   specific data clearly argues otherwise:
   (a) preventing irreversible crop loss (pest/disease damage) outranks
   (b) preventing water stress (irrigation) outranks
   (c) economic timing optimization (market) outranks
   (d) minor scheduling convenience (weather-only timing shifts).
   Briefly explain why you prioritized as you did.
5. If any agent reported "confidence":"low", weight its recommendation more cautiously —
   prefer a higher-confidence agent's recommendation when the two conflict, and say so.
6. Never silently drop an agent's recommendation. If you override or deprioritize one,
   name it explicitly.

ACCURACY RULES:
- Your "plan" must be a concrete action the farmer can literally follow today — do not
  just restate all four recommendations back-to-back; actually synthesize them into one
  coherent plan.
- Only report a conflict if one genuinely exists in the data given — do not invent tension
  between agents that actually agree.

OUTPUT FORMAT — respond with ONLY this JSON object. No markdown fences, no preamble,
no text outside the object:
{"plan":"1-2 sentence unified action plan the farmer can follow today","conflict":"name the specific conflict found and how/why you resolved it this way, or NONE if all four agents agreed with no tension","overridden_agent":"the agent whose recommendation was deprioritized, or NONE"}

EXAMPLE
Input: pest agent says spray today (urgency high, confidence high); weather agent says
rain expected in 6 hours (urgency high, confidence high); soil agent says no irrigation
needed (urgency low); market agent says hold stock (urgency low).
Output: {"plan":"Spray the affected leaves within the next 2-3 hours, well before the rain arrives this evening, and skip irrigation since rain will provide it.","conflict":"Pest agent wanted to spray today and weather agent forecast rain in 6 hours which would wash off the spray; resolved by prioritizing the spray action but compressing its timing to happen before the rain window instead of dropping it.","overridden_agent":"NONE"}`;

export async function runCoordinator(agentOutputs) {
  const userMsg = `Here are the four agents' outputs: ${JSON.stringify(agentOutputs)}`;
  const raw = await callClaude(ROLE, userMsg);
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------------------------
// NOVELTY: BioCoord-Clear coordinator. The solver decides; the LLM only explains (cannot change the plan).
import { clear } from './mechanism/biocoord.js';

export async function runMechanismCoordinator(agentOutputs) {
  const by = Object.fromEntries(agentOutputs.map(a => [a.agent, a]));
  const pest = by.pest || {};
  const hazard = Number.isFinite(+pest.spread_hazard) ? +pest.spread_hazard : ({ low: 0.1, medium: 0.4, high: 0.8 }[pest.urgency] ?? 0.1);
  const res = clear({ Z: 1, H: 3, recs: [by], hazard: [hazard] }, { tau: 0.2, water: 1, maxSpray: 2 });
  const today = res.plan[0][0], over = res.overridden_today[0];
  const facts = { today_action: today, three_day_plan: res.plan[0], overridden: over, binding_constraints: res.binding, joint_interactions_avoided: res.independent_joint_events.map(e => e.why),
    landscape_risk: res.landscape_risk, risk_cap: res.tau, risk_without_coordination: res.independent_risk };
  let plan, conflict, explain_error = null;
  try {
    const raw = await callClaude(`You explain a farm plan that an optimizer ALREADY chose. You may NOT change it. Return ONLY JSON: {"plan":"1-2 sentences telling the farmer what to do today and the next two days","conflict":"one or two sentences naming the trade-off the optimizer resolved (use overridden agent, binding constraints, avoided joint interactions), or NONE"}`, JSON.stringify(facts));
    ({ plan, conflict } = JSON.parse(raw));
  } catch (e) { explain_error = e.message; }
  plan ??= `Today: ${today}. Next days: ${res.plan[0].slice(1).join(', ')}.`;
  conflict ??= over ? `${over.agent} preferred ${over.preferred} but the joint plan chose ${today}.` : 'NONE';
  return { plan, conflict, overridden_agent: over ? over.agent : 'NONE', details: { ...res, explain_error } };
}
