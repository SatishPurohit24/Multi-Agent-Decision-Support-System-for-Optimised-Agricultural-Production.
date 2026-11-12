// BioCoord-Clear: spatio-temporally coupled, risk-constrained clearing of agent bids.
// Decision nodes = zone x day. Each agent bids a score per action per node. The solver picks ONE joint plan maximising
//   sum_n sum_g w_g * conf_g * score_g(n, a_n)  -  JointInteractionCost(x)
// subject to: landscape risk Psi(x) <= tau, daily water budget, resistance cap (max sprays), max one SELL per zone,
// plus hard vetoes. Cross-node hazard footprints are signed: irrigation raises neighbour/next-day hazard, spraying lowers it.
export const ACTS = ['WAIT', 'IRRIGATE', 'SPRAY', 'SELL'];
export const AW = { weather: 1, soil: 1, pest: 1.2, market: 0.8 }; // stated agent weights (vetoes override)
const CONF = { low: 0.3, medium: 0.6, high: 0.9 };
const cl = (x, a = -1, b = 1) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : 0));
const conf = r => (typeof r?.confidence === 'number' ? cl(r.confidence, 0, 1) : CONF[r?.confidence] ?? 0);
const raw = (r, d, a) => { const s = Array.isArray(r?.scores) ? (r.scores[d] ?? r.scores[r.scores.length - 1]) : r?.scores; return cl(s?.[ACTS[a]]); };
const sc = (r, d, a) => raw(r, d, a) * conf(r);

