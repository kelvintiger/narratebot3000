// POST /api/speak  { text, mode, language }  ->  audio/mpeg
import { rejectBadRequest, incrDaily, DAILY_TTS_CHAR_LIMIT } from './_lib.js';

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

const MODEL = env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const MODELS_WITH_LANGUAGE_CODE = new Set(['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3']);

export default async function handler(req, res) {
  if (rejectBadRequest(req, res)) return;
  if (!env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'ElevenLabs not configured' });

  const { mode, language } = req.body || {};
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 300) return res.status(400).json({ error: 'Text missing or over 300 characters' });
  const lang = String(language || 'en').toLowerCase().slice(0, 2);

  const used = await incrDaily('tts', text.length);
  res.setHeader('x-tts-today', String(used));
  if (used > DAILY_TTS_CHAR_LIMIT) return res.status(429).json({ error: 'voice budget reached', budget: true });

  const base = VOICES[mode] || VOICES.documentary;
  const voice = LANGUAGE_VOICES[lang] ? { id: LANGUAGE_VOICES[lang], settings: LANGUAGE_SETTINGS } : base;

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': env.ELEVENLABS_API_KEY, accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: voice.settings,
        ...(MODELS_WITH_LANGUAGE_CODE.has(MODEL) && { language_code: lang }),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error(`[speak] ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return res.status(r.status === 429 ? 429 : 502).json({ error: 'Voice unavailable' });
    }
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(`[speak] failed: ${e.name} ${e.message}`);
    return res.status(504).json({ error: 'Voice timed out' });
  }
}
