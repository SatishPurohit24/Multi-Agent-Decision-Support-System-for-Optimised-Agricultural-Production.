/**
 * AgriClear-Bench: High-Stakes Public Benchmark for Multi-Agent Allocation under Hidden Biophysical Constraints
 * 
 * Directly addresses the gap identified in:
 * - Shi et al. (2025): "Social Welfare Function Leaderboard: When LLM Agents Meet Social Welfare Optimization"
 * - Gautier & Lacerda (2023): Multiunit Auctions for Chance-Constrained Resource Allocation
 * 
 * Features:
 * 1. Hidden Stochastic Weather Engine (convective precipitation, timing shifts)
 * 2. Hidden Contagion Physics (latent incubation, spore dispersal, foliar humidity)
 * 3. Hidden Hydrological Physics (root-zone moisture, field capacity, deep percolation)
 * 4. Hidden Chemical Resistance Kinetics (mutational selection under repetitive dosing)
 * 
 * Usage:
 *   node bench/agriClearBench.js [SEEDS=300]
 */

import { clearMechanism, ACTIONS } from '../src/mechanism/agriMechanism.js';
import { clear as clearDeterministic } from '../src/mechanism/biocoord.js';

const SEEDS = +process.argv[2] || 300;
const ZONES = 2;
const HORIZON = 3;
const NODES = ZONES * HORIZON;
const WATER_QUOTA = 1;
const SPRAY_CAP = 2;

// Pseudo-Random Generator with repeatable deterministic seeds
let seedState = 42;
function random() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function gaussian(mean = 0, stdev = 1) {
  const u = 1 - random();
  const v = random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdev;
}
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/**
 * 1. Generate Hidden Environment Scenario with Stochastic Uncertainties
 */
function generateHiddenScenario() {
  // Plot initial conditions
  const infection = Array.from({ length: ZONES }, () => (random() < 0.45 ? 0.12 + 0.45 * random() : 0.03));
  const soilMoisture = Array.from({ length: ZONES }, () => 0.14 + 0.18 * random()); // wilting=0.12, optimal=0.28
  const cropAssetValue = Array.from({ length: ZONES }, () => 1.0 + 0.3 * (random() - 0.5));

  // True Hidden Weather Process vs. Forecasted Weather with Uncertainty
  const trueRain = [];
  const forecastRain = [];

  for (let d = 0; d < HORIZON; d++) {
    // Hidden true precipitation: convective storm with 32% probability
    const stormOccurs = random() < 0.32;
    const trueAmount = stormOccurs ? Math.max(0, gaussian(12, 6)) : (random() < 0.2 ? gaussian(2, 1) : 0);
    trueRain.push(Math.max(0, trueAmount));

    // Agent Forecast: noisy estimation with known variance
    const forecastMean = Math.max(0, trueAmount + gaussian(0, 3.5));
    const forecastVar = Math.max(0.5, 2.5 + forecastMean * 0.4);
    const pHeavy = forecastMean >= 4.5 ? 0.65 : (forecastMean >= 2 ? 0.35 : 0.08);
    forecastRain.push({ mean: +forecastMean.toFixed(2), variance: +forecastVar.toFixed(2), pHeavy });
  }

  // Market price momentum (hidden vs public mandi)
  const truePriceTrend = (random() - 0.48) * 0.15; // modal price shift

  return {
    infection,
    soilMoisture,
    cropAssetValue,
    trueRain,
    forecastRain,
    truePriceTrend
  };
}

/**
 * 2. Simulate Agent Bids with Belief Distributions (\mu, \sigma^2, c)
 */