export function clear(inp, o = {}) {
  const { Z = 1, H = 3, recs, hazard, v = Array(Z).fill(1), adj = Array.from({ length: Z }, () => Array(Z).fill(0.5)) } = inp;
  const { tau = 0.2, water = 1, maxSpray = 2, maxSell = 1, spatial = true, temporal = true, joint = true, resist = true, influence = true } = o;
  const N = Z * H, ag = Object.keys(AW), zi = n => Math.floor(n / H), di = n => n % H, id = (z, d) => z * H + d;
  const HZ = Array.from({ length: N }, (_, n) => cl(hazard[zi(n)], 0, 1));
  const W = Array.from({ length: N }, () => Array(N).fill(0));
  for (let z = 0; z < Z; z++) for (let d = 0; d < H; d++) {
    if (spatial) for (let z2 = 0; z2 < Z; z2++) if (z2 !== z) W[id(z, d)][id(z2, d)] = adj[z][z2];
    if (temporal && d + 1 < H) W[id(z, d)][id(z, d + 1)] = 0.6; // carry-over of today's action effect into tomorrow's hazard
  }
  const SV = v.reduce((a, b) => a + b, 0) * H;
  const haz = x => x.map((xq, q) => { let h = 0.2 * HZ[q] * (xq === 2 ? 0.4 : 1) + (xq === 1 ? 0.1 + 0.4 * HZ[q] : 0);
    for (let p = 0; p < N; p++) if (W[p][q]) h += W[p][q] * HZ[p] * 0.3 * (1 + (x[p] === 1 ? 0.8 : 0) - (x[p] === 2 ? 0.6 : 0)); return h; });
  const psi = x => haz(x).reduce((s, h, n) => s + v[zi(n)] * h, 0) / SV;
  const Q = (x, on = joint) => { const ev = []; if (!on) return { cost: 0, ev };
    for (let z = 0; z < Z; z++) for (let d = 0; d + 1 < H; d++) { const a = x[id(z, d)], b = x[id(z, d + 1)];
      if (a === 1 && b === 2) ev.push({ z, d, why: 'irrigate then spray: wet canopy cuts spray effectiveness', c: 0.5 });
      if (a === 2 && b === 1) ev.push({ z, d, why: 'spray then irrigate: irrigation washes off the spray', c: 0.4 });
      if (a === 1 && b === 1) ev.push({ z, d, why: 'back-to-back irrigation: leaching and humidity', c: 0.15 }); }
    return { cost: ev.reduce((s, e) => s + e.c, 0), ev }; };
  const U = (n, a, wt) => ag.reduce((s, g) => s + (wt[g] || 0) * sc(recs[zi(n)][g], di(n), a), 0);
  const allowed = Array.from({ length: N }, (_, n) => { const ok = [0, 1, 2, 3].filter(a => !ag.some(g => conf(recs[zi(n)][g]) >= 0.5 && raw(recs[zi(n)][g], di(n), a) <= -0.9)); return ok.length ? ok : [0, 1, 2, 3]; });
  const wel = (x, wt = AW, j = joint) => x.reduce((s, a, n) => s + U(n, a, wt), 0) - Q(x, j).cost;
  const use = x => ({ water: Math.max(0, ...Array.from({ length: H }, (_, d) => Array.from({ length: Z }, (_, z) => x[id(z, d)] === 1).filter(Boolean).length)),
    spray: Math.max(0, ...Array.from({ length: Z }, (_, z) => Array.from({ length: H }, (_, d) => x[id(z, d)] === 2).filter(Boolean).length)),
    sell: Math.max(0, ...Array.from({ length: Z }, (_, z) => Array.from({ length: H }, (_, d) => x[id(z, d)] === 3).filter(Boolean).length)) });
  const viol = (x, T, Wc, Sc) => { const u = use(x); return Math.max(0, psi(x) - T) + Math.max(0, u.water - Wc) + (resist ? Math.max(0, u.spray - Sc) : 0) + Math.max(0, u.sell - maxSell); };
  function solve(wt = AW, T = tau, Wc = water, Sc = maxSpray, j = joint) { let best = null, bv = -1e9, bf = null, bfv = 1e9; const x = [];
    (function go(n) { if (n === N) { const vi = viol(x, T, Wc, Sc); if (!vi) { const w = wel(x, wt, j); if (w > bv) { bv = w; best = x.slice(); } } else if (vi < bfv) { bfv = vi; bf = x.slice(); } return; }
      for (const a of allowed[n]) { x[n] = a; go(n + 1); } })(0); return best || bf; }
  const x = solve(), free = solve(AW, 9, 99, 99), indep = (() => { // independent per-node optimum, no coupling, no constraints
    return Array.from({ length: N }, (_, n) => allowed[n].reduce((b, a) => (U(n, a, AW) > U(n, b, AW) ? a : b))); })();
  const u = use(x), uf = use(free), binding = [];
  if (psi(free) > tau && psi(x) <= tau + 1e-9) binding.push('landscape_risk'); if (uf.water > water) binding.push('water');
  if (resist && uf.spray > maxSpray) binding.push('resistance_cap');
  const inf = {}; if (influence) for (const g of ag) { const wt = { ...AW, [g]: 0 }; inf[g] = +(wel(solve(wt), wt) - wel(x, wt)).toFixed(3); } // Clarke-style influence
  const over = Array.from({ length: Z }, (_, z) => { const n = id(z, 0), a = x[n]; let b = null, m = 0.3;
    for (const g of ag) { const s = [0, 1, 2, 3].map(k => sc(recs[z][g], 0, k)), top = s.indexOf(Math.max(...s)), lost = (s[top] - s[a]) * AW[g]; if (lost > m) { m = lost; b = { agent: g, preferred: ACTS[top], lost: +lost.toFixed(2) }; } } return b; });
  const grid = p => Array.from({ length: Z }, (_, z) => Array.from({ length: H }, (_, d) => ACTS[p[id(z, d)]]));
  return { plan: grid(x), feasible: viol(x, tau, water, maxSpray) < 1e-9, welfare: +wel(x).toFixed(3), landscape_risk: +psi(x).toFixed(3), tau, usage: u,
    independent_plan: grid(indep), independent_risk: +psi(indep).toFixed(3), independent_joint_events: Q(indep, true).ev, joint_events: Q(x, true).ev,
    binding, influence: inf, overridden_today: over, vetoed: allowed.map((o2, n) => [0, 1, 2, 3].filter(a => !o2.includes(a)).map(a => ACTS[a])), raw: x };
}
