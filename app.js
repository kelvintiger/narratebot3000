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
// Every language ElevenLabs Eleven v3 speaks (https://elevenlabs.io/docs/models). One table for the site
// language, the narration language, speech and lang/dir attributes. name: sent to Gemini; native: what people pick;
// bcp: BCP-47 for browser speech; html: the lang attribute when it differs from the code.
const LANGS = [
  ['af', 'Afrikaans', 'Afrikaans', 'af-ZA'], ['ar', 'Arabic', 'العربية', 'ar-SA', 1], ['hy', 'Armenian', 'Հայերեն', 'hy-AM'],
  ['as', 'Assamese', 'অসমীয়া', 'as-IN'], ['ast', 'Asturian', 'Asturianu', 'ast-ES'], ['az', 'Azerbaijani', 'Azərbaycan', 'az-AZ'],
  ['be', 'Belarusian', 'Беларуская', 'be-BY'], ['bn', 'Bengali', 'বাংলা', 'bn-IN'], ['bs', 'Bosnian', 'Bosanski', 'bs-BA'],
  ['bg', 'Bulgarian', 'Български', 'bg-BG'], ['my', 'Burmese', 'မြန်မာ', 'my-MM'], ['yue', 'Cantonese', '粵語', 'yue-HK'],
  ['ca', 'Catalan', 'Català', 'ca-ES'], ['ceb', 'Cebuano', 'Cebuano', 'ceb-PH'], ['ny', 'Chichewa', 'Chichewa', 'ny-MW'],
  ['hr', 'Croatian', 'Hrvatski', 'hr-HR'], ['cs', 'Czech', 'Čeština', 'cs-CZ'], ['da', 'Danish', 'Dansk', 'da-DK'],
  ['nl', 'Dutch', 'Nederlands', 'nl-NL'], ['en', 'English', 'English', 'en-US'], ['et', 'Estonian', 'Eesti', 'et-EE'],
  ['fil', 'Filipino', 'Filipino', 'fil-PH'], ['fi', 'Finnish', 'Suomi', 'fi-FI'], ['fr', 'French', 'Français', 'fr-FR'],
  ['gl', 'Galician', 'Galego', 'gl-ES'], ['ka', 'Georgian', 'ქართული', 'ka-GE'], ['de', 'German', 'Deutsch', 'de-DE'],
  ['el', 'Greek', 'Ελληνικά', 'el-GR'], ['gu', 'Gujarati', 'ગુજરાતી', 'gu-IN'], ['ha', 'Hausa', 'Hausa', 'ha-NG'],
  ['he', 'Hebrew', 'עברית', 'he-IL', 1], ['hi', 'Hindi', 'हिन्दी', 'hi-IN'], ['hu', 'Hungarian', 'Magyar', 'hu-HU'],
  ['is', 'Icelandic', 'Íslenska', 'is-IS'], ['id', 'Indonesian', 'Bahasa Indonesia', 'id-ID'], ['ga', 'Irish', 'Gaeilge', 'ga-IE'],
  ['it', 'Italian', 'Italiano', 'it-IT'], ['ja', 'Japanese', '日本語', 'ja-JP'], ['jv', 'Javanese', 'Basa Jawa', 'jv-ID'],
  ['kn', 'Kannada', 'ಕನ್ನಡ', 'kn-IN'], ['kk', 'Kazakh', 'Қазақ тілі', 'kk-KZ'], ['ky', 'Kirghiz', 'Кыргызча', 'ky-KG'],
  ['ko', 'Korean', '한국어', 'ko-KR'], ['lv', 'Latvian', 'Latviešu', 'lv-LV'], ['ln', 'Lingala', 'Lingála', 'ln-CD'],
  ['lt', 'Lithuanian', 'Lietuvių', 'lt-LT'], ['lb', 'Luxembourgish', 'Lëtzebuergesch', 'lb-LU'], ['mk', 'Macedonian', 'Македонски', 'mk-MK'],
  ['ms', 'Malay', 'Bahasa Melayu', 'ms-MY'], ['ml', 'Malayalam', 'മലയാളം', 'ml-IN'], ['mt', 'Maltese', 'Malti', 'mt-MT'],
  // zh keeps the name Gemini has always been sent, so Chinese narration doesn't drift to Traditional characters
  ['zh', 'Chinese (Simplified)', '中文 (简体)', 'zh-CN', 0, 'zh-Hans'], ['mi', 'Māori', 'Te Reo Māori', 'mi-NZ'], ['mr', 'Marathi', 'मराठी', 'mr-IN'],
  ['mn', 'Mongolian', 'Монгол', 'mn-MN'], ['ne', 'Nepali', 'नेपाली', 'ne-NP'], ['no', 'Norwegian', 'Norsk', 'nb-NO'],
  ['oc', 'Occitan', 'Occitan', 'oc-FR'], ['or', 'Odia', 'ଓଡ଼ିଆ', 'or-IN'], ['ps', 'Pashto', 'پښتو', 'ps-AF', 1],
  ['fa', 'Persian', 'فارسی', 'fa-IR', 1], ['pl', 'Polish', 'Polski', 'pl-PL'], ['pt', 'Portuguese', 'Português', 'pt-BR'],
  ['pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'pa-IN'], ['ro', 'Romanian', 'Română', 'ro-RO'], ['ru', 'Russian', 'Русский', 'ru-RU'],
  ['sr', 'Serbian', 'Српски', 'sr-RS'], ['sd', 'Sindhi', 'سنڌي', 'sd-PK', 1], ['sk', 'Slovak', 'Slovenčina', 'sk-SK'],
  ['sl', 'Slovenian', 'Slovenščina', 'sl-SI'], ['so', 'Somali', 'Soomaali', 'so-SO'], ['es', 'Spanish', 'Español', 'es-ES'],
  ['sw', 'Swahili', 'Kiswahili', 'sw-KE'], ['sv', 'Swedish', 'Svenska', 'sv-SE'], ['tg', 'Tajik', 'Тоҷикӣ', 'tg-TJ'],
  ['ta', 'Tamil', 'தமிழ்', 'ta-IN'], ['te', 'Telugu', 'తెలుగు', 'te-IN'], ['th', 'Thai', 'ไทย', 'th-TH'],
  ['tr', 'Turkish', 'Türkçe', 'tr-TR'], ['uk', 'Ukrainian', 'Українська', 'uk-UA'], ['ur', 'Urdu', 'اردو', 'ur-PK', 1],
  ['uz', 'Uzbek', 'Oʻzbekcha', 'uz-UZ'], ['vi', 'Vietnamese', 'Tiếng Việt', 'vi-VN'], ['cy', 'Welsh', 'Cymraeg', 'cy-GB'],
  ['yo', 'Yoruba', 'Yorùbá', 'yo-NG'],
].map(([code, name, native, bcp, rtl, html]) => ({ code, name, native, label: native, bcp, rtl: !!rtl, html: html || code }));
const LANG = Object.fromEntries(LANGS.map((l) => [l.code, l]));
const NO_CHANGE = { en: 'No change.', es: 'Sin cambios.', zh: '没有变化。', hi: 'कोई बदलाव नहीं।', te: 'మార్పు లేదు.', fr: 'Aucun changement.', ar: 'لا تغيير.', ko: '변화 없음.', ja: '変化はありません。', pt: 'Sem mudanças.' };
// Browser language -> ours: the primary subtag, plus the old/alternate codes browsers still send.
const LANG_ALIASES = { nb: 'no', nn: 'no', tl: 'fil', iw: 'he', in: 'id' };
function browserLang() {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language || '']) {
    const p = String(tag).toLowerCase().split(/[-_]/)[0];
    const code = LANG_ALIASES[p] || p;
    if (LANG[code]) return code;
  }
  return 'en';
}

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
  siteLang: LANG[store.get('lang', null)] ? store.get('lang', null) : browserLang(),
  view: urlView === 'clean' || urlView === 'info' ? urlView : store.get('view', 'info'),
  theme: store.get('theme', null), // null = follow the system
  settings: { useEleven: false, still: 8, textScale: 1, customLang: '', srMute: false, hideVideo: false, music: 100, breakSec: 5, ...store.get('settings', {}) },
  mode: 'pumpkin', narrLangCode: store.get('narrLang', null),
  started: false, paused: false, busy: false, speaking: false, gen: 0,
  lines: [], obs: 0, stillCount: 0, forcedStill: false, lastDiff: null, prevTiny: null,
  nextAt: 0, forceFull: true, saidNoChange: false, lastCaptureAt: 0, ahead: null,
  facing: 'user', userFlipped: false, stream: null,
  status: null, budgetHit: false, charsSession: 0,
  access: 'none', statusLoaded: false, voiceOff: false, voiceFails: 0, // access: 'owner' | 'byok' | 'none'
  startTime: 0, specimen: 1 + Math.floor(Math.random() * 999),
  pumpkinStill: 0, pumpkinChanged: true, lastSpokeAt: 0, lastFallback: '',
};
if (urlView) store.set('view', S.view);
try { localStorage.removeItem('nb3k:passcode'); } catch {} // left over from the old demo passcode
S.mode = S.view === 'clean' ? 'descriptive' : 'pumpkin'; // Halloween default

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
// One JSON file per language in /i18n. English is fetched at boot (preloaded in index.html) and fills any missing key;
// other languages load when chosen and are cached. Until one arrives, or if it doesn't exist yet, the page shows English.
const I18N = {};
const packP = {};
let textReady = false; // the first render with text waits for English (and briefly for the site language)
function loadPack(code) {
  if (!LANG[code]) return Promise.resolve(null);
  return (packP[code] ||= (async () => {
    for (let i = 0, tries = code === 'en' ? 3 : 1; i < tries; i++) {
      try {
        const r = await fetch(`/i18n/${code}.json`);
        if (r.status === 404) return null; // not translated yet: English it is
        if (r.ok) {
          I18N[code] = await r.json();
          if (textReady && (code === S.siteLang || code === 'en')) render();
          return I18N[code];
        }
      } catch {}
      if (i < tries - 1) await sleep(1500);
    }
    delete packP[code]; // a network failure: try again next time this language is picked
    return null;
  })());
}
const pick = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function t(path, vars) {
  let s = pick(I18N[S.siteLang], path) ?? pick(I18N.en, path) ?? '';
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  return s;
}
const modeName = (m) => t((S.view === 'clean' ? 'modeClean.' : 'mode.') + m);
const narrLangs = () => (S.settings.customLang.trim() ? [...LANGS, { name: S.settings.customLang.trim(), code: 'xx', label: S.settings.customLang.trim() }] : LANGS);
const narrLang = () => narrLangs().find((l) => l.code === (S.narrLangCode || S.siteLang)) || LANG[S.siteLang];
const showLangLabel = () => S.mode === 'descriptive' || narrLang().code !== S.siteLang;
const htmlLang = (code) => LANG[code]?.html || ''; // '' for the custom language: unknown
const breakMs = (mode) => (mode === 'documentary' || mode === 'funny' ? Math.min(30, Math.max(0, Math.round(Number(S.settings.breakSec)) || 0)) * 1000 : 0);

