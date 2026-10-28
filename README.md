# NarrateBot 3000

*Your world, narrated.*

**Live:** https://narratebot3000.kelvinct.com · accessible view: https://narratebot3000.kelvinct.com/?view=clean

NarrateBot 3000 turns any webcam into a live narrator that describes the world for blind and low-vision people, in whatever language they speak, with nothing to install. It also does nature documentaries and comedy movie trailers, because why not.

## Run locally

```bash
vercel env pull .env.local   # pulls the project's env vars (git-ignored)
vercel dev                   # serves index.html + /api on http://localhost:3000
```

The webcam needs `localhost` or HTTPS. To test on a phone, use the deployed link.

## Access

The hackathon is over, so the server's own Gemini and ElevenLabs keys are reserved for the owner.

- **Bring your own keys.** Pressing ORDER NOW / Start without access opens a "Use your own keys" dialog: a Gemini API key (required, checked with Google before it's accepted) and an ElevenLabs API key (optional; without one, the browser voice speaks). The (i) buttons explain where to get each key. Keys are kept only in an encrypted, `HttpOnly` cookie in that browser (`nb3k_session`, AES-256-GCM, 30 days), sent with each request and never stored or logged on the server. Settings → Access shows the current access and has "Change keys" and "Remove my keys". Visitors' usage doesn't count against the daily caps below; per-device rate limits still apply.
- **Owner.** Tap the "AS SEEN ON TV!" starburst 5 times within 3 seconds (in the accessible view, tap the "NarrateBot 3000" heading), or press `Shift+O`, then enter `OWNER_PASSCODE`. Attempts are limited to 5 per 15 minutes per IP. Owner sessions use the server keys and the daily caps; "Lock owner access" in Settings signs out. Changing `OWNER_PASSCODE` signs out every owner session; changing `SESSION_SECRET` signs out everyone.

## Environment variables (names only)

| Name | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini vision for owner sessions |
| `ELEVENLABS_API_KEY` | ElevenLabs voices for owner sessions (optional; the browser voice is the fallback) |
| `OWNER_PASSCODE` | Owner password (a long random string). Unset = no owner access |
| `SESSION_SECRET` | Encrypts the session cookie (at least 32 characters; 96 hex recommended). Unset = no sessions at all |
| `VOICE_DOCUMENTARY`, `VOICE_TRAILER`, `VOICE_DESCRIPTIVE`, `VOICE_PUMPKIN` | Override the default voice IDs in `api/speak.js` |
| `VOICE_SPANISH`, `VOICE_CHINESE` | Optional per-language voices |
| `GEMINI_MODEL_FUNNY`, `GEMINI_MODEL_FAST`, `ELEVENLABS_MODEL` | Optional model overrides |
| `ELEVENLABS_MODEL_TELUGU` | Optional; Telugu narration uses `eleven_v3` by default because `eleven_multilingual_v2` has no Telugu |
| `DAILY_NARRATION_LIMIT` (900), `DAILY_TTS_CHAR_LIMIT` (20000) | Daily caps on the owner's keys |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | Upstash Redis for shared rate limits |

Voice settings (stability, style, and so on) live in the `VOICES` object at the top of `api/speak.js`. Prompts live in `api/_prompts.js`.

Narration languages: English, Spanish, Chinese, Hindi, Telugu, French, Arabic, Korean, Japanese, Portuguese, plus a custom one from Settings. Non-English lines also come back with an English translation, shown under the subtitle when the site is in English. ElevenLabs audio streams to the page (`GET /api/speak`, with the session cookie), so speech starts before the whole clip is generated. With a visitor's own ElevenLabs key, a voice their plan can't use is retried once with the premade "George" voice. Speech is requested sentence by sentence, using ElevenLabs request stitching (`previous_text`/`next_text`) so the sentences sound continuous, and the next line is captured and its first sentence loaded while the current one plays.

## Hotkeys

| Key | Action |
| --- | --- |
| `1` `2` `3` `4` | Documentary, Funny, Descriptive, Pumpkin |
| `L` | Cycle narration language (any mode; also the 🌐 picker in the control bar) |
| `N` | Narrate now |
| `S` | Force stillness jokes on/off |
| `T` | Dark/light theme |
| `A` | Accessible view |
| `Space` | Pause/play |
| `K` | Settings |

## Tech

Gemini (vision), ElevenLabs (voices), vanilla JS/HTML/CSS with no build step, Vercel serverless functions, and Upstash Redis rate limiting.

## Credits

Background music (`documentary.mp3`, `funny.mp3`) is from [Pixabay](https://pixabay.com/music/), used under the [Pixabay Content License](https://pixabay.com/service/license-summary/). The tracks aren't covered by this repository's code and can't be redistributed on their own.
