// ============================================================
//  WhatsApp auto-reply bot
//  Replies to ONE contact in Spanish, IN CONTEXT, 3-5 minutes
//  after she messages you (e.g. "Buenas noches" -> night reply).
//
//  Run:  npm start
//  Edit settings in config.js, edit Spanish replies in intents.js.
// ============================================================

const path = require("path");
const qrcodeTerminal = require("qrcode-terminal");
const qrcodeImage = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const config = require("./config.js");
const { replyFor } = require("./intents.js");

// Normalize the target number. We match her by PHONE NUMBER (digits), not by a
// fixed chat-id string, because modern WhatsApp may address her chat as
// "<hidden>@lid" instead of "<number>@c.us" — an exact @c.us match would then
// silently ignore her. TARGET_ID is still used for the classic fast path and
// for the best-effort startup mute.
const TARGET_DIGITS = String(config.TARGET_NUMBER).replace(/\D/g, "");
const TARGET_ID = TARGET_DIGITS + "@c.us";
// Known chat-ids that mean "her" — starts with the classic @c.us id and gains
// her resolved "@lid" id at startup. Matching against this set is the fast path
// so we don't call getContact() on every unrelated message.
const TARGET_IDS = new Set([TARGET_ID]);

// ---------- helpers ----------

function nowET() {
  return new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
}

function log(...args) {
  console.log(`[${nowET()}]`, ...args);
}

function randomDelayMs() {
  const min = config.MIN_DELAY_MINUTES;
  const max = config.MAX_DELAY_MINUTES;
  const minutes = min + Math.random() * (max - min);
  return Math.round(minutes * 60 * 1000);
}

// ---------- the actual reply ----------

async function sendReply(client, chatId, incomingText) {
  const { reply, intent } = replyFor(incomingText);
  // Reply into the exact chat the message arrived on (address-agnostic:
  // works whether that id is @c.us or @lid).
  await client.sendMessage(chatId, reply);
  log(`Replied (intent: ${intent}) to ${chatId} with "${reply}"`);
}

// Keep her chat muted (phone stays quiet) while the bot still replies.
async function ensureMuted(client, quiet) {
  if (!config.MUTE_TARGET_CHAT) return false;
  // Try every known id for her (classic @c.us first, then any resolved @lid).
  let lastErr = null;
  for (const id of TARGET_IDS) {
    try {
      const chat = await client.getChatById(id);
      if (!chat.isMuted) {
        // Mute "forever" (far-future date; works across web.js versions).
        await chat.mute(new Date("2999-01-01T00:00:00Z"));
        log(`Her chat is now muted (${id}; notifications off, bot still replies).`);
      }
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!quiet) log("Chat not mutable yet (will retry):", (lastErr && lastErr.message) || lastErr);
  return false;
}

// On startup her chat may still be syncing. Keep trying quietly until it is
// muted, then stop.
function muteWithRetries(client) {
  if (!config.MUTE_TARGET_CHAT) return;
  let done = false;
  const attempt = async (quiet) => {
    if (done) return;
    if (await ensureMuted(client, quiet)) {
      done = true;
      if (poll) clearInterval(poll);
    }
  };
  [2000, 15000, 45000, 120000].forEach((ms) => setTimeout(() => attempt(true), ms));
  const poll = setInterval(() => attempt(true), 5 * 60 * 1000);
}

// ---------- incoming-message handling ----------
// We listen on BOTH "message" and "message_create" because on some WhatsApp
// Web builds the plain "message" event is unreliable and silently drops
// incoming messages, while "message_create" still fires. Dedupe by message id
// so she never gets two replies for one message.

const handled = new Set();

function rememberHandled(id) {
  handled.add(id);
  // keep the set from growing without bound
  if (handled.size > 500) {
    const first = handled.values().next().value;
    handled.delete(first);
  }
}

// Resolve the sender's real phone number (digits only), @lid-safe.
async function senderDigits(msg) {
  try {
    const c = await msg.getContact();
    const n = (c && (c.number || (c.id && c.id.user))) || "";
    return String(n).replace(/\D/g, "");
  } catch (e) {
    return "";
  }
}

// Mute the exact chat a message arrived on (address-agnostic), so it works
// even when her chat id is @lid and getChatById(@c.us) would fail.
async function muteChatOf(msg) {
  if (!config.MUTE_TARGET_CHAT) return;
  try {
    const chat = await msg.getChat();
    if (chat && !chat.isMuted) {
      await chat.mute(new Date("2999-01-01T00:00:00Z"));
      log("Her chat is now muted (notifications off; bot still replies).");
    }
  } catch (e) {
    /* best effort */
  }
}

async function handleIncoming(client, msg, source) {
  try {
    if (!msg || msg.fromMe) return;               // never our own messages
    if (msg.from && msg.from.endsWith("@g.us")) return; // ignore groups

    // Fast path: known id (classic @c.us or her resolved @lid).
    let match = TARGET_IDS.has(msg.from);
    if (!match) {
      // Fallback: confirm by resolved phone number (covers an id we haven't
      // cached yet, e.g. an @lid that changed). Then remember it.
      const num = await senderDigits(msg);
      if (num !== TARGET_DIGITS) return;          // not her
      TARGET_IDS.add(msg.from);
      match = true;
    }

    const id =
      (msg.id && (msg.id._serialized || msg.id.id)) || `${msg.from}:${msg.timestamp}`;
    if (handled.has(id)) return;                  // already acted on this one
    rememberHandled(id);

    if (!config.REPLY_TO_NON_TEXT && msg.type !== "chat") {
      log(`Ignored non-text message (type: ${msg.type}).`);
      return;
    }

    const incomingText = msg.body || "";
    const chatId = msg.from;                       // reply back on this exact chat
    muteChatOf(msg);                               // chat exists now -> mute it
    const delay = randomDelayMs();
    log(
      `Mensaje recibido [${source}] from ${chatId} (type: ${msg.type}): ` +
        `"${incomingText}". Respondo en ${(delay / 60000).toFixed(2)} min.`
    );

    setTimeout(() => {
      sendReply(client, chatId, incomingText).catch((err) =>
        log("Reply error:", err.message)
      );
    }, delay);
  } catch (err) {
    log("handleIncoming error:", err.message || err);
  }
}

// ---------- WhatsApp client ----------

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, ".wwebjs_auth") }),
  webVersion: "2.3000.1054108093",
  webVersionCache: {
    type: "local",
    path: path.join(__dirname, ".wwebjs_cache"),
  },
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROME_PATH || config.CHROME_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  },
});

