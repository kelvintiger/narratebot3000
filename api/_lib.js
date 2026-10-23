// Shared helpers for the /api functions: rate limiting, daily counters, passcode, origin checks.
import { timingSafeEqual } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const env = process.env;
const redisUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const redisToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
export const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;
if (!redis) console.warn('[narratebot] Upstash credentials missing: using per-instance in-memory rate limits');

export const DAILY_NARRATION_LIMIT = Number(env.DAILY_NARRATION_LIMIT) || 900;
export const DAILY_TTS_CHAR_LIMIT = Number(env.DAILY_TTS_CHAR_LIMIT) || 20000;

const today = () => new Date().toISOString().slice(0, 10); // UTC day
const DAY = 86400;

// ---- limiters: Upstash when configured, otherwise a best-effort in-memory sliding window ----
const mem = new Map();
function memLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (mem.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  mem.set(key, hits);
  return true;
}

const upstash = redis && {
  ipMinute: new Ratelimit({ redis, prefix: 'nb:ipm', limiter: Ratelimit.slidingWindow(12, '1 m') }),
  ipDay: new Ratelimit({ redis, prefix: 'nb:ipd', limiter: Ratelimit.fixedWindow(150, '1 d') }),
  globalMinute: new Ratelimit({ redis, prefix: 'nb:gm', limiter: Ratelimit.slidingWindow(60, '1 m') }),
  speakMinute: new Ratelimit({ redis, prefix: 'nb:spk', limiter: Ratelimit.slidingWindow(30, '1 m') }),
};

async function allowed(name, key, max, windowMs) {
  if (upstash) return (await upstash[name].limit(key)).success;
  return memLimit(`${name}:${key}`, max, windowMs);
}

// Daily counters (narrations, ElevenLabs characters).
export async function incrDaily(name, by = 1) {
  const key = `nb:${name}:${today()}`;
  if (!redis) {
    const v = (mem.get(key) || 0) + by;
    mem.set(key, v);
    return v;
  }
  const v = await redis.incrby(key, by);
  if (v === by) await redis.expire(key, 2 * DAY);
  return v;
}

export async function getDaily(name) {
  const key = `nb:${name}:${today()}`;
  if (!redis) return mem.get(key) || 0;
  return Number(await redis.get(key)) || 0;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

// Returns null when allowed, or a short reason string for a 429.
export async function checkNarrationLimits(req) {
  const ip = clientIp(req);
  if (!(await allowed('ipMinute', ip, 12, 60_000))) return 'Too many narrations this minute';
  if (!(await allowed('ipDay', ip, 150, DAY * 1000))) return 'Daily narration limit reached for this device';
  if (!(await allowed('globalMinute', 'global', 60, 60_000))) return 'Narrator is busy, try again shortly';
  if ((await incrDaily('narrations')) > DAILY_NARRATION_LIMIT) return 'Daily narration limit reached';
  return null;
}

export const checkSpeakLimit = (req) => allowed('speakMinute', clientIp(req), 30, 60_000);

// ---- passcode + origin ----
export function passcodeOk(req) {
  const want = env.DEMO_PASSCODE;
  if (!want) return true;
  const got = Buffer.from(String(req.headers['x-demo-passcode'] || ''));
  const exp = Buffer.from(want);
  return got.length === exp.length && timingSafeEqual(got, exp);
}

const ORIGINS = [
  /^https:\/\/narratebot3000\.kelvinct\.com$/,
  /^https:\/\/narratebot3000[a-z0-9-]*\.vercel\.app$/,
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
];
// ponytail: requests without an Origin header (curl, same-origin GET) pass; rate limits are the real guard.
export function originOk(req) {
  const o = req.headers.origin;
  return !o || ORIGINS.some((re) => re.test(o));
}

// Common guard for the API endpoints (POST unless told otherwise). Returns true if the response was already sent.
export function rejectBadRequest(req, res, methods = ['POST']) {
  if (!methods.includes(req.method)) return res.status(405).json({ error: `${methods.join('/')} only` }), true;
  if (!originOk(req)) return res.status(403).json({ error: 'Origin not allowed' }), true;
  if (!passcodeOk(req)) return res.status(401).json({ error: 'passcode' }), true;
  return false;
}

export async function fetchWithTimeout(url, opts, ms = 8000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}