function generateAgentBids(scenario) {
  const { infection, soilMoisture, forecastRain, truePriceTrend } = scenario;

  return Array.from({ length: ZONES }, (_, z) => {
    const inf = infection[z];
    const sm = soilMoisture[z];

    // Weather Agent: Evaluates rain forecast & timing
    const weatherScores = forecastRain.map(r => ({
      WAIT: 0.1,
      IRRIGATE: r.mean >= 4.0 ? -0.95 : (r.mean >= 2.0 ? -0.4 : 0.3),
      SPRAY: r.pHeavy >= 0.35 ? -0.92 : (r.mean >= 3.0 ? -0.6 : 0.2),
      SELL: 0.0
    }));
    const weatherVariances = forecastRain.map(r => ({
      IRRIGATE: clamp(r.variance * 0.04, 0.02, 0.25),
      SPRAY: clamp(r.variance * 0.05, 0.02, 0.30)
    }));

    // Soil Agent: Evaluates moisture deficit
    const soilScores = Array.from({ length: HORIZON }, () => {
      const deficit = (0.28 - sm) / 0.16; // optimal is 0.28
      return {
        WAIT: deficit > 0.5 ? -0.3 : 0.2,
        IRRIGATE: clamp(deficit, -1, 1),
        SPRAY: 0.0,
        SELL: 0.0
      };
    });

    // Pest Agent: Evaluates foliar contagion
    const pestScores = Array.from({ length: HORIZON }, () => ({
      WAIT: inf > 0.15 ? -0.7 : 0.1,
      IRRIGATE: -inf * 1.4, // irrigation increases foliar humidity
      SPRAY: clamp(inf * 3.2 - 0.25, -1, 1),
      SELL: 0.0
    }));

    // Market Agent: Modal price trend
    const marketScores = Array.from({ length: HORIZON }, () => ({
      WAIT: clamp(truePriceTrend * 4, -1, 1),
      IRRIGATE: 0.0,
      SPRAY: 0.0,
      SELL: clamp(-truePriceTrend * 5, -1, 1)
    }));

    return {
      weather: { confidence: 0.90, scores: weatherScores, variances: weatherVariances },
      soil: { confidence: 0.92, scores: soilScores },
      pest: { confidence: 0.88, scores: pestScores },
      market: { confidence: 0.75, scores: marketScores }
    };
  });
}

/**
 * 3. The Hidden Biophysical Ground-Truth Simulator
 * Evaluates realized profit, disease infection, wash-off waste, and constraint violations
 */
function evaluateGroundTruth(scenario, actionIndices) {
  const { infection, soilMoisture, cropAssetValue, trueRain, truePriceTrend } = scenario;
  let currentInfection = infection.slice();
  let currentMoisture = soilMoisture.slice();

  let realizedNetProfit = 0;
  let washOffIncidents = 0;
  let hydraulicViolations = 0;
  let pesticideOverdoses = 0;

  const sprayCount = Array(ZONES).fill(0);
  const soldStatus = Array(ZONES).fill(false);

  for (let d = 0; d < HORIZON; d++) {
    const dailyRain = trueRain[d];

    // Check daily hydraulic quota
    let dailyIrrigationCount = 0;
    for (let z = 0; z < ZONES; z++) {
      if (actionIndices[z * HORIZON + d] === 1) dailyIrrigationCount++;
    }
    if (dailyIrrigationCount > WATER_QUOTA) {
      hydraulicViolations += (dailyIrrigationCount - WATER_QUOTA);
      // Aquifer depletion / power tariff surge penalty
      realizedNetProfit -= 0.08 * (dailyIrrigationCount - WATER_QUOTA);
    }

    const nextInfection = [];

    for (let z = 0; z < ZONES; z++) {
      const act = actionIndices[z * HORIZON + d];
      const prevIrrigated = d > 0 && actionIndices[z * HORIZON + d - 1] === 1;

      // 1. Chemical Spray Dynamics with Wash-off & Resistance Kinetics
      let sprayEfficacy = 0.0;
      if (act === 2) {
        sprayCount[z]++;
        if (sprayCount[z] > SPRAY_CAP) {
          pesticideOverdoses++;
          // Environmental fine & withholding violation
          realizedNetProfit -= 0.10;
        }

        // Base efficacy
        sprayEfficacy = 0.65;

        // Wash-off loss: if true rain >= 4.0mm occurs on spray day
        if (dailyRain >= 4.0) {
          sprayEfficacy *= 0.15; // chemical washed into soil runoff
          washOffIncidents++;
          realizedNetProfit -= 0.04; // wasted chemical cost
        }

        // Wet canopy attenuation
        if (prevIrrigated) sprayEfficacy *= 0.45;

        // Mutation Resistance: efficacy decays with repeated applications
        if (sprayCount[z] === 2) sprayEfficacy *= 0.80;
        if (sprayCount[z] >= 3) sprayEfficacy *= 0.35; // pathogen mutation resistance!
      }

      // 2. Microscopic Pathogen Spore Transmission
      // Local plot hazard
      let localHazard = 0.12 * currentInfection[z] * (act === 1 ? 1.5 : 1.0) * (prevIrrigated ? 1.3 : 1.0);

      // Neighboring plot cross-contagion
      for (let z2 = 0; z2 < ZONES; z2++) {
        if (z2 !== z) {
          const neighborAct = actionIndices[z2 * HORIZON + d];
          const neighborSpread = 0.35 * currentInfection[z2] * (1.0 + (neighborAct === 1 ? 0.7 : 0.0) - (neighborAct === 2 ? 0.5 : 0.0));
          localHazard += 0.5 * neighborSpread;
        }
      }

      const postInfection = clamp(
        currentInfection[z] * 0.92 * (1.0 - sprayEfficacy) + localHazard * (1.0 - currentInfection[z]),
        0.01,
        0.99
      );
      nextInfection.push(postInfection);

      // 3. Hydrology & Crop Growth Dynamics
      const irrigationEffective = (act === 1 && dailyRain < 5.0);
      const moistureGain = (irrigationEffective ? 0.09 : 0.0) + (dailyRain >= 5.0 ? 0.08 : 0.0);
      currentMoisture[z] = clamp(currentMoisture[z] - 0.035 + moistureGain, 0.05, 0.45);

      // Yield bonus from staying above wilting point (0.12)
      let yieldGrowth = 0.0;
      if (currentMoisture[z] >= 0.20 && currentMoisture[z] <= 0.35) {
        yieldGrowth = 0.045;
      } else if (currentMoisture[z] < 0.14) {
        yieldGrowth = -0.06; // drought stress
      }

      // 4. Market Realization
      let marketGain = 0;
      if (act === 3 && !soldStatus[z]) {
        soldStatus[z] = true;
        marketGain = clamp(-truePriceTrend * 5, -0.05, 0.08);
      }

      // 5. Net Economic Balance
      const sprayCost = act === 2 ? 0.03 : 0.0;
      const irrigateCost = act === 1 ? 0.015 : 0.0;
      const diseaseDamage = postInfection * 0.35 * cropAssetValue[z];

      realizedNetProfit += (yieldGrowth + marketGain - sprayCost - irrigateCost - diseaseDamage);
    }

    currentInfection = nextInfection;
  }

  const meanFinalInfection = currentInfection.reduce((a, b) => a + b, 0) / ZONES;

  return {
    netProfit: realizedNetProfit,
    finalInfection: meanFinalInfection,
    washOffIncidents,
    hydraulicViolations,
    pesticideOverdoses
  };
}

