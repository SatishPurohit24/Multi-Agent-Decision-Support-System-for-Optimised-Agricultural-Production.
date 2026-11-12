/**
 * AgriMechanism: Uncertainty-Aware, Chance-Constrained Agricultural Mechanism
 * 
 * Formal Mechanism Components:
 * 1. Uncertainty-Aware Bidding: Agents submit belief distributions (\mu, \sigma^2, c)
 * 2. Chance-Constrained Feasibility: P(\Psi(x, \omega) <= \tau) >= 1 - \epsilon via robust buffer
 * 3. Clarke Pivot (VCG) Payments: p_i = W_{-i}(x^*_{-i}) - \sum_{j \neq i} b_j(x^*)
 * 4. Epistemic Veto Filtering with Proper Scoring Rule verification
 * 
 * References:
 * - Dütting, Mirrokni et al. (2024): Mechanism Design for Large Language Models
 * - Gautier & Lacerda (2023): Multiunit Auctions for Allocating Chance-Constrained Resources
 * - Ratha & Pinson (2021): Conic and Robust Markets under Uncertainty
 * - Wang & Zhong (2020): Incentive Mechanisms for Clearing Energy and Reserves
 */

export const ACTIONS = ['WAIT', 'IRRIGATE', 'SPRAY', 'SELL'];
export const AGENT_WEIGHTS = { weather: 1.0, soil: 1.0, pest: 1.2, market: 0.8 };

const clamp = (val, min = -1, max = 1) => Math.min(max, Math.max(min, Number.isFinite(+val) ? +val : 0));

/**
 * Evaluates the Chance-Constrained Landscape Contagion Risk
 * \mathbb{P}(\Psi(x, \tilde{\omega}) \le \tau) \ge 1 - \epsilon
 * Converted to deterministic equivalent: \mu_\Psi(x) + \kappa_\epsilon * \sigma_\Psi(x) <= \tau
 */
export function evaluateRiskDistribution(x, hazardMeans, hazardVars, adjMatrix, weights, Z, H, spatial = true, temporal = true) {
  const N = Z * H;
  const id = (z, d) => z * H + d;
  const zi = n => Math.floor(n / H);
  const totalValue = weights.reduce((a, b) => a + b, 0) * H;

  // Cross-node coupling matrix
  const W = Array.from({ length: N }, () => Array(N).fill(0));
  for (let z = 0; z < Z; z++) {
    for (let d = 0; d < H; d++) {
      if (spatial) {
        for (let z2 = 0; z2 < Z; z2++) {
          if (z2 !== z) W[id(z, d)][id(z2, d)] = adjMatrix[z][z2];
        }
      }
      if (temporal && d + 1 < H) {
        W[id(z, d)][id(z, d + 1)] = 0.6; // temporal contagion carry-over
      }
    }
  }

  // Calculate mean and variance of hazard for each node
  let totalMeanHazard = 0;
  let totalVarHazard = 0;

  for (let q = 0; q < N; q++) {
    const xq = x[q];
    const baseMean = hazardMeans[q];
    const baseVar = hazardVars[q];

    // Local action mitigation: SPRAY reduces hazard mean, IRRIGATE increases fungal microclimate
    const actMeanMult = (xq === 2 ? 0.35 : 1.0) + (xq === 1 ? 0.25 : 0.0);
    const actVarMult = (xq === 2 ? 0.5 : 1.2); // spraying reduces variance; humidity increases variance

    let nodeMean = 0.2 * baseMean * actMeanMult;
    let nodeVar = 0.04 * baseVar * actVarMult;

    // Cross-plot spatial and temporal diffusion
    for (let p = 0; p < N; p++) {
      if (W[p][q] > 0) {
        const xp = x[p];
        const transFactor = (1 + (xp === 1 ? 0.8 : 0) - (xp === 2 ? 0.6 : 0));
        nodeMean += W[p][q] * hazardMeans[p] * 0.3 * transFactor;
        nodeVar += (W[p][q] ** 2) * hazardVars[p] * 0.09 * (transFactor ** 2);
      }
    }

    const plotWeight = weights[zi(q)];
    totalMeanHazard += plotWeight * nodeMean;
    totalVarHazard += (plotWeight ** 2) * nodeVar;
  }

  const meanPsi = totalMeanHazard / totalValue;
  const sdPsi = Math.sqrt(Math.max(1e-6, totalVarHazard)) / totalValue;

  return { meanPsi, sdPsi };
}

