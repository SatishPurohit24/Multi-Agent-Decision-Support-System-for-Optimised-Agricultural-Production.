import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { fetchWeatherAndSoil } from './src/dataSources/weatherApi.js';
import { fetchMandiPrice } from './src/dataSources/marketApi.js';
import { runWeatherAgent } from './src/agents/weatherAgent.js';
import { runSoilAgent } from './src/agents/soilAgent.js';
import { runPestAgent } from './src/agents/pestAgent.js';
import { runMarketAgent } from './src/agents/marketAgent.js';
import { runCoordinator, runMechanismCoordinator } from './src/coordinator.js';
import { callClaude } from './src/llm/claudeClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let customLeafPath = null;

function getActiveLeaf() {
  if (customLeafPath && fs.existsSync(customLeafPath)) return customLeafPath;
  const uploadActive = path.join(UPLOADS_DIR, 'active-leaf.jpg');
  if (fs.existsSync(uploadActive)) return uploadActive;
  const sampleJpg = path.join(__dirname, 'sample-leaf.jpg');
  if (fs.existsSync(sampleJpg)) return sampleJpg;
  const samplePng = path.join(__dirname, 'sample-leaf.jpg.png');
  if (fs.existsSync(samplePng)) return samplePng;
  return null;
}

// Allow JSON body parsing up to 25MB for image uploads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serves the real leaf photo (uploaded or sample)
app.get('/api/leaf-image', (req, res) => {
  const leafPath = getActiveLeaf();
  if (leafPath && fs.existsSync(leafPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const ext = leafPath.split('.').pop().toLowerCase();
    res.setHeader('Content-Type', ext === 'png' ? 'image/png' : 'image/jpeg');
    res.sendFile(leafPath);
  } else {
    res.status(404).json({ error: 'No leaf image found. Please upload a leaf photo.' });
  }
});

// Returns leaf status (whether a custom leaf is active or sample)
app.get('/api/leaf-status', (req, res) => {
  const current = getActiveLeaf();
  const isCustom = !!current && current.includes('uploads');
  res.json({
    hasImage: !!current,
    isCustom,
    filename: isCustom ? path.basename(current) : 'sample-leaf.jpg'
  });
});

// Upload a new crop leaf image
app.post('/api/upload-leaf', async (req, res) => {
  try {
    const { image, filename = 'leaf.jpg', diagnose = false } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const matches = image.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/s);
    let buffer;
    let ext = 'jpg';

    if (matches) {
      ext = matches[1] === 'png' ? 'png' : 'jpg';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(image, 'base64');
    }

    const targetPath = path.join(UPLOADS_DIR, `active-leaf.${ext}`);
    fs.writeFileSync(targetPath, buffer);
    customLeafPath = targetPath;

    let diagnosis = null;
    if (diagnose) {
      diagnosis = await runPestAgent(targetPath);
    }

    res.json({
      success: true,
      message: 'Leaf image uploaded successfully',
      isCustom: true,
      diagnosis,
      imageUrl: `/api/leaf-image?t=${Date.now()}`
    });
  } catch (err) {
    console.error('Error uploading leaf:', err);
    res.status(500).json({ error: err.message });
  }
});

