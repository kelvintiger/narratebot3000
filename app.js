'use strict';
// NarrateBot 3000: webcam -> /api/narrate (Gemini) -> /api/speak (ElevenLabs) or browser speech.

// ---------- Config (tweak here) ----------
const CONFIG = {
  intervalMs: 7000, // capture cadence while idle
  pumpkinCooldownMs: 8000, // minimum gap between pumpkin lines
  captureWidth: 1024,
  jpegQuality: 0.75,
  apiTimeoutMs: 8500,
  minCaptureGapMs: 3000, // look-ahead never captures sooner than this after the previous capture
  minSegmentChars: 25, // shorter sentences ride along with the next one
  maxSegments: 4, // voice requests per line
  music: { volume: 0.08, ducked: 0.02, fadeSec: 1, trim: { documentary: 1, funny: 0.85, pumpkin: 0.6 } }, // tracks master near -12 dBFS RMS
  tracks: { documentary: 'documentary.mp3', funny: 'funny.mp3', pumpkin: 'spooky.mp3' },
};
const MODES = ['documentary', 'funny', 'descriptive', 'pumpkin'];
const SITE_LANGS = {
  en: { name: 'English', code: 'en', bcp: 'en-US', html: 'en' },
  es: { name: 'Spanish', code: 'es', bcp: 'es-ES', html: 'es' },
  zh: { name: 'Chinese (Simplified)', code: 'zh', bcp: 'zh-CN', html: 'zh-Hans' },
};
const NARR_LANGS = [
  { name: 'English', code: 'en', bcp: 'en-US', label: 'English' },
  { name: 'Spanish', code: 'es', bcp: 'es-ES', label: 'Español' },
  { name: 'Chinese (Simplified)', code: 'zh', bcp: 'zh-CN', label: '中文' },
  { name: 'Hindi', code: 'hi', bcp: 'hi-IN', label: 'हिन्दी' },
  { name: 'Telugu', code: 'te', bcp: 'te-IN', label: 'తెలుగు' },
  { name: 'French', code: 'fr', bcp: 'fr-FR', label: 'Français' },
  { name: 'Arabic', code: 'ar', bcp: 'ar-SA', label: 'العربية' },
  { name: 'Korean', code: 'ko', bcp: 'ko-KR', label: '한국어' },
  { name: 'Japanese', code: 'ja', bcp: 'ja-JP', label: '日本語' },
  { name: 'Portuguese', code: 'pt', bcp: 'pt-BR', label: 'Português' },
];
const NO_CHANGE = { en: 'No change.', es: 'Sin cambios.', zh: '没有变化。', hi: 'कोई बदलाव नहीं।', te: 'మార్పు లేదు.', fr: 'Aucun changement.', ar: 'لا تغيير.', ko: '변화 없음.', ja: '変化はありません。', pt: 'Sem mudanças.' };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(k, d) { try { const v = localStorage.getItem('nb3k:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nb3k:' + k, JSON.stringify(v)); } catch {} },
};

// ---------- State ----------
const params = new URLSearchParams(location.search);
const urlView = params.get('view');
const S = {
  siteLang: store.get('lang', null) || ((navigator.language || '').match(/^(en|es|zh)/)?.[1] ?? 'en'),
  view: urlView === 'clean' || urlView === 'info' ? urlView : store.get('view', 'info'),
  theme: store.get('theme', null), // null = follow the system
  settings: { useEleven: false, still: 8, textScale: 1, customLang: '', srMute: false, hideVideo: false, music: 100, ...store.get('settings', {}) },
  mode: 'documentary', narrLangCode: store.get('narrLang', null),
  started: false, paused: false, busy: false, speaking: false, gen: 0,
  lines: [], obs: 0, stillCount: 0, forcedStill: false, lastDiff: null, prevTiny: null,
  nextAt: 0, forceFull: true, saidNoChange: false, lastCaptureAt: 0, ahead: null,
  facing: 'user', userFlipped: false, stream: null,
  status: null, budgetHit: false, charsSession: 0, ttsToday: null,
  startTime: 0, specimen: 1 + Math.floor(Math.random() * 999),
  passcode: store.get('passcode', ''),
  pumpkinStill: 0, pumpkinChanged: true, lastSpokeAt: 0, lastFallback: '',
};
if (urlView) store.set('view', S.view);
S.mode = S.view === 'clean' ? 'descriptive' : 'documentary';

const video = $('#cam');
const voiceEl = $('#voice');
const voiceEls = [voiceEl, $('#voice2')]; // alternate: one plays while the other loads the next sentence
const otherVoice = (el) => (el === voiceEls[0] ? voiceEls[1] : voiceEls[0]);
S.voice = voiceEls[1]; // the element that played last; the first sentence goes on #voice
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const calm = () => S.view === 'clean' || motionQuery.matches;

