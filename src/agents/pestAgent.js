import { callClaude } from '../llm/claudeClient.js';
import { SCORE_SPEC } from '../mechanism/scoreSpec.js';
import fs from 'fs';
import path from 'path';

const ROLE = `You are the Pest & Disease Specialist Agent in an agricultural decision intelligence system.

SCOPE: You reason ONLY about the crop leaf image provided to detect diseases, pathogen infections, or pest attacks. Never comment on weather forecasts, soil moisture sensors, or mandi market prices — other specialist agents own those domains.

DIAGNOSTIC & IDENTIFICATION INSTRUCTIONS:
1. Identify the Disease:
   - Carefully examine the visual symptoms on the leaf (discoloration, necrotic lesions, halos, powdery/fuzzy mildew, spots, wilting, curling, insect feeding marks).
   - Name the specific disease or condition if symptoms match (e.g., "Early Blight (Alternaria solani)", "Late Blight", "Septoria Leaf Spot", "Powdery Mildew", "Bacterial Spot", "Leaf Curl", "Spider Mite Damage", or "Healthy Foliage"). If symptoms are non-specific, provide the most probable diagnosis and explain the symptom pattern.
2. Pathogen Category:
   - State one of: "Fungal", "Bacterial", "Viral", "Pest", "Nutrient Deficiency", or "Healthy".
3. Severity Assessment:
   - Estimate the visible leaf area affected as a percentage (e.g., "5%", "25%", "60%").
   - Urgency rating:
     * low (under 10% affected, isolated, non-spreading, monitor)
     * medium (10-30% affected, targeted treatment needed)
     * high (over 30% affected, spreading pattern, treat promptly)
4. Confidence: "low", "medium", or "high" based on image clarity and certainty.
5. Action: Prescriptive, concise action (maximum 10 words) for the farmer (e.g., "Apply copper fungicide spray to affected leaves").
6. Reason: 1-2 clear sentences explaining the observable visual diagnosis (specific lesions, patterns, colors, location).

OUTPUT FORMAT — respond with ONLY this JSON object. No markdown fences, no preamble, no text outside the object:
{
  "disease": "specific disease name or Healthy Foliage",
  "pathogen": "Fungal|Bacterial|Viral|Pest|Nutrient Deficiency|Healthy",
  "severity": "approximate percentage like 25%",
  "symptoms": "short description of key visual symptoms observed",
  "action": "short imperative action, max 10 words",
  "urgency": "low|medium|high",
  "confidence": "low|medium|high",
  "reason": "1-2 sentences describing what you observed in the leaf image"
}

EXAMPLE
Output: {"disease":"Early Blight (Alternaria solani)","pathogen":"Fungal","severity":"25%","symptoms":"Dark brown concentric target-like rings with chlorotic yellow halos","action":"Apply targeted fungicide spray to affected crops immediately","urgency":"high","confidence":"high","reason":"Roughly 25% of the leaf blade exhibits dark circular necrotic spots with pronounced chlorotic margins, characteristic of early fungal blight."}`;

/**
 * Resolves an image input (file path, data URI, base64 string, or Buffer)
 * into a base64 string and mediaType.
 */
function resolveImage(input) {
  // 1. Data URI string (e.g. data:image/jpeg;base64,...)
  if (typeof input === 'string' && input.startsWith('data:')) {
    const match = input.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
    if (match) {
      return { mediaType: match[1], base64: match[2] };
    }
  }

  // 2. Raw base64 string passed directly
  if (typeof input === 'string' && input.length > 500 && !fs.existsSync(input)) {
    return { mediaType: 'image/jpeg', base64: input };
  }

  // 3. Buffer passed directly
  if (Buffer.isBuffer(input)) {
    return { mediaType: 'image/jpeg', base64: input.toString('base64') };
  }

  // 4. File path provided or candidate paths
  const candidatePaths = [];
  if (typeof input === 'string' && input.trim()) {
    candidatePaths.push(input);
  }

  // Default candidate fallbacks in project root / uploads
  candidatePaths.push(
    path.resolve(process.cwd(), 'uploads', 'active-leaf.jpg'),
    path.resolve(process.cwd(), 'uploads', 'active-leaf.png'),
    path.resolve(process.cwd(), 'sample-leaf.jpg'),
    path.resolve(process.cwd(), 'sample-leaf.jpg.png'),
    'sample-leaf.jpg',
    'sample-leaf.jpg.png'
  );

  for (const candidate of candidatePaths) {
    if (candidate && fs.existsSync(candidate)) {
      const buf = fs.readFileSync(candidate);
      const ext = candidate.split('.').pop().toLowerCase();
      let mediaType = 'image/jpeg';
      if (ext === 'png') mediaType = 'image/png';
      else if (ext === 'webp') mediaType = 'image/webp';
      return { mediaType, base64: buf.toString('base64') };
    }
  }

  return null;
}

export async function runPestAgent(imageInput) {
  const resolved = resolveImage(imageInput);

  if (!resolved) {
    // Graceful fallback instead of unhandled error when no leaf photo is provided
    return {
      agent: 'pest',
      disease: 'No Image Provided',
      pathogen: 'Unknown',
      severity: '0%',
      symptoms: 'No leaf image uploaded',
      action: 'Upload a leaf photo to diagnose disease',
      urgency: 'low',
      confidence: 'low',
      reason: 'No leaf photo was uploaded or found in the project. Upload an image of the affected leaf to run AI disease diagnosis.',
      scores: [
        { WAIT: 0, IRRIGATE: 0, SPRAY: 0, SELL: 0 },
        { WAIT: 0, IRRIGATE: 0, SPRAY: 0, SELL: 0 },
        { WAIT: 0, IRRIGATE: 0, SPRAY: 0, SELL: 0 }
      ],
      spread_hazard: 0.1
    };
  }

  const userContent = [
    { type: 'image', source: { type: 'base64', media_type: resolved.mediaType, data: resolved.base64 } },
    { type: 'text', text: 'Analyze this crop leaf image for disease or pest symptoms. Identify the exact disease, pathogen, severity percentage, observable symptoms, and provide your recommendation.' }
  ];

  const raw = await callClaude(ROLE + SCORE_SPEC, userContent);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      data = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Pest Agent received unparseable response from Gemini: ' + raw.slice(0, 100));
    }
  }

  return {
    agent: 'pest',
    disease: data.disease || 'Unspecified Condition',
    pathogen: data.pathogen || 'Unknown',
    severity: data.severity || '15%',
    symptoms: data.symptoms || data.reason || 'Visual leaf anomalies detected',
    action: data.action || 'Inspect crop and monitor closely',
    urgency: data.urgency || 'medium',
    confidence: data.confidence || 'medium',
    reason: data.reason || 'Analyzed uploaded leaf image.',
    scores: Array.isArray(data.scores) && data.scores.length === 3 ? data.scores : [
      { WAIT: -0.3, IRRIGATE: 0, SPRAY: data.urgency === 'high' ? 0.8 : 0.4, SELL: 0 },
      { WAIT: -0.2, IRRIGATE: 0, SPRAY: data.urgency === 'high' ? 0.6 : 0.3, SELL: 0 },
      { WAIT: -0.1, IRRIGATE: 0, SPRAY: data.urgency === 'high' ? 0.4 : 0.2, SELL: 0 }
    ],
    spread_hazard: Number.isFinite(+data.spread_hazard) ? +data.spread_hazard : (data.urgency === 'high' ? 0.8 : (data.urgency === 'medium' ? 0.4 : 0.1))
  };
}