/**
 * 4. Competing Allocation Baselines
 */
const BASELINES = {
  // Baseline 1: Standard LLM Majority Voting / Prompt Chaining Coordinator
  'LLM-Voting-Coordinator': (scenario, bids) => {
    // LLMs vote based on highest immediate agent score, blind to cross-day temporal coupling
    return Array.from({ length: NODES }, (_, n) => {
      const z = Math.floor(n / HORIZON);
      const d = n % HORIZON;
      const b = bids[z];
      const votes = [0, 0, 0, 0];
      ['weather', 'soil', 'pest', 'market'].forEach(g => {
        const scores = [0, 1, 2, 3].map(a => b[g]?.scores[d]?.[ACTIONS[a]] ?? 0);
        const topAction = scores.indexOf(Math.max(...scores));
        votes[topAction]++;
      });
      return votes.indexOf(Math.max(...votes));
    });
  },

  // Baseline 2: Classical Agronomic Priority-Rule Heuristic
  'Priority-Rule-Heuristic': (scenario, bids) => {
    const plan = Array(NODES).fill(0);
    const sold = Array(ZONES).fill(false);
    for (let d = 0; d < HORIZON; d++) {
      let dailyWater = 0;
      for (let z = 0; z < ZONES; z++) {
        const n = z * HORIZON + d;
        const b = bids[z];
        if (b.pest.scores[d].SPRAY > 0.35 && b.weather.scores[d].SPRAY > -0.8) {
          plan[n] = 2; // SPRAY
        } else if (b.soil.scores[d].IRRIGATE > 0.35 && b.weather.scores[d].IRRIGATE > -0.8 && dailyWater < WATER_QUOTA) {
          plan[n] = 1; // IRRIGATE
          dailyWater++;
        } else if (b.market.scores[d].SELL > 0.35 && !sold[z]) {
          plan[n] = 3; // SELL
          sold[z] = true;
        } else {
          plan[n] = 0; // WAIT
        }
      }
    }
    return plan;
  },

  // Baseline 3: Deterministic Unconstrained Solver
  'Deterministic-Solver': (scenario, bids) => {
    const hazard = scenario.infection.map(i => i * 0.8);
    const res = clearDeterministic({ Z: ZONES, H: HORIZON, recs: bids, hazard }, { tau: 0.18, water: WATER_QUOTA });
    return res.raw;
  },

  // Proposed: AgriMechanism (Chance-Constrained + VCG Clarke Pricing + Calibrated Vetoes)
  'AgriMechanism-ChanceConstrained': (scenario, bids) => {
    const hazardMeans = Array.from({ length: NODES }, (_, n) => scenario.infection[Math.floor(n / HORIZON)] * 0.8);
    const hazardVars = Array.from({ length: NODES }, () => 0.035);
    const res = clearMechanism({
      Z: ZONES,
      H: HORIZON,
      bids,
      hazardMeans,
      hazardVars,
      rainDist: scenario.forecastRain,
      plotValues: scenario.cropAssetValue
    }, {
      tau: 0.18,
      epsilon: 0.05,
      waterQuota: WATER_QUOTA,
      maxSpray: SPRAY_CAP,
      enableChanceConstraint: true,
      computeVcgPayments: true
    });
    return res.rawSchedule;
  }
};

