# WhatsApp Auto-Reply

Replies to **one** WhatsApp contact **in Spanish and in context**, about
**3–5 minutes** after she messages you. It reads her message and answers to
match it — e.g. "Buenas noches" → a night reply (never "Buenos días"),
"¿Cómo estás?" → "Muy bien, ¿y tú?", "Te amo" → "Yo también te amo ❤️".

It works by linking to your WhatsApp account as a "linked device" (the same
way WhatsApp Web / Desktop does). There is no official API for a personal
number, so this drives WhatsApp Web in the background. **Your phone stays
logged in and must have internet** for the bot to send.

## One-time setup

1. Open a terminal in this folder and install dependencies:
   ```
   npm install
   ```
   (First install downloads a bundled Chromium — a few hundred MB — so give it
   a minute.)

2. Edit **`config.js`** and set `TARGET_NUMBER` to her number in full
   international format, digits only (e.g. `18135551234`).

3. (Optional) Edit **`intents.js`** to add/adjust the Spanish replies.

## Run it

```
npm start
```

The first run prints a **QR code** in the terminal. On your phone open
**WhatsApp → Settings → Linked Devices → Link a Device** and scan it.
After that the session is remembered, so future runs skip the QR.

When it's working you'll see `Bot is ready and listening.` Leave the window
open — it must keep running to reply. Press `Ctrl+C` to stop.

## How it behaves

- Reacts only to messages **from the number in `config.js`**, in a 1-on-1 chat
  (ignores groups, and ignores your own messages).
- Replies to **every** message she sends, each after its own random
  3–5 minute delay.
- Reads her message and replies **in Spanish, matching the context**
  (greetings by time of day, "cómo estás", "te amo", "gracias", despedidas…).
  If it doesn't recognize the message, it sends a warm neutral Spanish reply.

## Editing the replies (`intents.js`)

Each "intent" has `match` patterns (what she might send) and `replies`
(what the bot can answer, chosen at random). Intents are checked top to
bottom — the first match wins — so time-of-day greetings sit at the top.
Add your own or change the wording freely. `FALLBACK` is used when nothing
matches.

## Settings (`config.js`)

| Setting | Meaning |
|---|---|
| `TARGET_NUMBER` | Her number, digits only, with country code. |
| `MIN_DELAY_MINUTES` / `MAX_DELAY_MINUTES` | Reply waits a random time in this range. |
| `REPLY_TO_NON_TEXT` | `true` = also reply to her photos/voice notes; `false` = only her texts. |

## Notes / cautions

- This is an unofficial method. Automating a personal account is against
  WhatsApp's Terms of Service; use it gently and at your own risk.
- The `.wwebjs_auth/` folder is your login — it's gitignored, never share it.
- If she sends many messages quickly, each one schedules its own reply, so
  replies can stack up. Tell me if you'd rather it reply only once per hour.
