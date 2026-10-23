// GET /api/status -> which features are configured (booleans only) and today's usage.
import { redis, getDaily, passcodeOk, DAILY_NARRATION_LIMIT, DAILY_TTS_CHAR_LIMIT } from './_lib.js';

const NAMES = [
  'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'VOICE_DOCUMENTARY', 'VOICE_TRAILER', 'VOICE_DESCRIPTIVE',
  'VOICE_PUMPKIN', 'VOICE_SPANISH', 'VOICE_CHINESE', 'DEMO_PASSCODE', 'DAILY_NARRATION_LIMIT', 'DAILY_TTS_CHAR_LIMIT',
];

export default async function handler(req, res) {
  const configured = Object.fromEntries(NAMES.map((n) => [n, Boolean(process.env[n])]));
  configured.UPSTASH_REDIS = Boolean(redis);
  let narrations = 0, ttsChars = 0;
  try {
    [narrations, ttsChars] = await Promise.all([getDaily('narrations'), getDaily('tts')]);
  } catch (e) {
    console.error('[status] counter read failed', e.message);
  }
  res.setHeader('cache-control', 'no-store');
  res.json({
    configured,
    gemini: configured.GEMINI_API_KEY,
    elevenlabs: configured.ELEVENLABS_API_KEY,
    passcodeRequired: configured.DEMO_PASSCODE,
    passcodeOk: passcodeOk(req),
    today: { narrations, ttsChars },
    limits: { narrations: DAILY_NARRATION_LIMIT, ttsChars: DAILY_TTS_CHAR_LIMIT },
  });
}
