// Shared helpers for the /api functions: rate limiting, daily counters, sessions, origin checks.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
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
  globalMinute: new Ratelimit({ redis, prefix: 'nb:gm', limiter: Ratelimit.slidingWindow(60, '1 m'), timeout: 0 }), // timeout 0: never allow on an Upstash timeout
  speakMinute: new Ratelimit({ redis, prefix: 'nb:spk', limiter: Ratelimit.slidingWindow(90, '1 m') }), // up to 4 sentence requests per line
  ownerTry: new Ratelimit({ redis, prefix: 'nb:own', limiter: Ratelimit.fixedWindow(5, '15 m'), timeout: 0 }),
  byokTry: new Ratelimit({ redis, prefix: 'nb:byok', limiter: Ratelimit.fixedWindow(10, '15 m') }),
};

export async function allowed(name, key, max, windowMs) {
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

// Vercel sets x-forwarded-for at its edge. IPv6 is grouped by /64, since one home or phone gets a whole /64.
export function clientIp(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  return ip.includes(':') && !ip.startsWith('::ffff:') ? ip.toLowerCase().split(':').slice(0, 4).join(':') + '::/64' : ip;
}

// Returns null when allowed, or a short reason string for a 429. Per-device limits apply to everyone; the
// global per-minute limit and the daily narration cap protect our own Gemini key, so they count owner requests only.
export async function checkNarrationLimits(req, { owner = false } = {}) {
  const ip = clientIp(req);
  if (!(await allowed('ipMinute', ip, 12, 60_000))) return 'Too many narrations this minute';
  if (!(await allowed('ipDay', ip, 150, DAY * 1000))) return 'Daily narration limit reached for this device';
  if (!owner) return null;
  if (!(await allowed('globalMinute', 'global', 60, 60_000))) return 'Narrator is busy, try again shortly';
  if ((await incrDaily('narrations')) > DAILY_NARRATION_LIMIT) return 'Daily narration limit reached';
  return null;
}

export const checkSpeakLimit = (req) => allowed('speakMinute', clientIp(req), 90, 60_000);

// ---- sessions: an AES-256-GCM encrypted cookie, so visitor keys live only in their own browser ----
// Payload { v:1, kind:'owner'|'byok', exp:<ms>, h?:<owner passcode fingerprint>, g?:<Gemini key>, e?:<ElevenLabs key> }.
// __Host- prefix (RFC 6265bis): Secure, Path=/, no Domain, so a sibling *.kelvinct.com site can't plant or shadow it.
export const SESSION_COOKIE = '__Host-nb3k_session';
const SESSION_MAX_AGE = 30 * DAY; // seconds
const COOKIE_ATTRS = 'HttpOnly; Secure; SameSite=Strict; Path=/';
export const KEY_RE = /^[A-Za-z0-9_\-.]{20,200}$/;

// HKDF-SHA256 (RFC 5869) of SESSION_SECRET. null when the secret is missing or short: sessions then fail closed.
function sessionKey() {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return Buffer.from(hkdfSync('sha256', secret, 'narratebot3000', 'nb3k session cookie v1', 32));
}

// Ties owner sessions to the current OWNER_PASSCODE: changing the passcode signs every owner out.
function ownerFingerprint() {
  return env.OWNER_PASSCODE ? createHash('sha256').update('nb3k owner\0' + env.OWNER_PASSCODE).digest('base64url').slice(0, 16) : null;
}

export const ownerAvailable = () => Boolean(env.OWNER_PASSCODE && sessionKey());
export const sessionsAvailable = () => Boolean(sessionKey());

// Constant-time passcode check: both sides are hashed first so the lengths always match.
export function ownerPasscodeOk(given) {
  if (!env.OWNER_PASSCODE || typeof given !== 'string') return false;
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(env.OWNER_PASSCODE));
}

function seal(payload, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64url');
}

function readCookie(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function readSession(req) {
  const key = sessionKey();
  const raw = readCookie(req, SESSION_COOKIE);
  if (!key || !raw || raw.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length < 12 + 16 + 2) return null;
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const p = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8'));
    if (!p || p.v !== 1 || typeof p.exp !== 'number' || p.exp <= Date.now()) return null;
    if (p.kind === 'owner') return p.h && p.h === ownerFingerprint() ? p : null;
    if (p.kind !== 'byok' || typeof p.g !== 'string' || !KEY_RE.test(p.g)) return null;
    if (p.e !== undefined && (typeof p.e !== 'string' || !KEY_RE.test(p.e))) return null;
    return p;
  } catch {
    return null; // bad base64, wrong key or tampered (auth tag), bad JSON
  }
}

export function getAccess(req) {
  const s = readSession(req);
  if (!s) return { mode: 'none' };
  if (s.kind === 'owner') return { mode: 'owner' };
  return { mode: 'byok', gemini: s.g, eleven: s.e || null };
}

// kind 'owner' or { gemini, eleven? } for a visitor's own keys. Returns false when sessions aren't configured.
export function setSession(res, kind, keys = {}) {
  const key = sessionKey();
  if (!key) return false;
  const payload = { v: 1, kind, exp: Date.now() + SESSION_MAX_AGE * 1000 };
  if (kind === 'owner') payload.h = ownerFingerprint();
  else {
    payload.g = keys.gemini;
    if (keys.eleven) payload.e = keys.eleven;
  }
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${seal(payload, key)}; ${COOKIE_ATTRS}; Max-Age=${SESSION_MAX_AGE}`);
  return true;
}

export function clearSession(res) {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`);
}

// Strip API keys from text before it goes to a log.
export function redact(text, ...secrets) {
  let s = String(text ?? '');
  for (const k of secrets) if (k) s = s.split(k).join('[key]');
  return s.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/\bsk_[0-9A-Za-z]{20,}/g, '[key]');
}

// ---- origin ----
const ORIGINS = [
  /^https:\/\/narratebot3000\.kelvinct\.com$/,
  /^https:\/\/narratebot3000(-[a-z0-9-]+-kelvins-projects-f0005251)?\.vercel\.app$/, // prod alias + this team's previews only
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
];
// ponytail: requests without an Origin header (curl, same-origin GET) pass; rate limits are the real guard.
export function originOk(req) {
  const o = req.headers.origin;
  return !o || ORIGINS.some((re) => re.test(o));
}

// Common guard for the API endpoints (POST unless told otherwise). Returns true if the response was already sent.
export function rejectBadRequest(req, res, methods = ['POST']) {
  res.setHeader('cache-control', 'private, no-store');
  // Fetch Metadata resource isolation: only our own pages may call the API. Requests without the header (curl) pass.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Cross-site request' }), true;
  if (!methods.includes(req.method)) return res.status(405).json({ error: `${methods.join('/')} only` }), true;
  if (!originOk(req)) return res.status(403).json({ error: 'Origin not allowed' }), true;
  return false;
}

export async function fetchWithTimeout(url, opts, ms = 8000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}
