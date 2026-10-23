// POST /api/narrate  { image, mode, language, lastLines, stillCount, observationNumber }
//
// Gemini config. Billing is on; paid limits: gemini-3.8-flash 1,000 RPM / 10,000 RPD,
// gemini-3.1-flash-lite 4,000 RPM / 150,000 RPD. Money is the only real constraint:
// DAILY_NARRATION_LIMIT protects a small prepaid balance shared with the Replit version.
import { buildPrompt, MODES, JSON_MODES } from './_prompts.js';
import { rejectBadRequest, checkNarrationLimits } from './_lib.js';

const MODEL_FUNNY = process.env.GEMINI_MODEL_FUNNY || 'gemini-3.8-flash'; // documentary, funny, pumpkin
const MODEL_FAST = process.env.GEMINI_MODEL_FAST || 'gemini-3.1-flash-lite'; // descriptive
const CHAIN = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
const TEMPERATURE = { documentary: 1, funny: 1, descriptive: 0.3, pumpkin: 0.9 };
const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB of JPEG as base64
const DEADLINE_MS = 8000;

// Models to try, starting at the configured one and moving down the chain.
function modelsFor(mode) {
  const first = mode === 'descriptive' ? MODEL_FAST : MODEL_FUNNY;
  const i = CHAIN.indexOf(first);
  return i === -1 ? [first, ...CHAIN] : CHAIN.slice(i);
}

// Minimum thinking, tried in order until the model accepts one (never send both fields).
// thinkingLevel "minimal" still spent ~500 thought tokens (~7s) on gemini-3.8-flash, so try a zero budget first.
const THINKING_OPTIONS = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }];

async function callGemini(model, body, ms) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (rejectBadRequest(req, res)) return;
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini not configured' });

  const b = req.body || {};
  const mode = MODES.includes(b.mode) ? b.mode : null;
  if (!mode) return res.status(400).json({ error: 'Bad mode' });
  if (typeof b.image !== 'string' || !b.image || b.image.length > MAX_IMAGE_CHARS)
    return res.status(413).json({ error: 'Image missing or too large' });
  const language = String(b.language || 'English').replace(/[^\p{L}\p{M}\s()-]/gu, '').slice(0, 40) || 'English';
  const lastLines = (Array.isArray(b.lastLines) ? b.lastLines : []).slice(-4).map((l) => String(l).slice(0, 300));
  const clampInt = (v, max) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));

  const limited = await checkNarrationLimits(req);
  if (limited) return res.status(429).json({ error: limited });

  const prompt = buildPrompt({
    mode,
    language,
    lastLines,
    stillCount: clampInt(b.stillCount, 99),
    observationNumber: clampInt(b.observationNumber, 99999),
  });
  const isJson = JSON_MODES.has(mode);
  const started = Date.now();

  for (const model of modelsFor(mode)) {
    const left = DEADLINE_MS - (Date.now() - started);
    if (left < 500) break;
    const body = {
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: b.image } }, { text: prompt }] }],
      generationConfig: {
        temperature: TEMPERATURE[mode],
        maxOutputTokens: 1024, // includes any thinking tokens; only tokens actually used are billed
        thinkingConfig: THINKING_OPTIONS[0],
        ...(isJson && { responseMimeType: 'application/json' }),
      },
    };
    try {
      let { status, data } = await callGemini(model, body, left);
      // Some models reject a thinking setting: retry the same model with the next one, then without.
      for (let i = 1; status === 400 && /thinking/i.test(data?.error?.message || ''); i++) {
        if (THINKING_OPTIONS[i]) body.generationConfig.thinkingConfig = THINKING_OPTIONS[i];
        else delete body.generationConfig.thinkingConfig;
        ({ status, data } = await callGemini(model, body, DEADLINE_MS - (Date.now() - started)));
        if (!THINKING_OPTIONS[i]) break;
      }
      if (status === 200) {
        const text = (data.candidates?.[0]?.content?.parts || [])
          .filter((p) => p.text && !p.thought)
          .map((p) => p.text)
          .join('')
          .trim();
        const u = data.usageMetadata || {};
        const usage = { finish: data.candidates?.[0]?.finishReason, thoughts: u.thoughtsTokenCount || 0, out: u.candidatesTokenCount || 0, ms: Date.now() - started };
        console.log(`[narrate] ${mode} ${model} ${JSON.stringify(usage)}`);
        if (!text) return res.status(502).json({ error: 'Empty response' });
        if (!isJson) return res.json({ text, model, usage });
        return res.json({ ...(parseJson(text) || { text }), model, usage });
      }
      console.error(`[narrate] ${model} -> ${status}: ${data?.error?.message?.slice(0, 200)}`);
      if (![404, 429].includes(status) && !/quota|exhaust|not found/i.test(data?.error?.message || '')) break;
    } catch (e) {
      console.error(`[narrate] ${model} failed: ${e.name} ${e.message}`);
      break; // timeout or network: let the frontend use a fallback line
    }
  }
  return res.status(502).json({ error: 'Narration unavailable' });
}