function render() {
  const html = document.documentElement;
  html.lang = htmlLang(S.siteLang);
  html.dir = LANG[S.siteLang].rtl ? 'rtl' : 'ltr';
  const dark = S.theme ? S.theme === 'dark' : darkQuery.matches;
  html.dataset.theme = dark ? 'dark' : 'light';
  document.body.dataset.view = S.view;
  document.body.dataset.mode = S.mode;
  document.body.toggleAttribute('data-calm', calm());
  document.body.classList.toggle('no-video', S.settings.hideVideo);
  document.body.classList.toggle('mirror', S.facing === 'user');
  html.style.setProperty('--text-scale', S.settings.textScale);
  $('#site-lang').value = S.siteLang;
  if (!textReady) return; // no text until English has loaded

  const rtl = LANG[S.siteLang].rtl;
  $$('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
    // Text not translated yet falls back to English: mark it, so screen readers say it in English and an RTL page
    // doesn't reorder it.
    const english = S.siteLang !== 'en' && pick(I18N[S.siteLang], el.dataset.i18n) == null;
    english ? el.setAttribute('lang', 'en') : el.removeAttribute('lang');
    english && rtl ? (el.dir = 'ltr') : el.removeAttribute('dir');
  });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $$('[data-mode-label]').forEach((el) => (el.textContent = modeName(el.dataset.modeLabel)));
  $$('[data-action=mode]').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.mode === S.mode);
    b.setAttribute('aria-label', modeName(b.dataset.mode));
    b.dataset.tooltip = modeName(b.dataset.mode); // emoji-only in the infomercial view: hover/focus shows the name
  });

  setIcon($('.theme-icon'), dark ? 'sun' : 'moon');
  $('.theme-label').textContent = dark ? t('btn.themeLight') : t('btn.themeDark');
  $('#view-btn').textContent = S.view === 'clean' ? t('btn.infomercial') : t('btn.accessible');
  $('.pause-lbl').textContent = S.paused ? t('btn.play') : t('btn.pause');
  setIcon($('.pause-icon'), S.paused ? 'play' : 'pause');
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
  $('#opt-break').value = S.settings.breakSec;
  $('#break-level').textContent = t('set.breakValue', { n: S.settings.breakSec });
  $('#opt-customlang').value = S.settings.customLang;
  $('#text-size').textContent = Math.round(S.settings.textScale * 100) + '%';
  renderStatus();
  updateHud();
  renderCountdown();
}

