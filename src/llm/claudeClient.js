import 'dotenv/config';

// NOTE: this file is named claudeClient.js for historical reasons (it originally
// called Anthropic's Claude API). It now calls Google's Gemini API instead, using
// its free tier. Every agent/coordinator file still imports { callClaude } from
// here unchanged — they don't know or care which model actually answers.

const API_KEY = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
// Active, stable free-tier models with automatic fallback on 503/429 demand spikes
const CANDIDATE_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];

// Converts the same content shape the agents already build (a plain string, or an
// array of Anthropic-style blocks like {type:'text',...} / {type:'image',...})
// into the shape Gemini's API expects.
function toGeminiParts(userContent) {
  if (typeof userContent === 'string') return [{ text: userContent }];
  return userContent.map(block => {
    if (block.type === 'text') return { text: block.text };
    if (block.type === 'image') {
      return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
    }
    return { text: JSON.stringify(block) };
  });
}

async function requestGemini(model, systemPrompt, userContent) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: toGeminiParts(userContent) }]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    const error = new Error(`Gemini API error ${res.status}: ${errText}`);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error('Gemini returned no usable response (it may have blocked the content).');
  }
  const text = parts.map(p => p.text || '').join('\n');
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? match[0] : cleaned;
  }
}

export async function callClaude(systemPrompt, userContent) {
  if (!API_KEY) {
    throw new Error('Missing GEMINI_API_KEY — copy .env.example to .env and fill it in.');
  }

  let lastError;
  for (const model of CANDIDATE_MODELS) {
    try {
      return await requestGemini(model, systemPrompt, userContent);
    } catch (err) {
      lastError = err;
      // If 503, 429, or 404, fallback to the next candidate model
      if (err.status === 503 || err.status === 429 || err.status === 404) {
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
