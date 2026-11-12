// Offline benchmark (no LLM, no network). Mock agents bid from a synthetic scenario; a separate "truth" simulator with
// DIFFERENT constants from the solver's footprint model scores each plan. Paired seeds, ablations, sign test.
import { clear } from '../src/mechanism/biocoord.js';
const Z = 2, H = 3, N = Z * H, WATER = 1, SEEDS = +process.argv[2] || 300;
let s = 1; const R = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296, cl = (x, a = -1, b = 1) => Math.min(b, Math.max(a, x));
const scen = () => ({ I: Array.from({ length: Z }, () => (R() < .5 ? .1 + .5 * R() : .03)), m: Array.from({ length: Z }, () => .1 + .25 * R()), rain: Array.from({ length: H }, () => (R() < .3 ? 3 + 15 * R() : 0)), tr: (R() - .5) * .12 });
const recs = c => c.I.map((I, z) => ({ weather: { confidence: 1, scores: c.rain.map(r => ({ IRRIGATE: r >= 5 ? -1 : .2, SPRAY: r >= 2 ? -1 : .2 })) },
  soil: { confidence: 1, scores: c.rain.map(() => ({ IRRIGATE: cl((.3 - c.m[z]) / .15) })) }, pest: { confidence: 1, scores: c.rain.map(() => ({ SPRAY: cl(I * 3 - .2), IRRIGATE: -I * 1.5 })) },
  market: { confidence: 1, scores: c.rain.map(() => ({ SELL: cl(-c.tr * 5), WAIT: cl(c.tr * 5) })) } }));
function truth(c, x) { let I = c.I.slice(), m = c.m.slice(), pf = 0; const sp = Array(Z).fill(0), sold = Array(Z).fill(false);
  for (let d = 0; d < H; d++) { const a = z => x[z * H + d], prevIrr = z => d > 0 && x[z * H + d - 1] === 1, nI = [];
    for (let z = 0; z < Z; z++) { let h = .1 * I[z] * (a(z) === 1 ? 1.6 : 1) * (prevIrr(z) ? 1.3 : 1);
      for (let z2 = 0; z2 < Z; z2++) if (z2 !== z) h += .5 * .35 * I[z2] * (1 + (a(z2) === 1 ? .8 : 0) - (a(z2) === 2 ? .6 : 0));
      let eff = 0; if (a(z) === 2) { eff = .6; if (prevIrr(z)) eff = .3; if (c.rain[d] >= 2) eff = .1; if (sp[z]++ >= 2) eff *= .5; }
      nI.push(Math.min(1, I[z] * .92 * (1 - eff) + h * (1 - I[z])));
      const gain = a(z) === 1 && c.rain[d] < 5 ? Math.max(0, .3 - m[z]) * 1.3 : 0; m[z] = cl(m[z] - .03 + (a(z) === 1 ? .08 : 0) + (c.rain[d] >= 5 ? .06 : 0), 0, 1);
      let sell = 0; if (a(z) === 3 && !sold[z]) { sold[z] = true; sell = cl(-c.tr * 5) * .05; }
      pf += gain - (a(z) === 2 ? .03 : 0) + sell - .6 * nI[z] * .33; }
    I = nI; } return [pf, I.reduce((p, q) => p + q, 0) / Z]; }
const cap = x => { const y = x.slice(), sold = Array(Z).fill(0); for (let d = 0; d < H; d++) { let w = 0; for (let z = 0; z < Z; z++) { const n = z * H + d; if (y[n] === 1 && ++w > WATER) y[n] = 0; if (y[n] === 3 && sold[z]++ >= 1) y[n] = 0; } } return y; };
const IDX = o => o.plan.flat().map(a => ['WAIT', 'IRRIGATE', 'SPRAY', 'SELL'].indexOf(a));
const bio = (r, o) => IDX(clear({ Z, H, recs: r, hazard: r.map(q => q.pest.scores[0].SPRAY > 0 ? Math.min(1, (q.pest.scores[0].SPRAY + .2) / 3) : .03) }, { tau: .12, water: WATER, influence: false, ...o }));
const M = { 'priority-rule': (c, r) => cap(Array.from({ length: N }, (_, n) => { const z = Math.floor(n / H), d = n % H, q = r[z]; return q.pest.scores[d].SPRAY > .3 && q.weather.scores[d].SPRAY > -.9 ? 2 : q.soil.scores[d].IRRIGATE > .3 && q.weather.scores[d].IRRIGATE > -.9 ? 1 : q.market.scores[d].SELL > .3 ? 3 : 0; })),
  'independent-weighted': (c, r) => cap(bio(r, { tau: 9, water: 99, maxSpray: 99, spatial: false, temporal: false, joint: false })),
  'BioCoord-Clear': (c, r) => bio(r, {}), 'ablate: no spatial/temporal coupling': (c, r) => bio(r, { spatial: false, temporal: false }),
  'ablate: no joint-interaction cost': (c, r) => bio(r, { joint: false }), 'ablate: no resistance cap': (c, r) => bio(r, { resist: false }) };
const res = Object.fromEntries(Object.keys(M).map(k => [k, { pf: [], inf: [] }]));
for (let i = 0; i < SEEDS; i++) { const c = scen(), r = recs(c); for (const k in M) { const [p, f] = truth(c, M[k](c, r)); res[k].pf.push(p); res[k].inf.push(f); } }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); }, p90 = a => a.slice().sort((x, y) => x - y)[Math.floor(.9 * a.length)];
console.log(`Seeds: ${SEEDS}, zones: ${Z}, horizon: ${H} days (paired scenarios)`);
console.table(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { profit: `${mean(v.pf).toFixed(3)} ± ${sd(v.pf).toFixed(3)}`, mean_infection: mean(v.inf).toFixed(3), p90_infection: p90(v.inf).toFixed(3) }])));
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
function sign(a, b) { let w = 0, l = 0; a.forEach((x, i) => { if (x > b[i] + 1e-9) w++; else if (x < b[i] - 1e-9) l++; }); const n = w + l, k = Math.max(w, l); let p = 0; for (let j = k; j <= n; j++) p += binom(n, j) / 2 ** n; return { wins: w, losses: l, ties: a.length - n, p: Math.min(1, 2 * p).toExponential(2) }; }
for (const base of ['priority-rule', 'independent-weighted']) { const B = res['BioCoord-Clear'], O = res[base];
  console.log(`\nBioCoord vs ${base}: profit`, sign(B.pf, O.pf), '| lower final infection', sign(O.inf, B.inf)); }