function saveSettings() { store.set('settings', S.settings); }

// ---------- Icons: one inline line-icon set (24-unit grid, 2px round strokes), so every control matches ----------
const ICONS = {
  binoculars: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M10 16a2 2 0 0 1 4 0"/><path d="M2.5 14.5 5 6.4A2 2 0 0 1 6.9 5H8a2 2 0 0 1 2 2v6"/><path d="M21.5 14.5 19 6.4A2 2 0 0 0 17.1 5H16a2 2 0 0 0-2 2v6"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7.5 3v18M16.5 3v18M3 12h18M3 7.5h4.5M3 16.5h4.5M16.5 7.5H21M16.5 16.5H21"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pumpkin: '<path d="M12 7.2c-1.8-1.1-4.6-1.2-6.6.4C3.3 9.3 2.6 12 3.3 14.8 4.1 17.8 6.4 20 9 20c1.2 0 2.1-.4 3-1 .9.6 1.8 1 3 1 2.6 0 4.9-2.2 5.7-5.2.7-2.8 0-5.5-2.1-7.2-2-1.6-4.8-1.5-6.6-.4z"/><path d="M12 7.2c-1.4 3.2-1.4 8.6 0 11.8M12 7.2c1.4 3.2 1.4 8.6 0 11.8"/><path d="M12 7.2c0-2.2.9-3.6 2.6-4.2"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M7 4.6v14.8a1 1 0 0 0 1.5.9l11.9-7.4a1 1 0 0 0 0-1.8L8.5 3.7A1 1 0 0 0 7 4.6z"/>',
  flip: '<path d="M3 8a2 2 0 0 1 2-2h2.2l1.6-2h6.4l1.6 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8.6 12.6a3.5 3.5 0 0 1 6.1-2.4"/><path d="M15 8.4v2.2h-2.2"/><path d="M15.4 13.4a3.5 3.5 0 0 1-6.1 2.4"/><path d="M9 17.6v-2.2h2.2"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
function setIcon(el, name) {
  if (!el || (el.dataset.icon === name && el.firstChild)) return;
  el.dataset.icon = name;
  el.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICONS[name]}</svg>`;
}

// ---------- LCD start-screen number ----------
function buildLcd() {
  $$('[data-lcd]').forEach((el) => {
    const s = el.dataset.lcd;
    el.innerHTML = `<span class="ghost" aria-hidden="true">${'~'.repeat(s.length)}</span><span class="lit">${[...s]
      .map((c) => `<span style="animation-delay:${(Math.random() * 0.9).toFixed(2)}s">${c}</span>`)
      .join('')}</span>`;
  });
}

// ---------- Status, access, counters ----------
async function refreshStatus() {
  try {
    const r = await fetch('/api/status', { signal: AbortSignal.timeout(5000) });
    S.status = r.ok ? await r.json() : null;
  } catch (e) {
    console.warn('[status] unavailable', e.message);
    S.status = null;
  }
  if (S.status) S.access = S.status.access || 'none';
  S.statusLoaded = true;
  renderStatus();
  return S.status;
}
S.statusP = null; // the boot-time refreshStatus(), so an early tap on Start can wait for it

const REQUIRED_VARS = new Set(['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'OWNER_PASSCODE', 'SESSION_SECRET']); // everything else has a default

function renderStatus() {
  const st = S.status, owner = S.access === 'owner' && st?.configured;
  $('#access-now').textContent = t('access.' + S.access);
  $('#btn-change-keys').textContent = S.access === 'byok' ? t('access.change') : t('access.add');
  const rm = $('#btn-remove-access');
  rm.hidden = S.access === 'none';
  rm.textContent = S.access === 'owner' ? t('access.lock') : t('access.remove');
  $('#counters').hidden = !owner;
  $('#config-set').hidden = !owner;
  if (!owner) return;
  $('#chars-session').textContent = S.charsSession;
  $('#chars-today').textContent = `${st.today.ttsChars} / ${st.limits.ttsChars}`;
  $('#narr-today').textContent = `${st.today.narrations} / ${st.limits.narrations}`;
  $('#config-list').innerHTML = Object.entries(st.configured).map(([k, v]) => {
    const label = v ? '✓ ' + t('set.yes') : REQUIRED_VARS.has(k) ? '✗ ' + t('set.no') : '– ' + t('set.dflt');
    return `<li class="${v || !REQUIRED_VARS.has(k) ? 'ok' : 'missing'}"><code>${k}</code> <span>${label}</span></li>`;
  }).join('');
}

// ---- Bring-your-own-keys dialog ----
function showFormError(id, key) {
  const el = $(id);
  el.textContent = key ? t(key) : '';
  el.hidden = !key;
}

// msgKey explains why the dialog opened mid-session (key rejected, keys removed).
function openKeys(msgKey) {
  const d = $('#keys');
  $('#settings').open && $('#settings').close();
  showFormError('#keys-msg', msgKey);
  showFormError('#keys-error', null);
  $$('#keys input').forEach((i) => i.removeAttribute('aria-invalid'));
  if (!d.open) d.showModal();
  $('#key-gemini').focus();
}

async function saveKeys(e) {
  e.preventDefault();
  if (!S.started) unlockAudio(); // synchronously inside the tap (iOS), before any await
  const gemini = $('#key-gemini').value.trim(), eleven = $('#key-eleven').value.trim();
  const fail = (key, input) => {
    showFormError('#keys-error', key);
    $$('#keys input').forEach((i) => i.toggleAttribute('aria-invalid', i === input));
    input?.focus();
  };
  if (!gemini) return fail('keys.needGemini', $('#key-gemini'));
  const btn = $('#keys-save');
  btn.disabled = true;
  btn.textContent = t('keys.saving');
  let r = null, j = {};
  try {
    r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geminiKey: gemini, ...(eleven && { elevenLabsKey: eleven }) }),
      signal: AbortSignal.timeout(10000),
    });
    j = await r.json().catch(() => ({}));
  } catch {}
  btn.disabled = false;
  btn.textContent = t('keys.save');
  if (!r?.ok) {
    if (r?.status === 429) return fail('keys.tooMany', null);
    if (j.error === 'gemini-invalid') return fail('keys.geminiInvalid', $('#key-gemini'));
    if (j.error === 'key-format') return j.field === 'elevenlabs' ? fail('keys.formatEleven', $('#key-eleven')) : fail('keys.format', $('#key-gemini'));
    return fail('keys.failed', null);
  }
  if (eleven) { S.settings.useEleven = true; saveSettings(); }
  Object.assign(S, { voiceOff: false, voiceFails: 0, budgetHit: false });
  await refreshStatus();
  $('#keys').close();
  render();
  if (!S.started) start();
  else if (S.paused) togglePause();
}

// ---- Owner access (hidden: 5 quick taps on the starburst / heading, or Shift+O) ----
function openOwner() {
  const d = $('#owner');
  if (d.open) return;
  $$('dialog[open]').forEach((x) => x.close());
  showFormError('#owner-error', null);
  d.showModal();
  $('#owner-input').focus();
}

async function saveOwner(e) {
  e.preventDefault();
  const input = $('#owner-input'), btn = $('#owner-save');
  btn.disabled = true;
  let r = null;
  try {
    r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode: input.value }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {}
  btn.disabled = false;
  if (!r?.ok) {
    showFormError('#owner-error', r?.status === 429 ? 'owner.tooMany' : 'owner.wrong');
    input.setAttribute('aria-invalid', 'true');
    input.select();
    return;
  }
  Object.assign(S, { voiceOff: false, voiceFails: 0, budgetHit: false });
  await refreshStatus();
  $('#owner').close();
  render();
  $('#announce').textContent = t('owner.done');
  if (S.started && S.paused) togglePause();
}

async function removeAccess() {
  try { await fetch('/api/session', { method: 'DELETE', signal: AbortSignal.timeout(5000) }); } catch {}
  await refreshStatus();
  render();
  if (S.started) {
    if (!S.paused) togglePause();
    openKeys('keys.removed');
  }
}

// /api/narrate said no: our key is locked or the visitor's key was refused. Stop instead of looping on fallbacks.
function accessDenied(reason) {
  if (S.started && !S.paused) togglePause();
  refreshStatus();
  openKeys(reason === 'gemini-key' ? 'keys.badKey' : 'keys.needKeys');
}

function tapUnlock(el) {
  let taps = [];
  el.addEventListener('click', () => {
    const now = Date.now();
    taps = [...taps.filter((x) => now - x < 3000), now];
    if (taps.length >= 5) { taps = []; openOwner(); }
  });
}

function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONFIG.apiTimeoutMs),
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
    u.lang = lang.bcp === 'yue-HK' ? 'zh-HK' : lang.bcp || 'en-US'; // browsers file Cantonese voices under zh-HK
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

const streamEleven = () => S.settings.useEleven && S.status?.elevenlabs && !S.budgetHit && !S.voiceOff && !S.settings.srMute;
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

// After a failed sentence: an <audio> error can't show the HTTP status, so ask /api/status what changed.
function voiceFailed() {
  S.voiceFails++;
  refreshStatus().then((st) => {
    if (!st) return;
    if (st.access === 'owner' && st.today.ttsChars >= st.limits.ttsChars) S.budgetHit = true;
    // Visitors: no ElevenLabs key, or it keeps failing (bad key, no quota): use the browser voice for this session.
    if (st.access !== 'owner' && (!st.byok?.elevenlabs || S.voiceFails >= 2)) S.voiceOff = true;
  });
}

// Returns the text still unspoken ('' when done or interrupted), for the browser voice to finish.
// Streams sentence by sentence: the next sentence loads on the other element while this one plays.
async function speakEleven(line, onLast, onStart) {
  const segs = (line.segs ||= sentences(line.text, line.lang.code));
  let el = line.pre || otherVoice(S.voice);
  for (let i = 0; i < segs.length; i++) {
    const next = otherVoice(el), src = segSrc(line, i), last = i === segs.length - 1;
    S.charsSession += segs[i].trim().length;
    renderStatus();
    const ok = await playVoice(el, el._src === src ? null : src, () => {
      if (i === 0) onStart?.();
      last ? onLast() : loadVoice(next, segSrc(line, i + 1));
    });
    if (line.gen !== S.gen) return '';
    if (!ok) {
      if (!last) resetVoice(next);
      voiceFailed();
      return segs.slice(i).join('').trim();
    }
    S.voiceFails = 0;
    el = next;
  }
  return '';
}

// onLast fires once, when the line's final sentence starts: the cue to prepare the next line.
// onStart fires once, when the line actually starts: ElevenLabs' first sentence playing, or browser speech starting.
async function speak(line, onLast, onStart) {
  let cued = false, begun = false;
  const cue = () => { if (!cued) (cued = true), onLast?.(); };
  const begin = () => { if (!begun) (begun = true), onStart?.(); };
  if (line.pre && !streamEleven()) resetVoice(line.pre);
  S.speaking = true;
  setMusic();
  try {
    if (S.settings.srMute) return begin(), cue(), await new Promise((r) => { S.stopVoice = r; setTimeout(r, Math.max(2500, line.text.length * 60)); });
    let rest = line.text;
    if (streamEleven()) rest = await speakEleven(line, cue, begin);
    if (rest && line.gen === S.gen) begin(), cue(), await speakBrowser(rest, line.lang);
    if (line.gen === S.gen) begin(); // never leave a line's subtitle unshown
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
  const pack = [I18N[lang.code], I18N[S.siteLang], I18N.en].find((p) => p?.fallback?.[key]?.length);
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
  if (!ahead) showUnchanged(false), setStatus(''), beginWait();

  S.busy = true;
  S.obs++;
  let result = null, denied = null, quota = false;
  try {
    const r = await api('/api/narrate', {
      image: grabJpeg(), mode, language: lang.name, lastLines: S.lines.slice(-4),
      stillCount: mode === 'descriptive' ? 0 : S.stillCount, observationNumber: S.obs,
    });
    if (r.status === 401) denied = (await r.json().catch(() => ({}))).error || 'access';
    else if (r.status === 429 && S.access === 'byok' && (await r.json().catch(() => ({}))).error === 'gemini-quota') quota = true;
    else if (!r.ok) throw new Error('HTTP ' + r.status);
    else result = await r.json();
  } catch (e) {
    console.warn('[narrate] using fallback:', e.message);
  }
  if (gen !== S.gen) return null; // mode/language switched mid-request
  S.busy = false;
  setStatus('');
  if (denied) return accessDenied(denied), null;
  // The visitor's own Gemini quota ran out: say so and wait a minute instead of looping fallback lines.
  if (quota) return setStatus(t('keys.quota')), (S.nextAt = Date.now() + 60000), null;

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
      text = I18N[lang.code]?.noChange || NO_CHANGE[lang.code] || NO_CHANGE.en;
      english = '';
    } else S.saidNoChange = false;
  }
  text = tidy(text);
  return text ? { gen, mode, lang, text, english: tidy(english), fallback: !result } : null;
}

// Fetch the next line while this one plays. Its first sentence's audio can only start loading once the
// current line's last sentence is playing (the idle element is busy with this line's next sentence until then).
// at: the earliest time to capture (a break between lines captures late, so the frame is fresh when the line plays).
function startLookahead(gen, at = 0) {
  if (gen !== S.gen || S.ahead || S.paused || S.mode === 'pumpkin') return;
  const delay = Math.max(0, S.lastCaptureAt + CONFIG.minCaptureGapMs - Date.now(), at - Date.now());
  const ahead = (S.ahead = { gen, done: false, armed: false, reqAt: Date.now() + delay });
  ahead.p = sleep(delay)
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
    const cur = line;
    S.lines = [...S.lines, cur.text].slice(-8); // the look-ahead request needs this line as context, even before it shows
    // A line whose voice isn't loaded yet would show its subtitle ~2s before ElevenLabs starts talking: hold the
    // subtitle until its first sentence actually plays (the countdown covers any wait). Look-ahead lines whose
    // first sentence is already buffered show straight away, as do fallback lines.
    const hold = streamEleven() && !cur.fallback && !(cur.pre?.readyState >= 3 && !cur.pre.error);
    const show = () => {
      if (cur.shown || cur.gen !== S.gen) return; // an interrupt cancels a pending show
      cur.shown = true;
      showUnchanged(false);
      showLine(cur.text, cur.english, cur.lang);
      if (cur.mode === 'funny' && S.stillCount >= 2) nowShowing(cur.text);
      if (S.wait?.gen === gen) endWait(!cur.fallback);
    };
    if (!hold) show();
    // Comedy modes start the next line as this one begins, so it's ready in time; Descriptive waits for the
    // last sentence so a blind user hears the scene as it is now, not as it was a whole line ago.
    // With a break between lines (Documentary, Funny), the next capture waits until the break is nearly over instead.
    const brk = breakMs(cur.mode);
    if (cur.mode !== 'descriptive' && !brk) startLookahead(gen);
    await speak(cur, () => !brk && armLookahead(gen), show);
    if (brk && gen === S.gen) {
      // Capture so the next line is ready, first sentence loaded, as the break ends: start this device's usual
      // wait before then. The countdown counts down to the end of the break.
      const until = Date.now() + brk, from = until - waitEstimate();
      startLookahead(gen, from);
      armLookahead(gen); // both voice elements are idle now
      endWait(false);
      beginWait(from, false, false);
      let wake;
      await new Promise((r) => { const tm = setTimeout(r, brk); S.wakeBreak = wake = () => (clearTimeout(tm), r()); });
      if (S.wakeBreak === wake) S.wakeBreak = null;
    }
    const ahead = S.ahead;
    if (gen !== S.gen || !ahead) break;
    if (!ahead.done) beginWait(ahead.reqAt, true, false);
    line = await ahead.p;
    if (S.ahead === ahead) S.ahead = null;
  }
  if (gen === S.gen) S.nextAt = Math.max(S.nextAt, Date.now()); // cadence stays ~7s from the previous capture start
}

async function narrate(opts) {
  const gen = S.gen;
  const line = await fetchLine(opts);
  if (line) await playLine(line);
  if (S.wait?.gen === gen) endWait(false); // no line came (unchanged, pumpkin saw nobody, quota): stop counting
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
  renderCountdown();
  if (!S.started || S.paused || S.busy || S.speaking || S.ahead || !video.videoWidth) return;
  if (S.mode === 'pumpkin') { if (ticks % 4 === 0) pumpkinTick(); } // pumpkin's stillness counts assume a 1s tick
  else if (Date.now() >= S.nextAt) narrate();
}, 250);

// ---------- On-screen output ----------
function setStatus(s) { $('#status').textContent = s; }

let lastAnnounceAt = 0;
function announce(s) {
  const el = $('#announce');
  el.textContent = s === el.textContent ? s + '\u00a0' : s; // a change, so a repeat is still read
  lastAnnounceAt = Date.now();
}

// ---------- "Narrating in N" countdown ----------
// Counts down from this device's own recent waits (request start -> voice playing, or -> subtitle shown for the
// browser voice), kept per voice since ElevenLabs is slower than browser speech. Starts from a 4s guess.
const WAIT_GUESS_MS = 4000, WAIT_SAMPLES = 5;
const waitHist = { eleven: [], browser: [], ...store.get('waitMs', {}) };
const voiceKind = () => (streamEleven() ? 'eleven' : 'browser');
function waitEstimate() {
  const h = waitHist[voiceKind()];
  const avg = Array.isArray(h) && h.length ? h.reduce((a, b) => a + b, 0) / h.length : WAIT_GUESS_MS;
  return Math.max(1, Math.round(avg / 1000)) * 1000; // whole seconds, so the first number shows for a full second
}

// from: when the request for the awaited line started. measure: whether its arrival is a fair timing sample.
function beginWait(from = Date.now(), measure = true, speakNote = true) {
  if (S.wait?.gen === S.gen) return;
  clearTimeout(S.wait?.t);
  const w = (S.wait = { gen: S.gen, from, measure });
  // Screen readers get one polite note instead of numbers: only when narration (re)starts, if the wait lasts,
  // and not on top of a title card. Waits between lines stay silent so the note doesn't precede every line.
  if (speakNote) w.t = setTimeout(() => S.wait === w && Date.now() - lastAnnounceAt > 2000 && announce(t('countdown.sr')), 1000);
  renderCountdown();
}

function endWait(sample) {
  const w = S.wait;
  if (!w) return;
  clearTimeout(w.t);
  S.wait = null;
  const ms = Date.now() - w.from;
  if (sample && w.measure && ms > 300 && ms < 20000) {
    const k = voiceKind();
    waitHist[k] = [...(Array.isArray(waitHist[k]) ? waitHist[k] : []), Math.round(ms)].slice(-WAIT_SAMPLES);
    store.set('waitMs', waitHist);
  }
  renderCountdown();
}

function renderCountdown() {
  const el = $('#countdown');
  let key = '', n = 0;
  if (S.started && !S.paused) {
    if (S.wait?.gen === S.gen) {
      n = Math.ceil((waitEstimate() - (Date.now() - S.wait.from)) / 1000);
      key = n >= 1 ? 'in' : 'late'; // a late line holds at "Narrating…" rather than counting past 0
    } else if (S.mode === 'pumpkin' && !S.speaking) key = 'visitor';
  }
  const sig = `${key}${key === 'in' ? n : ''}|${S.siteLang}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.className = 'countdown' + (key ? ' cd-' + key : '');
  if (!key) return el.replaceChildren();
  const span = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
  const [pre, post = ''] = t('countdown.' + key).split('{n}');
  el.replaceChildren(...[span('cd-txt', pre), key === 'in' && span('cd-n', n), post && span('cd-txt', post)].filter((x) => x && x.textContent));
}
function showUnchanged(on) { $('#unchanged').hidden = !on; }

