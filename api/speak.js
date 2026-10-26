// GET /api/speak?text=&mode=&lang=&prev=&next=   or   POST /api/speak { text, mode, language, prev, next }  ->  streamed audio/mpeg
// GET lets an <audio> element start playing while ElevenLabs is still generating (the session cookie rides along).
// Owner sessions use ELEVENLABS_API_KEY and count against DAILY_TTS_CHAR_LIMIT; visitors use their own key.
import { rejectBadRequest, incrDaily, checkSpeakLimit, getAccess, redact, DAILY_TTS_CHAR_LIMIT } from './_lib.js';

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

const FALLBACK_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // ElevenLabs premade "George": available on every plan, for visitors' keys

const MODEL = env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'; // chosen for voice quality, for the languages it speaks
const MODEL_V3 = env.ELEVENLABS_MODEL_V3 || env.ELEVENLABS_MODEL_TELUGU || 'eleven_v3'; // every other language
// The languages the app offers: the 85 Eleven v3 supports (https://elevenlabs.io/docs/models). Anything else -> 'en'.
const LANGS = new Set(('af ar hy as ast az be bn bs bg my yue ca ceb ny hr cs da nl en et fil fi fr gl ka de el gu ha he hi hu is id ga it ' +
  'ja jv kn kk ky ko lv ln lt lb mk ms ml mt zh mi mr mn ne no oc or ps fa pl pt pa ro ru sr sd sk sl so es sw sv tg ta te th tr uk ur uz vi cy yo').split(' '));
// The 29 eleven_multilingual_v2 speaks.
const V2_LANGS = new Set('en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru'.split(' '));
const MODELS_WITH_LANGUAGE_CODE = new Set(['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3']);
// Request stitching: the surrounding sentences keep prosody continuous when a line is spoken one sentence per request.
const MODELS_WITH_STITCHING = new Set(['eleven_multilingual_v2']);
const FIRST_BYTE_MS = 8000;
const STREAM_MS = 14000; // vercel.json maxDuration is 15s

export default async function handler(req, res) {
  if (rejectBadRequest(req, res, ['GET', 'POST'])) return;
  const access = getAccess(req);
  if (access.mode === 'none') return res.status(401).json({ error: 'access' });
  const owner = access.mode === 'owner';
  const key = owner ? env.ELEVENLABS_API_KEY : access.eleven;
  if (!key) return owner ? res.status(503).json({ error: 'ElevenLabs not configured' }) : res.status(403).json({ error: 'no-voice-key' });

  const q = { ...(req.query || {}), ...(req.method === 'POST' ? req.body || {} : {}) };
  const text = String(q.text || '').trim();
  if (!text || text.length > 300) return res.status(400).json({ error: 'Text missing or over 300 characters' });
  const rawLang = String(q.lang || q.language || 'en').toLowerCase();
  const lang = /^[a-z]{2,3}$/.test(rawLang) && LANGS.has(rawLang) ? rawLang : 'en';
  const prev = String(q.prev || '').trim().slice(-300), next = String(q.next || '').trim().slice(0, 300);

  if (!(await checkSpeakLimit(req))) return res.status(429).json({ error: 'Too many voice requests this minute' });
  if (owner) {
    const used = await incrDaily('tts', text.length);
    res.setHeader('x-tts-today', String(used));
    if (used > DAILY_TTS_CHAR_LIMIT) return res.status(429).json({ error: 'voice budget reached', budget: true });
  }

  const base = Object.hasOwn(VOICES, q.mode) ? VOICES[q.mode] : VOICES.documentary;
  const voice = LANGUAGE_VOICES[lang] ? { id: LANGUAGE_VOICES[lang], settings: LANGUAGE_SETTINGS } : base;
  const model = V2_LANGS.has(lang) ? MODEL : MODEL_V3;
  // ponytail: v3 documents stability as three presets (0 creative, 0.5 natural, 1 robust), so snap to the nearest.
  const settings = model === 'eleven_v3' ? { ...voice.settings, stability: Math.round(voice.settings.stability * 2) / 2 } : { ...voice.settings, speed: SPEED };
  const body = JSON.stringify({
    text, model_id: model, voice_settings: settings,
    ...(MODELS_WITH_LANGUAGE_CODE.has(model) && { language_code: lang }),
    ...(MODELS_WITH_STITCHING.has(model) && prev && { previous_text: prev }),
    ...(MODELS_WITH_STITCHING.has(model) && next && { next_text: next }),
  });

  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), FIRST_BYTE_MS); // one first-byte deadline covers the retry too
  res.on?.('close', () => ac.abort()); // listener left or interrupted: stop generating
  const tts = (voiceId) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key, accept: 'audio/mpeg' },
    body,
    signal: ac.signal,
  });
  const logFail = async (r, voiceId) => console.error(`[speak] ${access.mode} ElevenLabs ${model} ${voiceId} ${r.status}: ${redact(await r.text().catch(() => ''), key).slice(0, 200)}`);
  try {
    let vid = voice.id;
    let r = await tts(vid);
    // A visitor's plan may not include our library voices: retry once with a premade voice.
    if (!owner && !r.ok && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429 && vid !== FALLBACK_VOICE) {
      await logFail(r, vid);
      r = await tts((vid = FALLBACK_VOICE));
    }
    clearTimeout(timer);
    if (!r.ok) {
      await logFail(r, vid);
      if (!owner && r.status === 401) return res.status(401).json({ error: 'eleven-key' });
      return res.status(r.status === 429 ? 429 : 502).json({ error: 'Voice unavailable' });
    }
    timer = setTimeout(() => ac.abort(), STREAM_MS);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    res.status(200);
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    console.error(`[speak] failed: ${e.name} ${redact(e.message, key)}`);
    if (res.headersSent) return res.end();
    return res.status(504).json({ error: 'Voice timed out' });
  } finally {
    clearTimeout(timer);
  }
}