// Standalone leaf disease diagnosis endpoint
app.post('/api/diagnose-leaf', async (req, res) => {
  try {
    const input = req.body?.image || getActiveLeaf();
    if (!input) {
      return res.status(400).json({ error: 'No leaf image provided or found on server.' });
    }
    const diagnosis = await runPestAgent(input);
    res.json({ success: true, diagnosis });
  } catch (err) {
    console.error('Error diagnosing leaf:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reset leaf to default sample
app.post('/api/reset-leaf', (req, res) => {
  customLeafPath = null;
  const uploadActiveJpg = path.join(UPLOADS_DIR, 'active-leaf.jpg');
  const uploadActivePng = path.join(UPLOADS_DIR, 'active-leaf.png');
  if (fs.existsSync(uploadActiveJpg)) try { fs.unlinkSync(uploadActiveJpg); } catch (_) {}
  if (fs.existsSync(uploadActivePng)) try { fs.unlinkSync(uploadActivePng); } catch (_) {}

  res.json({
    success: true,
    message: 'Reset to default sample leaf',
    isCustom: false,
    imageUrl: `/api/leaf-image?t=${Date.now()}`
  });
});

// Translate agricultural advice / plan into chosen regional or global language
app.post('/api/translate', async (req, res) => {
  const { text, targetLang, langName } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text to translate' });
  if (!targetLang || targetLang === 'en') return res.json({ success: true, translated: text });

  try {
    const prompt = `You are an expert agricultural translator. Translate the following agricultural advice, crop status, or plan into ${langName || targetLang} accurately, naturally, and clearly so that an Indian farmer or agronomist can immediately understand it. Output ONLY the translated text without any explanation, markdown fences, or quotes.`;
    const translated = await callClaude(prompt, text);
    res.json({ success: true, translated: translated.trim() });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: err.message, fallback: text });
  }
});

// Streams every stage of a real run to the browser via Server-Sent Events
app.get('/api/run', async (req, res) => {
  const LAT = parseFloat(req.query.lat) || 21.1458;
  const LON = parseFloat(req.query.lon) || 79.0882;
  const COMMODITY = req.query.commodity || 'Tomato';
  const STATE = req.query.state || 'Maharashtra';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('log', { message: `Fetching live weather & soil data for ${LAT.toFixed(2)}, ${LON.toFixed(2)}...` });
    const weatherData = await fetchWeatherAndSoil(LAT, LON);
    send('data', { type: 'weather', ...weatherData });
    send('log', { message: `Weather/soil received — rain ${weatherData.rain_probability_next_12h}%, soil ${weatherData.soil_moisture_m3m3} m3/m3` });

    send('log', { message: `Fetching live mandi prices for ${COMMODITY}, ${STATE}...` });
    let priceRecords = [];
    try {
      priceRecords = await fetchMandiPrice(COMMODITY, STATE);
      send('data', { type: 'market', records: priceRecords, commodity: COMMODITY, state: STATE });
      send('log', { message: `Market data received — ${priceRecords.length} record(s)` });
    } catch (e) {
      send('data', { type: 'market', records: [], commodity: COMMODITY, state: STATE, error: e.message });
      send('log', { message: `Market data unavailable: ${e.message}` });
    }

    ['weather', 'soil', 'pest', 'market'].forEach(a => send('agent', { agent: a, status: 'thinking' }));

    const leafToAnalyze = getActiveLeaf();
    send('log', { message: `Pest Agent is analyzing ${customLeafPath ? 'uploaded leaf photo' : 'sample leaf image'} for disease...` });

    const jobs = [
      runWeatherAgent(weatherData)
        .then(r => { send('agent', { ...r, status: 'done' }); return r; })
        .catch(e => {
          const r = { agent: 'weather', action: 'Unavailable', urgency: 'low', confidence: 'low', reason: e.message };
          send('agent', { ...r, status: 'error' });
          return r;
        }),
      runSoilAgent(weatherData)
        .then(r => { send('agent', { ...r, status: 'done' }); return r; })
        .catch(e => {
          const r = { agent: 'soil', action: 'Unavailable', urgency: 'low', confidence: 'low', reason: e.message };
          send('agent', { ...r, status: 'error' });
          return r;
        }),
      runPestAgent(leafToAnalyze)
        .then(r => { send('agent', { ...r, status: 'done' }); return r; })
        .catch(e => {
          const r = {
            agent: 'pest',
            disease: 'Diagnosis Error',
            pathogen: 'Unknown',
            severity: '0%',
            action: 'Unavailable',
            urgency: 'low',
            confidence: 'low',
            reason: e.message
          };
          send('agent', { ...r, status: 'error' });
          return r;
        }),
      runMarketAgent(priceRecords)
        .then(r => { send('agent', { ...r, status: 'done' }); return r; })
        .catch(e => {
          const r = { agent: 'market', action: 'Unavailable', urgency: 'low', confidence: 'low', reason: e.message };
          send('agent', { ...r, status: 'error' });
          return r;
        })
    ];

    const results = await Promise.all(jobs);

    send('log', { message: 'All four agents responded — deterministic clearing engine is solving the joint 3-day plan (and LLM coordinator runs as baseline)...' });
    send('coordinator', { status: 'thinking' });
    const [mech, base] = await Promise.all([
      runMechanismCoordinator(results).catch(e => ({ error: e.message })),
      runCoordinator(results).catch(e => ({ error: e.message }))
    ]);

    if (mech.error) send('log', { message: `Clearing solver failed: ${mech.error}` });
    const final = mech.error
      ? (base.error ? { plan: 'Coordinator unavailable', conflict: base.error, overridden_agent: 'NONE' } : { ...base, source: 'llm-fallback' })
      : { plan: mech.plan, conflict: mech.conflict, overridden_agent: mech.overridden_agent, source: 'clearing-engine' };

    send('coordinator', { status: 'done', ...final });
    if (!mech.error) send('mechanism', { ...mech.details, baseline: base });
    send('log', { message: 'Coordinator produced final plan.' });

    send('complete', {});
  } catch (err) {
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));
