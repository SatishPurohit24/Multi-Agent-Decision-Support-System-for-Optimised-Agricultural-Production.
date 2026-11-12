// Appended to every specialist agent's prompt. Agents keep their original JSON fields and ALSO "bid" a
// numeric score per action per day, which the BioCoord-Clear solver consumes. The LLM never picks the final plan.
export const SCORE_SPEC = `

ADDITIONAL REQUIRED FIELDS (add these to the JSON object above; keep every field above too):
"scores": an array of EXACTLY 3 objects, one per day (day 0 = today, day 1, day 2). Each object has the numeric keys
WAIT, IRRIGATE, SPRAY, SELL, each in [-1, 1]: how good that action would be on that day judged ONLY from your own domain.
+1 = strongly beneficial, 0 = neutral/not your domain, -1 = harmful. Use -1 ONLY for a hard veto (for example spraying
when rain would wash it off). If you have no day-specific information, repeat today's scores for later days multiplied by 0.7.
"spread_hazard": a number 0-1. Pest agent: how likely the infestation is to spread to nearby plants/plots or later days
(0.1 = isolated, 0.5 = spreading, 0.9 = aggressive). All other agents output 0.
Example of the added fields: "scores":[{"WAIT":-0.4,"IRRIGATE":0.8,"SPRAY":0,"SELL":0},{"WAIT":-0.3,"IRRIGATE":0.6,"SPRAY":0,"SELL":0},{"WAIT":-0.3,"IRRIGATE":0.5,"SPRAY":0,"SELL":0}],"spread_hazard":0`;
