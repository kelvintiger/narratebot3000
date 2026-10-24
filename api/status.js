// GET /api/status -> who this browser is (owner, own keys, or nobody). Owners also see which features are
// configured (booleans only) and today's usage; nobody else does.
import { redis, getDaily, getAccess, ownerAvailable, DAILY_NARRATION_LIMIT, DAILY_TTS_CHAR_LIMIT } from './_lib.js';

const NAMES = [
  'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'VOICE_DOCUMENTARY', 'VOICE_TRAILER', 'VOICE_DESCRIPTIVE',
  'VOICE_PUMPKIN', 'VOICE_SPANISH', 'VOICE_CHINESE', 'OWNER_PASSCODE', 'SESSION_SECRET', 'DAILY_NARRATION_LIMIT', 'DAILY_TTS_CHAR_LIMIT',
];

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const access = getAccess(req);
  const out = { access: access.mode, ownerAvailable: ownerAvailable() };
  if (access.mode === 'byok') return res.json({ ...out, byok: { elevenlabs: Boolean(access.eleven) }, gemini: true, elevenlabs: Boolean(access.eleven) });
  if (access.mode !== 'owner') return res.json(out);

  const configured = Object.fromEntries(NAMES.map((n) => [n, Boolean(process.env[n])]));
  configured.UPSTASH_REDIS = Boolean(redis);
  let narrations = 0, ttsChars = 0;
  try {
    [narrations, ttsChars] = await Promise.all([getDaily('narrations'), getDaily('tts')]);
  } catch (e) {
    console.error('[status] counter read failed', e.message);
  }
  res.json({
    ...out,
    configured,
    gemini: configured.GEMINI_API_KEY,
    elevenlabs: configured.ELEVENLABS_API_KEY,
    today: { narrations, ttsChars },
    limits: { narrations: DAILY_NARRATION_LIMIT, ttsChars: DAILY_TTS_CHAR_LIMIT },
  });
}
