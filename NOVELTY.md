# Novelty: BioCoord-Clear (spatio-temporally coupled, risk-constrained clearing of agent bids)

## Gap
LLM-agent farm advisors let a coordinator "decide" by prose or a fixed priority order. They have no model of how one action
changes risk elsewhere (the next day, a neighbouring plot), no feasibility check, and no computable account of which agent lost.

## Mechanism
Agents bid scores s_g(n,a) in [-1,1] with confidence c_g for each decision node n = (zone, day) and action a in {WAIT, IRRIGATE, SPRAY, SELL}.
The coordinator (deterministic) solves

    max_x  sum_n sum_g w_g c_g s_g(n,x_n)  -  sum_z sum_d Q(x_zd, x_z,d+1)
    s.t.   Psi(x) = sum_n v_n h_n(x) / sum v <= tau          (landscape risk; h_n has signed cross-node footprints)
           irrigations per day <= W;  sprays per zone <= S_max (resistance cap);  SELL <= 1 per zone;  hard vetoes (score <= -0.9 at conf >= 0.5)

Q is the joint-interaction cost (irrigate then spray, spray then irrigate, back-to-back irrigation). Exact enumeration (4^N, N <= 9 in the demo).
Overridden agent = largest weighted score given up. Influence_g = welfare the other agents lose because g is present (Clarke-style pivot, attribution only; agents are not strategic so no truthfulness claim).

## Tests
`npm run bench` : paired seeds, baselines (priority rule, independent weighted), ablations (no coupling / no joint cost / no resistance cap), exact sign test.
Live: the Mechanism section compares BioCoord-Clear with the original LLM-only coordinator on the same agent outputs.

## Honest limits
Benchmark is synthetic and the mock agents share assumptions with the simulator. Footprint constants are assumptions until calibrated. The live app uses 1 zone (spatial coupling is exercised in the benchmark with 2 zones). Reviewers will ask for: real data calibration, more baselines (greedy MAS, quantity auction, MARL), and a stability study of LLM-produced scores.