/**
 * 5. Run Benchmark Execution
 */
console.log(`\n=================================================================================`);
console.log(`🌾 AgriClear-Bench: High-Stakes Public Agricultural Allocation Benchmark`);
console.log(`Evaluating ${SEEDS} Paired Seeds under Hidden Weather, Contagion, & Water Constraints`);
console.log(`=================================================================================\n`);

const results = Object.fromEntries(
  Object.keys(BASELINES).map(k => [k, { profits: [], infections: [], washOff: [], hydraulicViol: [], pesticideViol: [] }])
);

for (let seed = 0; seed < SEEDS; seed++) {
  const scenario = generateHiddenScenario();
  const bids = generateAgentBids(scenario);

  for (const name in BASELINES) {
    const actionPlan = BASELINES[name](scenario, bids);
    const metrics = evaluateGroundTruth(scenario, actionPlan);

    results[name].profits.push(metrics.netProfit);
    results[name].infections.push(metrics.finalInfection);
    results[name].washOff.push(metrics.washOffIncidents);
    results[name].hydraulicViol.push(metrics.hydraulicViolations);
    results[name].pesticideViol.push(metrics.pesticideOverdoses);
  }
}

// Statistical Helper Functions
const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const sd = arr => {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
};
const p90 = arr => arr.slice().sort((a, b) => a - b)[Math.floor(0.90 * arr.length)];
const cvar10 = arr => {
  const sorted = arr.slice().sort((a, b) => b - a); // highest infections
  const tail = sorted.slice(0, Math.floor(0.10 * sorted.length));
  return mean(tail);
};

// Two-Sided Sign Test for Statistical Dominance
function signTest(a, b) {
  let wins = 0, losses = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + 1e-6) wins++;
    else if (a[i] < b[i] - 1e-6) losses++;
  }
  const n = wins + losses;
  const k = Math.max(wins, losses);
  let p = 0;
  for (let j = k; j <= n; j++) {
    let comb = 1;
    for (let c = 1; c <= j; c++) comb = comb * (n - j + c) / c;
    p += comb / (2 ** n);
  }
  return { wins, losses, ties: a.length - n, pVal: Math.min(1, 2 * p).toExponential(3) };
}

// Format and Display Results Table
const tableSummary = Object.fromEntries(
  Object.entries(results).map(([k, v]) => [
    k,
    {
      'Net Profit (Social Welfare)': `${mean(v.profits).toFixed(3)} ± ${sd(v.profits).toFixed(3)}`,
      'Mean Infection': mean(v.infections).toFixed(3),
      'P90 Tail Contagion': p90(v.infections).toFixed(3),
      'CVaR_0.10 Contagion': cvar10(v.infections).toFixed(3),
      'Wash-off Wasted (%)': `${((mean(v.washOff) / (HORIZON * ZONES)) * 100).toFixed(1)}%`,
      'Hydraulic Violations': mean(v.hydraulicViol).toFixed(2),
      'Pesticide Overdoses': mean(v.pesticideViol).toFixed(2)
    }
  ])
);

console.table(tableSummary);

console.log(`\n---------------------------------------------------------------------------------`);
console.log(`STATISTICAL SIGNIFICANCE COMPARISONS (Sign Test across ${SEEDS} Paired Runs)`);
console.log(`---------------------------------------------------------------------------------`);

const proposed = results['AgriMechanism-ChanceConstrained'];

for (const baselineName of ['LLM-Voting-Coordinator', 'Priority-Rule-Heuristic', 'Deterministic-Solver']) {
  const comp = results[baselineName];
  const profitSign = signTest(proposed.profits, comp.profits);
  const infectionSign = signTest(comp.infections, proposed.infections); // winning means proposed had lower infection!

  console.log(`\nProposed Mechanism vs. ${baselineName}:`);
  console.log(`  -> Profit Dominance:    Wins: ${profitSign.wins}, Losses: ${profitSign.losses}, Ties: ${profitSign.ties} (p = ${profitSign.pVal})`);
  console.log(`  -> Contagion Reduction: Wins: ${infectionSign.wins}, Losses: ${infectionSign.losses}, Ties: ${infectionSign.ties} (p = ${infectionSign.pVal})`);
}
console.log(`\n=================================================================================\n`);