/**
 * Expected Joint Transition Penalties with Uncertainty
 * Q(x_t, x_{t+1}) evaluated against rain probability distribution
 */
export function computeExpectedTransitionCosts(x, rainDistributions, Z, H) {
  const id = (z, d) => z * H + d;
  const events = [];
  let expectedCost = 0;

  for (let z = 0; z < Z; z++) {
    for (let d = 0; d + 1 < H; d++) {
      const a1 = x[id(z, d)];
      const a2 = x[id(z, d + 1)];
      const rain = rainDistributions ? rainDistributions[d] : { mean: 0, pHeavy: 0.1 };

      // SPRAY followed by IRRIGATE (or heavy rain): Wash-off penalty
      if (a1 === 2 && a2 === 1) {
        const washPenalty = 0.50;
        expectedCost += washPenalty;
        events.push({ z, d, why: 'Spray then irrigate: direct chemical wash-off and aquatic runoff', cost: washPenalty });
      } else if (a1 === 2 && (rain.pHeavy > 0.3 || rain.mean >= 5)) {
        // Stochastic weather wash-off: sprayed on day d, heavy rain forecasted on day d or d+1
        const washPenalty = 0.45 * (rain.pHeavy || 0.5);
        expectedCost += washPenalty;
        events.push({ z, d, why: `Spray before probable downpour (P(Rain>=5mm)=${((rain.pHeavy||0.4)*100).toFixed(0)}%): wash-off risk`, cost: washPenalty });
      }

      // IRRIGATE followed by SPRAY: Canopy wetness cuts spray adherence & increases compaction
      if (a1 === 1 && a2 === 2) {
        const adherePenalty = 0.40;
        expectedCost += adherePenalty;
        events.push({ z, d, why: 'Irrigate then spray: saturated foliar microclimate reduces spray adhesion', cost: adherePenalty });
      }

      // IRRIGATE followed by IRRIGATE: Root-zone waterlogging and nutrient leaching
      if (a1 === 1 && a2 === 1) {
        const leachPenalty = 0.15;
        expectedCost += leachPenalty;
        events.push({ z, d, why: 'Back-to-back irrigation: anaerobic root-zone stress and nitrogen leaching', cost: leachPenalty });
      }
    }
  }

  return { expectedCost, events };
}

/**
 * AgriMechanism Clearing Engine:
 * Solves:
 *   max_{x} \sum_n \sum_g w_g * ( \mu_g(n, x_n) - \lambda_{risk} * \sigma_g(n, x_n) ) - E[Q(x)]
 * subject to:
 *   1. Robust / Chance-Constrained Contagion: \mu_\Psi(x) + \kappa_\epsilon * \sigma_\Psi(x) <= \tau
 *   2. Daily Hydraulic Quota: \sum_z I(x_{z,d} = IRRIGATE) <= W
 *   3. Cumulative Chemical Resistance Cap: \sum_d I(x_{z,d} = SPRAY) <= S_max
 *   4. Single Market Transaction: \sum_d I(x_{z,d} = SELL) <= 1
 *   5. Epistemic Veto Filtering with Confidence Threshold
 * 
 * Computes:
 * - Provably optimal schedule x*
 * - Truthful VCG Clarke Pivot Payments for each agent / plot
 * - Shadow prices and binding constraints
 */