function words(text, lang) {
  if (window.Intl?.Segmenter) return [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].map((s) => s.segment);
  return text.split(/(\s+)/);
}

function showLine(text, english, lang) {
  const main = $('#sub-main');
  const code = htmlLang(lang.code);
  main.lang = code;
  const dir = LANG[lang.code]?.rtl ? 'rtl' : 'auto';
  main.dir = dir;
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
  live.dir = dir;
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
  announce(modeName(S.mode) + (extra ? ` – ${narrLang().name}` : ''));
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
  S.wakeBreak?.(); // a break between lines ends now
  S.busy = false;
  S.ahead = null;
  stopSpeech();
  setStatus('');
  endWait(false);
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
  if (!LANG[l]) return;
  loadPack(l); // renders again when it arrives; English until then
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
  loadPack(code); // for its fallback lines
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
  if ($('dialog[open]')) return; // the keys or owner dialog is up
  refreshStatus();
  d.showModal();
}

async function wakeLock() {
  try { S.wake = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S.started && wakeLock());

// Start button: without access, ask for the visitor's own keys instead of starting.
async function begin() {
  if (S.started) return;
  if (!S.statusLoaded) {
    unlockAudio(); // still inside the tap
    await S.statusP;
  }
  if (S.access === 'none') return openKeys();
  start();
}

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
    start: begin,
    mode: () => setMode(b.dataset.mode),
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
  if (k === 'o' && e.shiftKey) return e.preventDefault(), openOwner();
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
bind('#opt-eleven', 'change', (e) => {
  S.settings.useEleven = e.target.checked;
  if (S.settings.useEleven) Object.assign(S, { voiceOff: false, voiceFails: 0 }); // switching it back on retries ElevenLabs
  saveSettings();
});
bind('#keys-form', 'submit', saveKeys);
bind('#owner-form', 'submit', saveOwner);
bind('#btn-change-keys', 'click', () => openKeys());
bind('#btn-remove-access', 'click', removeAccess);
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('.info-btn').forEach((b) => b.addEventListener('click', () => {
  const open = b.getAttribute('aria-expanded') !== 'true';
  b.setAttribute('aria-expanded', open);
  document.getElementById(b.getAttribute('aria-controls')).hidden = !open;
}));
// Keys never linger in the page once a dialog closes.
bind('#keys', 'close', () => $$('#keys input').forEach((i) => (i.value = '')));
bind('#owner', 'close', () => { $('#owner-input').value = ''; $('#owner-input').removeAttribute('aria-invalid'); });
tapUnlock($('.burst-1'));
tapUnlock($('.start-clean h1'));
bind('#opt-srmute', 'change', (e) => { S.settings.srMute = e.target.checked; saveSettings(); });
bind('#opt-hidevideo', 'change', (e) => { S.settings.hideVideo = e.target.checked; saveSettings(); render(); });
bind('#opt-still', 'input', (e) => { S.settings.still = Number(e.target.value); saveSettings(); });
bind('#opt-music', 'input', (e) => { S.settings.music = Number(e.target.value); $('#music-level').textContent = S.settings.music + '%'; saveSettings(); setMusic(); });
bind('#opt-break', 'input', (e) => { S.settings.breakSec = Number(e.target.value); $('#break-level').textContent = t('set.breakValue', { n: S.settings.breakSec }); saveSettings(); });
bind('#narr-lang', 'change', (e) => setNarrLang(e.target.value));
bind('#site-lang', 'change', (e) => setSiteLang(e.target.value));
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
$$('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));
$('#site-lang').replaceChildren(...LANGS.map((l) => Object.assign(new Option(l.native, l.code), { lang: l.html })));
buildLcd();
render();
S.statusP = refreshStatus();
// First text: English, plus up to a second's wait for the site language so it doesn't flash English first.
const siteP = loadPack(S.siteLang);
(function firstText() {
  loadPack('en').then((en) => (en ? Promise.race([siteP, sleep(1000)]).then(() => { textReady = true; render(); }) : setTimeout(firstText, 5000)));
})();
if (S.narrLangCode && S.narrLangCode !== S.siteLang) loadPack(S.narrLangCode);
