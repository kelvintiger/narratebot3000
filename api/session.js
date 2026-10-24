// POST /api/session { passcode }                       -> owner session (our keys), throttled 5 / 15 min per IP
// POST /api/session { geminiKey, elevenLabsKey? }      -> visitor session holding their own keys, 10 / 15 min per IP
// DELETE /api/session                                  -> sign out (clears the cookie)
// Keys are kept only inside the encrypted cookie: never stored, echoed back, or logged.
import {
  rejectBadRequest, allowed, clientIp, KEY_RE, ownerAvailable, sessionsAvailable, ownerPasscodeOk,
  setSession, clearSession, fetchWithTimeout,
} from './_lib.js';

const WINDOW_MS = 15 * 60_000;

async function geminiKeyWorks(key) {
  try {
    const r = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }, 5000);
    return r.status === 200;
  } catch (e) {
    console.error(`[session] Gemini key check failed: ${e.name}`);
    return null; // couldn't reach Google
  }
}

export default async function handler(req, res) {
  if (rejectBadRequest(req, res, ['POST', 'DELETE'])) return;
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'DELETE') {
    clearSession(res);
    return res.status(200).json({ access: 'none' });
  }

  // A JSON body forces a CORS preflight for any cross-site script, on top of the origin check.
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json'))
    return res.status(415).json({ error: 'JSON only' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const ip = clientIp(req);

  if ('passcode' in b) {
    if (!ownerAvailable()) return res.status(503).json({ error: 'unavailable' });
    if (!(await allowed('ownerTry', ip, 5, WINDOW_MS))) return res.status(429).json({ error: 'throttled' });
    if (!ownerPasscodeOk(b.passcode)) return res.status(401).json({ error: 'wrong' });
    setSession(res, 'owner');
    return res.status(200).json({ access: 'owner' });
  }

  if ('geminiKey' in b) {
    if (!sessionsAvailable()) return res.status(503).json({ error: 'unavailable' });
    const gemini = typeof b.geminiKey === 'string' ? b.geminiKey.trim() : '';
    const eleven = typeof b.elevenLabsKey === 'string' ? b.elevenLabsKey.trim() : '';
    if (!KEY_RE.test(gemini)) return res.status(400).json({ error: 'key-format', field: 'gemini' });
    if (eleven && !KEY_RE.test(eleven)) return res.status(400).json({ error: 'key-format', field: 'elevenlabs' });
    if (!(await allowed('byokTry', ip, 10, WINDOW_MS))) return res.status(429).json({ error: 'throttled' });
    const works = await geminiKeyWorks(gemini);
    if (works === null) return res.status(502).json({ error: 'gemini-unreachable' });
    if (!works) return res.status(400).json({ error: 'gemini-invalid' });
    setSession(res, 'byok', { gemini, eleven });
    return res.status(200).json({ access: 'byok', elevenlabs: Boolean(eleven) });
  }

  return res.status(400).json({ error: 'Expected passcode or geminiKey' });
}
