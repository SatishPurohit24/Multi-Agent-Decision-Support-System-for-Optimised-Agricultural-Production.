import 'dotenv/config';
import { fetchWeatherAndSoil } from './dataSources/weatherApi.js';
import { fetchMandiPrice } from './dataSources/marketApi.js';
import { runWeatherAgent } from './agents/weatherAgent.js';
import { runSoilAgent } from './agents/soilAgent.js';
import { runPestAgent } from './agents/pestAgent.js';
import { runMarketAgent } from './agents/marketAgent.js';
import { runCoordinator } from './coordinator.js';

// ---- Change these for your test run ----
const LAT = 21.1458;              // Nagpur, India — change to your farm location
const LON = 79.0882;
const COMMODITY = 'Tomato';
const STATE = 'Maharashtra';
const LEAF_IMAGE_PATH = './sample-leaf.jpg'; // put a real leaf photo in the project root with this name
// -----------------------------------------

async function main() {
  console.log('Step 1: Fetching live data (weather, soil, market)...');
  const weatherData = await fetchWeatherAndSoil(LAT, LON);
  const priceRecords = await fetchMandiPrice(COMMODITY, STATE);
  console.log('  weather/soil:', weatherData);
  console.log('  market records fetched:', priceRecords.length);

  console.log('\nStep 2: Running all 4 agents independently...');
  const results = await Promise.all([
    runWeatherAgent(weatherData),
    runSoilAgent(weatherData),
    runPestAgent(LEAF_IMAGE_PATH),
    runMarketAgent(priceRecords)
  ]);

  results.forEach(r =>
    console.log(
      `\n  [${r.agent}] ${r.action} (urgency: ${r.urgency}, confidence: ${r.confidence})\n    reason: ${r.reason}`
    )
  );

  console.log('\nStep 3: Running coordinator to resolve conflicts...');
  const final = await runCoordinator(results);

  console.log('\n=================== FINAL DECISION ===================');
  console.log('Plan:', final.plan);
  console.log('Conflict handled:', final.conflict);
  console.log('Deprioritized agent:', final.overridden_agent);
  console.log('=======================================================');
}

main().catch(err => console.error('\nError:', err.message));