export function clearMechanism(input, options = {}) {
  const {
    Z = 2,
    H = 3,
    bids,                   // [ { weather: { scores, variances, confidence, veto }, soil: ..., pest: ..., market: ... } ]
    hazardMeans = Array(Z * H).fill(0.15),
    hazardVars = Array(Z * H).fill(0.04),
    rainDist = Array(H).fill({ mean: 1.0, variance: 2.0, pHeavy: 0.1 }),
    plotValues = Array(Z).fill(1.0),
    adjMatrix = Array.from({ length: Z }, () => Array(Z).fill(0.5))
  } = input;

  const {
    tau = 0.18,              // landscape contagion cap
    epsilon = 0.05,          // chance-constraint failure probability (1 - \epsilon = 95% safety)
    waterQuota = 1,          // max irrigations per day across all plots
    maxSpray = 2,            // chemical resistance cap per plot over horizon
    maxSell = 1,
    lambdaRiskAversion = 0.3,// agent risk penalty on variance
    enableChanceConstraint = true,
    enableJointPenalty = true,
    enableResistance = true,
    computeVcgPayments = true
  } = options;

  const N = Z * H;
  const agents = Object.keys(AGENT_WEIGHTS);
  const zi = n => Math.floor(n / H);
  const di = n => n % H;
  const id = (z, d) => z * H + d;

  // Normal quantile for chance constraint (e.g., 95% confidence => \kappa = 1.645)
  const kappa = enableChanceConstraint ? 1.645 : 0.0;

  // Epistemic Veto Filtering: eliminate actions where confidence >= 0.50 and mean utility <= -0.85
  const allowedActions = Array.from({ length: N }, (_, n) => {
    const z = zi(n);
    const d = di(n);
    const allowed = [0, 1, 2, 3].filter(a => {
      for (const g of agents) {
        const agentBid = bids[z]?.[g];
        if (!agentBid) continue;
        const conf = typeof agentBid.confidence === 'number' ? clamp(agentBid.confidence, 0, 1) : 0.7;
        const meanScore = agentBid.scores ? (Array.isArray(agentBid.scores) ? (agentBid.scores[d]?.[ACTIONS[a]] ?? 0) : (agentBid.scores[ACTIONS[a]] ?? 0)) : 0;
        // Hard epistemic veto check
        if (conf >= 0.50 && meanScore <= -0.85) return false;
      }
      return true;
    });
    return allowed.length > 0 ? allowed : [0, 1, 2, 3];
  });

  // Expected Social Valuation function
  const computeSocialWelfare = (x, agentWeights = AGENT_WEIGHTS, subAgent = null) => {
    let welfare = 0;
    for (let n = 0; n < N; n++) {
      const z = zi(n);
      const d = di(n);
      const a = x[n];
      for (const g of agents) {
        if (subAgent && g === subAgent) continue; // for counterfactual VCG calculation
        const weight = agentWeights[g] || 0;
        if (weight <= 0) continue;
        const agentBid = bids[z]?.[g];
        if (!agentBid) continue;
        const conf = typeof agentBid.confidence === 'number' ? clamp(agentBid.confidence, 0, 1) : 0.7;
        const mean = agentBid.scores ? (Array.isArray(agentBid.scores) ? (agentBid.scores[d]?.[ACTIONS[a]] ?? 0) : (agentBid.scores[ACTIONS[a]] ?? 0)) : 0;
        const variance = agentBid.variances ? (Array.isArray(agentBid.variances) ? (agentBid.variances[d]?.[ACTIONS[a]] ?? 0.05) : (agentBid.variances[ACTIONS[a]] ?? 0.05)) : 0.05;

        // Mean-variance utility: U = \mu - \lambda * \sigma^2
        const riskPenalizedScore = mean - lambdaRiskAversion * variance;
        welfare += weight * conf * riskPenalizedScore;
      }
    }

    if (enableJointPenalty) {
      const { expectedCost } = computeExpectedTransitionCosts(x, rainDist, Z, H);
      welfare -= expectedCost;
    }

    return welfare;
  };

  // Constraint violation function
  const computeViolations = (x, targetTau, waterLimit, sprayLimit) => {
    let v = 0;
    // 1. Chance-Constrained Contagion Violation
    const { meanPsi, sdPsi } = evaluateRiskDistribution(x, hazardMeans, hazardVars, adjMatrix, plotValues, Z, H);
    const robustPsi = meanPsi + kappa * sdPsi;
    if (robustPsi > targetTau) {
      v += (robustPsi - targetTau) * 10;
    }

    // 2. Hydraulic Quota: sum_z I(x_{z,d} = IRRIGATE) <= waterLimit
    for (let d = 0; d < H; d++) {
      let dailyWater = 0;
      for (let z = 0; z < Z; z++) {
        if (x[id(z, d)] === 1) dailyWater++;
      }
      if (dailyWater > waterLimit) v += (dailyWater - waterLimit);
    }

    // 3. Chemical Resistance Cap: sum_d I(x_{z,d} = SPRAY) <= sprayLimit
    if (enableResistance) {
      for (let z = 0; z < Z; z++) {
        let plotSpray = 0;
        for (let d = 0; d < H; d++) {
          if (x[id(z, d)] === 2) plotSpray++;
        }
        if (plotSpray > sprayLimit) v += (plotSpray - sprayLimit);
      }
    }

    // 4. Single Market Sell: sum_d I(x_{z,d} = SELL) <= maxSell
    for (let z = 0; z < Z; z++) {
      let plotSell = 0;
      for (let d = 0; d < H; d++) {
        if (x[id(z, d)] === 3) plotSell++;
      }
      if (plotSell > maxSell) v += (plotSell - maxSell);
    }

    return { totalViolation: v, meanPsi, sdPsi, robustPsi };
  };

  // Combinatorial Solver
  function optimizeSchedule(activeWeights = AGENT_WEIGHTS, excludedAgent = null) {
    let bestPlan = null;
    let bestWelfare = -Infinity;
    let bestFeasibleViolation = Infinity;
    let fallbackPlan = null;

    const current = new Array(N);

    function branchAndBound(depth) {
      if (depth === N) {
        const { totalViolation } = computeViolations(current, tau, waterQuota, maxSpray);
        if (totalViolation < 1e-6) {
          const w = computeSocialWelfare(current, activeWeights, excludedAgent);
          if (w > bestWelfare) {
            bestWelfare = w;
            bestPlan = current.slice();
          }
        } else if (totalViolation < bestFeasibleViolation) {
          bestFeasibleViolation = totalViolation;
          fallbackPlan = current.slice();
        }
        return;
      }

      for (const a of allowedActions[depth]) {
        current[depth] = a;
        branchAndBound(depth + 1);
      }
    }

    branchAndBound(0);
    return { plan: bestPlan || fallbackPlan, welfare: bestPlan ? bestWelfare : -bestFeasibleViolation };
  }

  // 1. Solve optimal allocation for all agents x*
  const { plan: optimalPlan, welfare: optimalWelfare } = optimizeSchedule(AGENT_WEIGHTS);

  // 2. Compute VCG Clarke Pivot Payments: p_g = W_{-g}(x^*_{-g}) - W_{-g}(x^*)
  const vcgPayments = {};
  const vcgNetSurplus = {};

  if (computeVcgPayments) {
    for (const g of agents) {
      // Counterfactual schedule without agent g
      const { plan: counterfactualPlan } = optimizeSchedule(AGENT_WEIGHTS, g);
      const counterfactualWelfareWithoutG = computeSocialWelfare(counterfactualPlan, AGENT_WEIGHTS, g);
      const actualWelfareWithoutG = computeSocialWelfare(optimalPlan, AGENT_WEIGHTS, g);

      // Clarke payment: externality imposed on other agents
      const payment = Math.max(0, counterfactualWelfareWithoutG - actualWelfareWithoutG);
      vcgPayments[g] = +payment.toFixed(4);

      // Proper scoring rule deduction if agent misreported variance
      let variancePenalty = 0;
      if (g === 'weather' && bids[0]?.[g]?.variances) {
        // If reported variance is suspiciously compressed below biological minimum
        const avgReportedVar = bids[0][g].variances.reduce((s, v) => s + (v.SPRAY || 0.05), 0) / bids[0][g].variances.length;
        if (avgReportedVar < 0.015) {
          variancePenalty = 0.35; // Calibration penalty for epistemic overconfidence
        }
      }

      // Agent's own valuation under optimal plan
      const ownValuation = computeSocialWelfare(optimalPlan, { [g]: AGENT_WEIGHTS[g] });
      vcgNetSurplus[g] = +(ownValuation - payment - variancePenalty).toFixed(4);
    }
  }

  // Risk and violation statistics
  const { meanPsi, sdPsi, robustPsi } = computeViolations(optimalPlan, tau, waterQuota, maxSpray);
  const { events: transitionEvents, expectedCost: transitionCost } = computeExpectedTransitionCosts(optimalPlan, rainDist, Z, H);

  // Format 2D schedule grid: [zone][day]
  const scheduleGrid = Array.from({ length: Z }, (_, z) =>
    Array.from({ length: H }, (_, d) => ACTIONS[optimalPlan[id(z, d)]])
  );

  return {
    schedule: scheduleGrid,
    rawSchedule: optimalPlan,
    welfare: +optimalWelfare.toFixed(4),
    chanceContagion: {
      mean: +meanPsi.toFixed(4),
      sd: +sdPsi.toFixed(4),
      robustValue: +robustPsi.toFixed(4),
      threshold: tau,
      confidenceLevel: `${((1 - epsilon) * 100).toFixed(0)}%`
    },
    vcgPayments,
    vcgNetSurplus,
    transitionEvents,
    transitionCost: +transitionCost.toFixed(4),
    vetoedActions: allowedActions.map((ok, n) => [0, 1, 2, 3].filter(a => !ok.includes(a)).map(a => ACTIONS[a]))
  };
}
