// GET /api/speak?text=&mode=&lang=   or   POST /api/speak { text, mode, language }  ->  streamed audio/mpeg
// GET lets an <audio> element start playing while ElevenLabs is still generating; POST is kept for passcode-protected demos.
import { rejectBadRequest, incrDaily, checkSpeakLimit, DAILY_TTS_CHAR_LIMIT } from './_lib.js';

const env = process.env;

// Voice config: tweak settings here. Voice IDs aren't secret; env vars override the defaults.
const VOICES = {
  documentary: { id: env.VOICE_DOCUMENTARY || 'ksryVoNAGZT8GxWCTiVm', settings: { stability: 0.55, similarity_boost: 0.75, style: 0.2 } },
  funny: { id: env.VOICE_TRAILER || 'laTmoAT4stwoPzthxjZT', settings: { stability: 0.35, similarity_boost: 0.75, style: 0.5 } },
  pumpkin: { id: env.VOICE_PUMPKIN || env.VOICE_TRAILER || 'UT6jSiOicYbqK2YQBcld', settings: { stability: 0.3, similarity_boost: 0.75, style: 0.6 } },
  descriptive: { id: env.VOICE_DESCRIPTIVE || env.VOICE_DOCUMENTARY || 'ksryVoNAGZT8GxWCTiVm', settings: { stability: 0.7, similarity_boost: 0.75, style: 0 } },
};
const LANGUAGE_VOICES = { es: env.VOICE_SPANISH, zh: env.VOICE_CHINESE };
const LANGUAGE_SETTINGS = { stability: 0.7, similarity_boost: 0.75, style: 0 };
const SPEED = 1.1; // ElevenLabs speaking rate, 0.7–1.2 (1.0 = the voice's natural pace)

const MODEL = env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const MODEL_TELUGU = env.ELEVENLABS_MODEL_TELUGU || 'eleven_v3'; // multilingual_v2 has no Telugu; v3 lists te
const MODELS_WITH_LANGUAGE_CODE = new Set(['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3']);
const FIRST_BYTE_MS = 8000;
const STREAM_MS = 14000; // vercel.json maxDuration is 15s

export default async function handler(req, res) {
  if (rejectBadRequest(req, res, ['GET', 'POST'])) return;
  if (!env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'ElevenLabs not configured' });

  const q = { ...(req.query || {}), ...(req.method === 'POST' ? req.body || {} : {}) };
  const text = String(q.text || '').trim();
  if (!text || text.length > 300) return res.status(400).json({ error: 'Text missing or over 300 characters' });
  const lang = String(q.lang || q.language || 'en').toLowerCase().slice(0, 2);

  if (!(await checkSpeakLimit(req))) return res.status(429).json({ error: 'Too many voice requests this minute' });
  const used = await incrDaily('tts', text.length);
  res.setHeader('x-tts-today', String(used));
  if (used > DAILY_TTS_CHAR_LIMIT) return res.status(429).json({ error: 'voice budget reached', budget: true });

  const base = VOICES[q.mode] || VOICES.documentary;
  const voice = LANGUAGE_VOICES[lang] ? { id: LANGUAGE_VOICES[lang], settings: LANGUAGE_SETTINGS } : base;
  const model = lang === 'te' ? MODEL_TELUGU : MODEL;
  // ponytail: v3 documents stability as three presets (0 creative, 0.5 natural, 1 robust), so snap to the nearest.
  const settings = model === 'eleven_v3' ? { ...voice.settings, stability: Math.round(voice.settings.stability * 2) / 2 } : { ...voice.settings, speed: SPEED };

  const started = Date.now();
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), FIRST_BYTE_MS);
  res.on?.('close', () => ac.abort()); // listener left or interrupted: stop generating
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': env.ELEVENLABS_API_KEY, accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, voice_settings: settings, ...(MODELS_WITH_LANGUAGE_CODE.has(model) && { language_code: lang }) }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      console.error(`[speak] ElevenLabs ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return res.status(r.status === 429 ? 429 : 502).json({ error: 'Voice unavailable' });
    }
    timer = setTimeout(() => ac.abort(), STREAM_MS);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    res.status(200);
    const t0 = Date.now();
    let first = true;
    for await (const chunk of r.body) {
      if (first) res.setHeader('x-el-first-chunk-ms', String(Date.now() - started)), (first = false);
      res.write(chunk);
    }
    console.log(`[speak] ${model} first chunk ${Date.now() - t0}ms after headers`);
    res.end();
  } catch (e) {
    console.error(`[speak] failed: ${e.name} ${e.message}`);
    if (res.headersSent) return res.end();
    return res.status(504).json({ error: 'Voice timed out' });
  } finally {
    clearTimeout(timer);
  }
}