const QR_IMAGE_PATH = path.join(__dirname, "qr.png");

client.on("qr", (qr) => {
  qrcodeImage.toFile(QR_IMAGE_PATH, qr, { width: 400 }, (err) => {
    if (err) {
      log("Could not save qr.png:", err.message);
    } else {
      log(`QR code saved. OPEN THIS IMAGE AND SCAN IT:  ${QR_IMAGE_PATH}`);
    }
  });
  console.log("\n(If the image does not open, scan this instead:)\n");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("authenticated", () => log("Authenticated — session saved."));

// ---------- connection health watchdog ----------
// If the socket silently stops delivering, getState() stops returning
// CONNECTED. After a few consecutive bad reads we exit so systemd restarts us
// with a fresh socket (no QR needed; the saved session is reused).
let badStateCount = 0;
function startHealthCheck(client) {
  setInterval(async () => {
    let state = null;
    try {
      state = await client.getState();
    } catch (err) {
      state = "ERR:" + (err.message || err);
    }
    if (state === "CONNECTED") {
      if (badStateCount > 0) log(`Connection recovered (state: CONNECTED).`);
      badStateCount = 0;
      return;
    }
    // A thrown "detached Frame" / eval error can be transient (WhatsApp Web
    // reloads its own frames). Only restart after a sustained run of bad reads
    // so we never thrash, while still self-healing a genuinely dead socket.
    badStateCount++;
    log(`Connection health: state=${state} (strike ${badStateCount}/5).`);
    if (badStateCount >= 5) {
      log("Socket not delivering for ~5 min; exiting so systemd restarts with a fresh connection.");
      process.exit(1);
    }
  }, 60 * 1000);
}

client.on("ready", async () => {
  log("Bot is ready and listening.");
  log(`Watching for messages from: ${config.TARGET_NUMBER}  (${TARGET_ID})`);
  log(
    `Reply delay: random ${config.MIN_DELAY_MINUTES}-${config.MAX_DELAY_MINUTES} minutes. ` +
      `Respuestas contextuales en español (intents.js).`
  );
  // Resolve + cache her current @lid id (modern WhatsApp addresses her chat as
  // "<hidden>@lid", not "<number>@c.us"). Matching then works on the fast path.
  try {
    const nid = await client.getNumberId(TARGET_DIGITS);
    if (nid && nid._serialized) {
      TARGET_IDS.add(nid._serialized);
      log(`Target ${TARGET_DIGITS} resolved to ${nid._serialized} (matching is @lid-safe).`);
    } else {
      log(`Target ${TARGET_DIGITS} not resolvable right now; will match by number on arrival.`);
    }
  } catch (e) {
    log("Target resolve failed (will match by number on arrival):", e.message || e);
  }
  muteWithRetries(client);
  startHealthCheck(client);
});

client.on("auth_failure", (m) => log("AUTH FAILURE:", m));
client.on("disconnected", (r) => {
  log("Disconnected:", r, "— exiting so systemd restarts with a fresh connection.");
  process.exit(1);
});

client.on("message", (msg) => handleIncoming(client, msg, "message"));
client.on("message_create", (msg) => handleIncoming(client, msg, "message_create"));

// ---------- env-gated test hooks (inert unless WA_SELFTEST / WA_DEBUG_ALL set) ----------
client.on("ready", async () => {
  if (!process.env.WA_SELFTEST) return;
  try {
    const me = client.info && client.info.wid && client.info.wid._serialized;
    await client.sendMessage(me, "✅ WhatsApp bot selftest — " + nowET());
    log("Selftest message sent to your own 'Message yourself' chat.");
  } catch (e) {
    log("Selftest send failed:", e.message || e);
  }
  // Confirm the live session can actually resolve the target contact, and show
  // how WhatsApp addresses her (helps verify the @lid-safe matching).
  try {
    const nid = await client.getNumberId(TARGET_DIGITS);
    log(
      "Resolve target " +
        TARGET_DIGITS +
        " -> " +
        (nid ? nid._serialized : "NOT RESOLVABLE (not on WhatsApp / not a contact)")
    );
  } catch (e) {
    log("Resolve target failed:", e.message || e);
  }
});
client.on("message_create", (msg) => {
  if (!process.env.WA_DEBUG_ALL) return;
  try {
    log(
      `DEBUG create from=${msg.from} fromMe=${msg.fromMe} type=${msg.type} ` +
        `body="${(msg.body || "").slice(0, 40)}"`
    );
  } catch (e) {}
});

log("Starting WhatsApp auto-reply bot...");
client.initialize();