// ---------- i18n ----------
const pick = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function t(path, vars) {
  let s = pick(I18N[S.siteLang], path) ?? pick(I18N.en, path) ?? '';
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  return s;
}
const modeName = (m) => t((S.view === 'clean' ? 'modeClean.' : 'mode.') + m);
const narrLangs = () => (S.settings.customLang.trim() ? [...NARR_LANGS, { name: S.settings.customLang.trim(), code: 'xx', label: S.settings.customLang.trim() }] : NARR_LANGS);
const narrLang = () => narrLangs().find((l) => l.code === (S.narrLangCode || S.siteLang)) || NARR_LANGS.find((l) => l.code === S.siteLang);
const showLangLabel = () => S.mode === 'descriptive' || narrLang().code !== S.siteLang;
const htmlLang = (code) => (code === 'zh' ? 'zh-Hans' : code === 'xx' ? '' : code);

function render() {
  const html = document.documentElement;
  html.lang = SITE_LANGS[S.siteLang].html;
  const dark = S.theme ? S.theme === 'dark' : darkQuery.matches;
  html.dataset.theme = dark ? 'dark' : 'light';
  document.body.dataset.view = S.view;
  document.body.dataset.mode = S.mode;
  document.body.toggleAttribute('data-calm', calm());
  document.body.classList.toggle('no-video', S.settings.hideVideo);
  document.body.classList.toggle('mirror', S.facing === 'user');
  html.style.setProperty('--text-scale', S.settings.textScale);

  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $$('[data-mode-label]').forEach((el) => (el.textContent = modeName(el.dataset.modeLabel)));
  $$('[data-action=site-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === S.siteLang));
  $$('[data-action=mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));

  $('.theme-icon').textContent = dark ? '☀' : '☾';
  $('.theme-label').textContent = dark ? t('btn.themeLight') : t('btn.themeDark');
  $('#view-btn').textContent = S.view === 'clean' ? t('btn.infomercial') : t('btn.accessible');
  $('.pause-lbl').textContent = S.paused ? t('btn.play') : t('btn.pause');
  $('.pause-icon').textContent = S.paused ? '▶' : '❚❚';
  $('#pause-btn').setAttribute('aria-pressed', S.paused);
  const sel = $('#narr-lang'), sig = narrLangs().map((l) => l.code + l.label).join();
  if (sel.dataset.sig !== sig) { // rebuild only when the list changes, so an open picker isn't reset
    sel.replaceChildren(...narrLangs().map((l) => Object.assign(new Option(l.label, l.code), { lang: htmlLang(l.code) })));
    sel.dataset.sig = sig;
  }
  sel.value = narrLang().code;

  const tick = t('ticker').join('     ★     ');
  $('.ticker-track').textContent = `${tick}     ★     ${tick}     ★     `;
  $('#hotkey-list').innerHTML = t('hotkeys').map(([k, d]) => `<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`).join('');

  $('#opt-eleven').checked = S.settings.useEleven;
  $('#opt-srmute').checked = S.settings.srMute;
  $('#opt-hidevideo').checked = S.settings.hideVideo;
  $('#opt-still').value = S.settings.still;
  $('#opt-music').value = S.settings.music;
  $('#music-level').textContent = S.settings.music + '%';
  $('#opt-customlang').value = S.settings.customLang;
  $('#text-size').textContent = Math.round(S.settings.textScale * 100) + '%';
  renderStatus();
  updateHud();
}

function saveSettings() { store.set('settings', S.settings); }

// ---------- LCD start-screen number ----------
function buildLcd() {
  $$('[data-lcd]').forEach((el) => {
    const s = el.dataset.lcd;
    el.innerHTML = `<span class="ghost" aria-hidden="true">${'~'.repeat(s.length)}</span><span class="lit">${[...s]
      .map((c) => `<span style="animation-delay:${(Math.random() * 0.9).toFixed(2)}s">${c}</span>`)
      .join('')}</span>`;
  });
}

// ---------- Status, passcode, counters ----------
async function refreshStatus() {
  try {
    const r = await fetch('/api/status', { headers: S.passcode ? { 'x-demo-passcode': S.passcode } : {}, signal: AbortSignal.timeout(5000) });
    S.status = r.ok ? await r.json() : null;
  } catch (e) {
    console.warn('[status] unavailable', e.message);
    S.status = null;
  }
  if (S.status?.passcodeRequired && !S.status.passcodeOk) askPasscode(Boolean(S.passcode));
  renderStatus();
  return S.status;
}

const REQUIRED_VARS = new Set(['GEMINI_API_KEY', 'ELEVENLABS_API_KEY']); // everything else has a default

function renderStatus() {
  const st = S.status;
  $('#chars-session').textContent = S.charsSession;
  $('#chars-today').textContent = st ? `${S.ttsToday ?? st.today.ttsChars} / ${st.limits.ttsChars}` : '–';
  $('#narr-today').textContent = st ? `${st.today.narrations} / ${st.limits.narrations}` : '–';
  $('#config-list').innerHTML = st
    ? Object.entries(st.configured).map(([k, v]) => {
        const label = v ? '✓ ' + t('set.yes') : REQUIRED_VARS.has(k) ? '✗ ' + t('set.no') : '– ' + t('set.dflt');
        return `<li class="${v || !REQUIRED_VARS.has(k) ? 'ok' : 'missing'}"><code>${k}</code> <span>${label}</span></li>`;
      }).join('')
    : '<li class="missing">/api/status ✗</li>';
}

function askPasscode(wrong) {
  const d = $('#passcode');
  $('#pass-error').hidden = !wrong;
  if (!d.open) d.showModal();
}
$('#pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  S.passcode = $('#pass-input').value.trim();
  store.set('passcode', S.passcode);
  const st = await refreshStatus();
  if (!st || st.passcodeOk) $('#passcode').close();
});

function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(S.passcode && { 'x-demo-passcode': S.passcode }) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONFIG.apiTimeoutMs),
  }).then((r) => {
    if (r.status === 401) askPasscode(true);
    return r;
  });
}

