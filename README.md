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

## Environment variables (names only)

| Name | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini vision (required) |
| `ELEVENLABS_API_KEY` | ElevenLabs voices (optional; the browser voice is the fallback) |
| `VOICE_DOCUMENTARY`, `VOICE_TRAILER`, `VOICE_DESCRIPTIVE`, `VOICE_PUMPKIN` | Override the default voice IDs in `api/speak.js` |
| `VOICE_SPANISH`, `VOICE_CHINESE` | Optional per-language voices |
| `GEMINI_MODEL_FUNNY`, `GEMINI_MODEL_FAST`, `ELEVENLABS_MODEL` | Optional model overrides |
| `DEMO_PASSCODE` | Optional; requires a passcode before narrating |
| `DAILY_NARRATION_LIMIT` (900), `DAILY_TTS_CHAR_LIMIT` (20000) | Daily caps across all users |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | Upstash Redis for shared rate limits |

Voice settings (stability, style, and so on) live in the `VOICES` object at the top of `api/speak.js`. Prompts live in `api/_prompts.js`.

## Hotkeys

| Key | Action |
| --- | --- |
| `1` `2` `3` `4` | Documentary, Funny, Descriptive, Pumpkin |
| `L` | Cycle narration language (Descriptive) |
| `N` | Narrate now |
| `S` | Force stillness jokes on/off |
| `T` | Dark/light theme |
| `A` | Accessible view |
| `Space` | Pause/play |
| `K` | Settings |

## Tech

Gemini (vision), ElevenLabs (voices), vanilla JS/HTML/CSS with no build step, Vercel serverless functions, and Upstash Redis rate limiting.