// ---------- Audio: music (Web Audio gain, so ducking works on iOS) + narration voice ----------
let ctx = null, analyser = null;
const music = {};
let voices = [];
const loadVoices = () => (voices = window.speechSynthesis?.getVoices() || []);
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }

function silentWavUrl() {
  const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

// Must run inside the start tap (iOS): creates/resumes AudioContext and plays every media element once.
function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.connect(ctx.destination);
      for (const el of voiceEls) ctx.createMediaElementSource(el).connect(analyser);
      for (const [mode, file] of Object.entries(CONFIG.tracks)) {
        const el = new Audio(file);
        el.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        ctx.createMediaElementSource(el).connect(g).connect(ctx.destination);
        const m = (music[mode] = { el, g, ok: true, want: false });
        el.addEventListener('error', () => (m.ok = false));
        el.play().then(() => { if (!m.want) el.pause(); }).catch(() => {});
      }
    } catch (e) {
      console.warn('[audio] Web Audio unavailable', e);
    }
  }
  ctx?.resume();
  const silent = silentWavUrl();
  for (const el of voiceEls) { el.src = silent; el.play().catch(() => {}); }
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }
}

function setMusic() {
  if (!ctx) return;
  const want = S.mode === 'descriptive' ? null : S.mode;
  for (const [mode, m] of Object.entries(music)) {
    const base = (CONFIG.music.trim[mode] ?? 1) * (S.settings.music / 100);
    const target = mode === want && m.ok && base > 0 ? base * (S.speaking ? CONFIG.music.ducked : CONFIG.music.volume) : 0;
    m.want = target > 0;
    if (m.want && m.el.paused) m.el.play().catch(() => {});
    m.g.gain.cancelScheduledValues(ctx.currentTime);
    m.g.gain.setTargetAtTime(target, ctx.currentTime, CONFIG.music.fadeSec / 3);
    if (!m.want) setTimeout(() => !m.want && m.el.pause(), CONFIG.music.fadeSec * 1500);
  }
}

function pickVoice(bcp) {
  const norm = (l) => l.replace('_', '-').toLowerCase();
  const want = norm(S.mode === 'documentary' && bcp.startsWith('en') ? 'en-GB' : bcp);
  const prefix = want.split('-')[0];
  return voices.find((v) => norm(v.lang) === want) || voices.find((v) => norm(v.lang).startsWith(prefix)) || null;
}

function speakBrowser(text, lang) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return setTimeout(resolve, 1500 + text.length * 60);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang.bcp || 'en-US';
    const v = pickVoice(u.lang);
    if (v) u.voice = v;
    Object.assign(u, { documentary: { rate: 1, pitch: 0.9 }, funny: { rate: 1.05, pitch: 0.7 }, pumpkin: { rate: 1, pitch: 1.3 } }[S.mode] || { rate: 1.1 });
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    timer = setTimeout(done, 4000 + text.length * 110); // Safari sometimes never fires onend
    u.onend = u.onerror = done;
    S.stopVoice = done;
    speechSynthesis.speak(u);
  });
}

function loadVoice(el, src) { el.preload = 'auto'; el.src = el._src = src; }
function resetVoice(el) { // also aborts the network request
  el.onended = el.onerror = el.onplaying = null;
  el.pause();
  el.removeAttribute('src');
  el._src = '';
  el.load();
}

// Plays el (loading src first unless it's already prefetched). Resolves true when the clip played
// (or was interrupted), false on a load/playback error. onStart fires once, when audio starts.
function playVoice(el, src, onStart) {
  return new Promise((resolve) => {
    let started = false;
    const done = (ok) => { clearTimeout(t1); clearTimeout(t2); el.onended = el.onerror = el.onplaying = null; el.pause(); resolve(ok); };
    // A stalled stream never fires ended/error: give up if it hasn't started in 9s, and cap a sentence at 30s.
    const t1 = setTimeout(() => el.paused && done(false), 9000);
    const t2 = setTimeout(() => done(true), 30000);
    S.stopVoice = () => done(true);
    S.voice = el;
    el.onended = () => done(true);
    el.onerror = () => done(false);
    el.onplaying = () => { clearTimeout(t1); if (!started) (started = true), onStart?.(); };
    if (src) loadVoice(el, src);
    if (el.error) return done(false); // a prefetch that already failed
    el.play().catch(() => done(false));
  });
}

// Split a line into at most maxSegments sentence groups, each at least minSegmentChars long.
function sentences(text, code) {
  let parts;
  try {
    parts = [...new Intl.Segmenter(code === 'xx' ? undefined : code, { granularity: 'sentence' }).segment(text)].map((p) => p.segment);
  } catch {
    parts = [];
    let at = 0;
    for (const m of text.matchAll(/[.!?…]+["'”’)]*\s+|[。！？]+[」』”’]*\s*/g)) parts.push(text.slice(at, (at = m.index + m[0].length)));
    if (at < text.length) parts.push(text.slice(at));
  }
  const out = [];
  let buf = '';
  // A CJK character takes about as long to say as 3 Latin letters, so weight it when measuring a sentence.
  const spoken = (str) => str.trim().length + 2 * (str.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  for (const p of parts) if (spoken((buf += p)) >= CONFIG.minSegmentChars) out.push(buf), (buf = '');
  if (buf) out.length ? (out[out.length - 1] += buf) : out.push(buf);
  const n = CONFIG.maxSegments;
  return out.length > n ? [...out.slice(0, n - 1), out.slice(n - 1).join('')] : out;
}

const streamEleven = () => S.settings.useEleven && S.status?.elevenlabs && !S.budgetHit && !S.status.passcodeRequired && !S.settings.srMute;
function segSrc(line, i) {
  // The first sentence is on the critical path and stitching adds ~0.5-1s to ElevenLabs' first byte, so only
  // later sentences (prefetched while the previous one plays) carry previous/next text.
  const seg = line.segs, prev = seg.slice(0, i).join('').trim(), next = i ? seg.slice(i + 1).join('').trim() : '';
  return '/api/speak?' + new URLSearchParams({ text: seg[i].trim(), mode: line.mode, lang: line.lang.code, ...(prev && { prev }), ...(next && { next }) });
}

// Start loading the first sentence of a look-ahead line on the idle element, without playing it.
function prefetchLine(line) {
  if (!streamEleven()) return;
  line.segs = sentences(line.text, line.lang.code);
  const el = otherVoice(S.voice);
  if (!el.paused) return;
  loadVoice(el, segSrc(line, 0));
  line.pre = el;
}

// Returns the text still unspoken ('' when done or interrupted), for the browser voice to finish.
async function speakEleven(line, onLast) {
  const { text, lang } = line;
  if (!S.status?.passcodeRequired) {
    // Stream sentence by sentence: the next sentence loads on the other element while this one plays.
    const segs = (line.segs ||= sentences(text, lang.code));
    let el = line.pre || otherVoice(S.voice);
    for (let i = 0; i < segs.length; i++) {
      const next = otherVoice(el), src = segSrc(line, i), last = i === segs.length - 1;
      S.charsSession += segs[i].trim().length;
      renderStatus();
      const ok = await playVoice(el, el._src === src ? null : src, () => (last ? onLast() : loadVoice(next, segSrc(line, i + 1))));
      if (line.gen !== S.gen) return '';
      if (!ok) {
        if (!last) resetVoice(next);
        refreshStatus().then((st) => { if (st && st.today.ttsChars >= st.limits.ttsChars) S.budgetHit = true; });
        return segs.slice(i).join('').trim();
      }
      el = next;
    }
    return '';
  }
  // ponytail: an <audio> GET can't send the passcode header, so passcode demos keep the whole-line POST + blob download.
  try {
    const r = await api('/api/speak', { text, mode: line.mode, language: lang.code });
    const today = r.headers.get('x-tts-today');
    if (today) S.ttsToday = Number(today);
    if (r.status === 429) {
      if ((await r.json().catch(() => ({}))).budget) S.budgetHit = true;
      return text;
    }
    if (!r.ok) return text;
    const url = URL.createObjectURL(await r.blob());
    if (line.gen !== S.gen) return '';
    S.charsSession += text.length;
    renderStatus();
    await playVoice(otherVoice(S.voice), url, onLast);
    URL.revokeObjectURL(url);
    return '';
  } catch (e) {
    console.warn('[speak]', e.message);
    return text;
  }
}

// onLast fires once, when the line's final sentence starts: the cue to prepare the next line.
async function speak(line, onLast) {
  let cued = false;
  const cue = () => { if (!cued) (cued = true), onLast?.(); };
  if (line.pre && !streamEleven()) resetVoice(line.pre);
  S.speaking = true;
  setMusic();
  try {
    if (S.settings.srMute) return cue(), await new Promise((r) => { S.stopVoice = r; setTimeout(r, Math.max(2500, line.text.length * 60)); });
    let rest = line.text;
    if (S.settings.useEleven && S.status?.elevenlabs && !S.budgetHit) rest = await speakEleven(line, cue);
    if (rest && line.gen === S.gen) cue(), await speakBrowser(rest, line.lang);
  } finally {
    S.speaking = false;
    S.lastSpokeAt = Date.now();
    setMusic();
  }
}

function stopSpeech() {
  S.stopVoice?.();
  voiceEls.forEach(resetVoice);
  window.speechSynthesis?.cancel();
}

// ---------- Camera + frames ----------
async function startCamera() {
  S.stream?.getTracks().forEach((tr) => tr.stop());
  S.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: S.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = S.stream;
  await video.play().catch(() => {});
  S.prevTiny = null;
  render();
}

const capCanvas = document.createElement('canvas');
const tiny = Object.assign(document.createElement('canvas'), { width: 32, height: 24 });
const tctx = tiny.getContext('2d', { willReadFrequently: true });

// Mean absolute grayscale difference (0-255) against the previous tiny frame.
function frameDiff() {
  if (!video.videoWidth) return null;
  tctx.drawImage(video, 0, 0, 32, 24);
  const d = tctx.getImageData(0, 0, 32, 24).data;
  const g = new Uint8Array(768);
  for (let i = 0; i < 768; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  const prev = S.prevTiny;
  S.prevTiny = g;
  if (!prev) return null;
  let sum = 0;
  for (let i = 0; i < 768; i++) sum += Math.abs(g[i] - prev[i]);
  return sum / 768;
}

function updateStill(d) {
  if (S.forcedStill) S.stillCount = Math.max(2, S.stillCount + 1);
  else S.stillCount = d !== null && d < S.settings.still ? S.stillCount + 1 : 0;
}

function grabJpeg() {
  const w = Math.min(CONFIG.captureWidth, video.videoWidth);
  const h = Math.round((video.videoHeight * w) / video.videoWidth);
  capCanvas.width = w;
  capCanvas.height = h;
  capCanvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return capCanvas.toDataURL('image/jpeg', CONFIG.jpegQuality).split(',')[1];
}

// ---------- Narration ----------
function fallbackLine(mode, lang) {
  const key = (mode === 'documentary' || mode === 'funny') && S.stillCount >= 1 ? mode + 'Still' : mode;
  const pack = I18N[lang.code] || I18N[S.siteLang];
  const list = pack.fallback[key].filter((l) => l !== S.lastFallback);
  return (S.lastFallback = list[Math.floor(Math.random() * list.length)]);
}

const tidy = (s) => String(s || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').replace(/^["“”]+|["“”]+$/g, '').trim().slice(0, 300);

// Capture a frame and ask for a line. Returns { gen, mode, lang, text, english }, { gen, unchanged }, or null.
// ahead: a look-ahead request made while the previous line is still playing, so nothing on screen changes.
async function fetchLine({ force = false, skipDiff = false, arrival = false, ahead = false } = {}) {
  if (S.busy || !video.videoWidth) return null;
  const gen = S.gen, mode = S.mode, lang = narrLang();
  if (!skipDiff) {
    S.lastDiff = frameDiff();
    updateStill(S.lastDiff);
  }
  S.nextAt = Date.now() + CONFIG.intervalMs;
  S.lastCaptureAt = Date.now();
  const full = force || S.forceFull;
  S.forceFull = false;

  if (mode === 'descriptive' && !full && S.stillCount >= 2) return { gen, unchanged: true };
  if (!ahead) showUnchanged(false), setStatus(t('waiting.' + mode));

  S.busy = true;
  S.obs++;
  let result = null;
  try {
    const r = await api('/api/narrate', {
      image: grabJpeg(), mode, language: lang.name, lastLines: S.lines.slice(-4),
      stillCount: mode === 'descriptive' ? 0 : S.stillCount, observationNumber: S.obs,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    result = await r.json();
  } catch (e) {
    console.warn('[narrate] using fallback:', e.message);
  }
  if (gen !== S.gen) return null; // mode/language switched mid-request
  S.busy = false;
  setStatus('');

  let text, english = '';
  if (!result) {
    if (mode === 'pumpkin' && !arrival) return null;
    text = fallbackLine(mode, lang);
  } else {
    if (mode === 'pumpkin' && result.person_close === false) return null;
    text = result.narration ?? result.line ?? result.text;
    english = result.english || '';
  }
  if (result && mode === 'descriptive') {
    if (result.changed === false && !full) {
      if (S.saidNoChange) return { gen, unchanged: true };
      S.saidNoChange = true;
      text = NO_CHANGE[lang.code] || NO_CHANGE.en;
      english = '';
    } else S.saidNoChange = false;
  }
  text = tidy(text);
  return text ? { gen, mode, lang, text, english: tidy(english) } : null;
}

// Fetch the next line while this one plays. Its first sentence's audio can only start loading once the
// current line's last sentence is playing (the idle element is busy with this line's next sentence until then).
function startLookahead(gen) {
  if (gen !== S.gen || S.ahead || S.paused || S.mode === 'pumpkin') return;
  const ahead = (S.ahead = { gen, done: false, armed: false });
  ahead.p = sleep(Math.max(0, S.lastCaptureAt + CONFIG.minCaptureGapMs - Date.now()))
    .then(() => (gen === S.gen ? fetchLine({ ahead: true }) : null))
    .then((line) => {
      ahead.done = true;
      ahead.line = line;
      if (ahead.armed && line?.text && line.gen === S.gen) prefetchLine(line);
      return line;
    });
}

// Called when the current line's last sentence starts: the idle element is free for the next line's audio.
function armLookahead(gen) {
  startLookahead(gen);
  const ahead = S.ahead;
  if (!ahead || ahead.armed) return;
  ahead.armed = true;
  if (ahead.line?.text && ahead.line.gen === S.gen) prefetchLine(ahead.line);
}

// Show + speak a line, then follow straight on with the look-ahead line if one was prepared.
async function playLine(line) {
  const gen = line.gen;
  while (line && line.gen === S.gen) {
    if (line.unchanged) { showUnchanged(true); break; }
    showUnchanged(false);
    S.lines = [...S.lines, line.text].slice(-8);
    showLine(line.text, line.english, line.lang);
    if (line.mode === 'funny' && S.stillCount >= 2) nowShowing(line.text);
    // Comedy modes start the next line as this one begins, so it's ready in time; Descriptive waits for the
    // last sentence so a blind user hears the scene as it is now, not as it was a whole line ago.
    if (line.mode !== 'descriptive') startLookahead(gen);
    await speak(line, () => armLookahead(gen));
    const ahead = S.ahead;
    if (gen !== S.gen || !ahead) break;
    if (!ahead.done) setStatus(t('waiting.' + line.mode));
    line = await ahead.p;
    if (S.ahead === ahead) S.ahead = null;
  }
  if (gen === S.gen) S.nextAt = Math.max(S.nextAt, Date.now()); // cadence stays ~7s from the previous capture start
}

async function narrate(opts) {
  const line = await fetchLine(opts);
  if (line) await playLine(line);
}

function pumpkinTick() {
  const d = frameDiff();
  S.lastDiff = d;
  if (d === null) return;
  const still = d < S.settings.still;
  const arrival = !still && S.pumpkinStill >= 3 && d > S.settings.still * 2; // still, then a big change: someone walked up
  S.pumpkinStill = still ? S.pumpkinStill + 1 : 0;
  if (!still) S.pumpkinChanged = true;
  if (Date.now() - S.lastSpokeAt < CONFIG.pumpkinCooldownMs) return;
  if (arrival || S.forceFull || (S.pumpkinChanged && Date.now() >= S.nextAt)) {
    S.pumpkinChanged = false;
    narrate({ skipDiff: true, arrival: arrival || S.forceFull });
  }
}

let ticks = 0;
setInterval(() => {
  if (++ticks % 4 === 0) updateHud();
  if (!S.started || S.paused || S.busy || S.speaking || S.ahead || !video.videoWidth) return;
  if (S.mode === 'pumpkin') { if (ticks % 4 === 0) pumpkinTick(); } // pumpkin's stillness counts assume a 1s tick
  else if (Date.now() >= S.nextAt) narrate();
}, 250);

// ---------- On-screen output ----------
function setStatus(s) { $('#status').textContent = s; }
function showUnchanged(on) { $('#unchanged').hidden = !on; }

function words(text, lang) {
  if (window.Intl?.Segmenter) return [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].map((s) => s.segment);
  return text.split(/(\s+)/);
}

function showLine(text, english, lang) {
  const main = $('#sub-main');
  const code = htmlLang(lang.code);
  main.lang = code;
  main.dir = lang.code === 'ar' ? 'rtl' : 'auto';
  main.classList.remove('pop');
  if (S.mode === 'documentary' && !calm()) {
    main.innerHTML = '';
    words(text, code || 'en').forEach((w, i) => {
      const s = document.createElement('span');
      s.textContent = w;
      s.style.animationDelay = i * 70 + 'ms';
      main.append(s);
    });
  } else main.textContent = text;
  if (S.mode === 'funny' && !calm()) {
    void main.offsetWidth; // restart animation
    main.classList.add('pop');
    const z = $('.zoomwrap');
    z.classList.remove('punch');
    void z.offsetWidth;
    z.classList.add('punch');
  }
  const showTrans = S.siteLang === 'en' && lang.code !== 'en' && english && english !== text;
  $('#sub-trans').textContent = showTrans ? english : '';
  $('#subs').classList.add('on');
  const live = $('#live');
  live.lang = code;
  live.textContent = text;
}

function clearSubs() {
  $('#sub-main').textContent = '';
  $('#sub-trans').textContent = '';
  $('#subs').classList.remove('on');
  showUnchanged(false);
}

let cardTimers = [];
function titleCard() {
  const card = $('#card');
  cardTimers.forEach(clearTimeout);
  const extra = showLangLabel() ? narrLang().label : '';
  $('#announce').textContent = modeName(S.mode) + (extra ? ` – ${narrLang().name}` : '');
  $('.card-sub').textContent = extra;
  if (calm()) {
    card.className = 'card plain';
    $('.card-banner').textContent = '';
    $('.card-title').textContent = modeName(S.mode);
    card.hidden = false;
    cardTimers = [setTimeout(() => (card.hidden = true), 1500)];
    return;
  }
  card.className = 'card info';
  $('.card-banner').textContent = t('butWait');
  $('.card-title').textContent = t('nowWith', { mode: t('mode.' + S.mode) });
  card.hidden = false;
  cardTimers = [setTimeout(() => card.classList.add('phase2'), 800), setTimeout(() => (card.hidden = true), 1800)];
}

function nowShowing(text) {
  if (calm()) return;
  const zh = text.match(/《([^》]+)》/);
  const caps = (text.match(/[A-ZÁÉÍÓÚÑÜ0-9][A-ZÁÉÍÓÚÑÜ0-9:'’&!-]*(?:\s+[A-ZÁÉÍÓÚÑÜ0-9][A-ZÁÉÍÓÚÑÜ0-9:'’&!-]*)*/g) || [])
    .filter((c) => c.length >= 6 && /[A-ZÁÉÍÓÚÑÜ]{2}/.test(c))
    .sort((a, b) => b.length - a.length)[0];
  const title = zh?.[1] || caps;
  if (!title) return;
  const el = $('#nowshowing');
  $('.ns-title').textContent = title.replace(/[.,!]+$/, '');
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 2400);
}

function updateHud() {
  if (!S.started) return;
  const s = Math.floor((Date.now() - S.startTime) / 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  $('#fieldlog').textContent = `${t('specimen')} #${String(S.specimen).padStart(3, '0')} · ${t('observation')} ${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
  $('#herd').hidden = !(S.mode === 'documentary' && S.stillCount >= 1);
  $('#mode-label').textContent = modeName(S.mode) + (S.paused ? ` · ${t('paused')}` : '');
  $('#lang-label').textContent = showLangLabel() ? narrLang().label : '';
  $('#still-debug').textContent = `${S.stillCount}${S.forcedStill ? ' (S)' : ''} / ${S.lastDiff === null ? '–' : S.lastDiff.toFixed(1)}`;
}

// ---------- Pumpkin glow ----------
const pk = $('#pumpkin');
const pkData = new Uint8Array(512);
let flick = 0.3, lastFlick = 0;
function pumpkinFrame(now) {
  if (S.started && S.mode === 'pumpkin') {
    let glow, mouth = 1;
    if (S.speaking && voiceEls.some((el) => !el.paused) && analyser) {
      analyser.getByteTimeDomainData(pkData);
      let sum = 0;
      for (const v of pkData) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / pkData.length);
      glow = Math.min(1, 0.55 + rms * 3);
      mouth = 1 + Math.min(0.12, rms * 0.6);
    } else if (S.speaking) {
      glow = 0.6 + Math.random() * 0.4; // browser speech can't be analysed: fake it
      mouth = 1 + Math.random() * 0.06;
    } else {
      if (now - lastFlick > 90) {
        flick = Math.min(0.42, Math.max(0.16, flick + (Math.random() - 0.5) * 0.09));
        lastFlick = now;
      }
      glow = flick;
    }
    if (calm()) [glow, mouth] = [S.speaking ? 0.9 : 0.35, 1];
    pk.style.setProperty('--glow', glow.toFixed(3));
    pk.style.setProperty('--mouth', mouth.toFixed(3));
  }
  requestAnimationFrame(pumpkinFrame);
}
requestAnimationFrame(pumpkinFrame);

// ---------- Actions ----------
function interrupt() {
  S.gen++;
  S.busy = false;
  S.ahead = null;
  stopSpeech();
  setStatus('');
}

function setMode(m) {
  if (!MODES.includes(m)) return;
  S.mode = m;
  interrupt();
  // nextAt = now: the first capture runs while the title card is still up.
  Object.assign(S, { lines: [], forceFull: true, saidNoChange: false, pumpkinChanged: true, nextAt: Date.now() });
  if (isPhone && !S.userFlipped && S.started) {
    const want = m === 'descriptive' ? 'environment' : 'user';
    if (want !== S.facing) { S.facing = want; startCamera().catch((e) => console.error('[camera]', e)); }
  }
  render();
  setMusic();
  clearSubs();
  if (S.started) titleCard();
}

function setSiteLang(l) {
  if (!SITE_LANGS[l]) return;
  S.siteLang = l;
  store.set('lang', l);
  S.narrLangCode = l;
  store.set('narrLang', l);
  if (S.started) {
    interrupt();
    Object.assign(S, { lines: [], forceFull: true, nextAt: Date.now() + 800 });
    clearSubs();
  }
  render();
}

function setNarrLang(code) {
  if (!narrLangs().some((l) => l.code === code)) return;
  S.narrLangCode = code;
  store.set('narrLang', code);
  interrupt();
  Object.assign(S, { lines: [], forceFull: true, saidNoChange: false, pumpkinChanged: true, nextAt: Date.now() });
  clearSubs();
  render();
  if (S.started) titleCard();
}

function cycleNarrLang() {
  if (!S.started) return;
  const list = narrLangs();
  setNarrLang(list[(list.indexOf(narrLang()) + 1) % list.length].code);
}

function togglePause() {
  S.paused = !S.paused;
  if (S.paused) interrupt();
  else S.nextAt = Date.now() + 300;
  render();
}

function toggleTheme() {
  S.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store.set('theme', S.theme);
  render();
}

function toggleView() {
  S.view = S.view === 'clean' ? 'info' : 'clean';
  store.set('view', S.view);
  const u = new URL(location.href);
  S.view === 'clean' ? u.searchParams.set('view', 'clean') : u.searchParams.delete('view');
  history.replaceState(null, '', u);
  if (S.view === 'clean' && S.mode !== 'descriptive') setMode('descriptive');
  else render();
}

function toggleStill() {
  S.forcedStill = !S.forcedStill;
  S.stillCount = S.forcedStill ? 2 : 0;
  updateHud();
}

function narrateNow() {
  if (!S.started) return;
  interrupt();
  S.paused = false;
  S.forceFull = true;
  render();
  narrate({ force: true, arrival: true });
}

async function flipCamera() {
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  S.userFlipped = true;
  try { await startCamera(); } catch (e) { console.error('[camera] flip failed', e); }
}

function toggleSettings() {
  const d = $('#settings');
  if (d.open) return d.close();
  refreshStatus();
  d.showModal();
}

async function wakeLock() {
  try { S.wake = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S.started && wakeLock());

async function start() {
  if (S.started) return;
  unlockAudio(); // synchronously inside the tap, before any await
  S.facing = isPhone && S.mode === 'descriptive' ? 'environment' : 'user';
  try {
    await startCamera();
  } catch (e) {
    console.error('[camera]', e);
    $('.cam-error').hidden = false;
    return;
  }
  S.started = true;
  S.startTime = Date.now();
  S.forceFull = true;
  S.nextAt = Date.now(); // first capture runs under the title card
  $('#start').hidden = true;
  $('#stage').hidden = false;
  document.body.classList.add('running');
  wakeLock();
  setMusic();
  render();
  titleCard();
  poke();
  $('#controls [data-action=narrate]').focus({ preventScroll: true });
}

// ---------- Input ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  if (e.detail > 0 && b.dataset.action !== 'start') b.blur(); // mouse/touch: keep Space free for pause
  ({
    start,
    mode: () => setMode(b.dataset.mode),
    'site-lang': () => setSiteLang(b.dataset.lang),
    theme: toggleTheme,
    view: toggleView,
    narrate: narrateNow,
    pause: togglePause,
    flip: flipCamera,
    settings: toggleSettings,
    'text-smaller': () => { S.settings.textScale = Math.max(0.8, +(S.settings.textScale - 0.1).toFixed(1)); saveSettings(); render(); },
    'text-larger': () => { S.settings.textScale = Math.min(2, +(S.settings.textScale + 0.1).toFixed(1)); saveSettings(); render(); },
  })[b.dataset.action]?.();
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (k === 'k') return e.preventDefault(), toggleSettings();
  if ($('dialog[open]')) return;
  if (k === ' ') {
    if (e.target.closest?.('button, a') || !S.started) return;
    e.preventDefault();
    return togglePause();
  }
  const actions = { 1: () => setMode('documentary'), 2: () => setMode('funny'), 3: () => setMode('descriptive'), 4: () => setMode('pumpkin'), l: cycleNarrLang, n: narrateNow, s: toggleStill, t: toggleTheme, a: toggleView };
  if (actions[k] && (S.started || 'ta'.includes(k))) {
    e.preventDefault();
    actions[k]();
  }
});

const bind = (id, ev, fn) => $(id).addEventListener(ev, fn);
bind('#opt-eleven', 'change', (e) => { S.settings.useEleven = e.target.checked; saveSettings(); });
bind('#opt-srmute', 'change', (e) => { S.settings.srMute = e.target.checked; saveSettings(); });
bind('#opt-hidevideo', 'change', (e) => { S.settings.hideVideo = e.target.checked; saveSettings(); render(); });
bind('#opt-still', 'input', (e) => { S.settings.still = Number(e.target.value); saveSettings(); });
bind('#opt-music', 'input', (e) => { S.settings.music = Number(e.target.value); $('#music-level').textContent = S.settings.music + '%'; saveSettings(); setMusic(); });
bind('#narr-lang', 'change', (e) => setNarrLang(e.target.value));
bind('#opt-customlang', 'change', (e) => { S.settings.customLang = e.target.value.slice(0, 40); saveSettings(); render(); });

// Auto-hide the control bar after a few idle seconds (infomercial view only).
let idleTimer;
function poke() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (S.started && S.view === 'info' && !$('#controls').contains(document.activeElement) && !$('dialog[open]')) document.body.classList.add('idle');
  }, 4000);
}
['pointermove', 'pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, poke, { passive: true }));

// Keep subtitles just above the control bar, however many rows it wraps to.
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--bar-h', Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight) + 'px')).observe($('#controls'));

motionQuery.addEventListener?.('change', render);
darkQuery.addEventListener?.('change', render);

// ---------- Boot ----------
buildLcd();
render();
refreshStatus();
