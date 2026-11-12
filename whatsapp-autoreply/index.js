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

// Normalize the target number into the "<digits>@c.us" chat id WhatsApp uses.
const TARGET_ID = String(config.TARGET_NUMBER).replace(/\D/g, "") + "@c.us";

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

async function sendReply(client, incomingText) {
  const { reply, intent } = replyFor(incomingText);
  await client.sendMessage(TARGET_ID, reply);
  log(`Replied (intent: ${intent}) with "${reply}"`);
}

// Keep her chat muted (phone stays quiet) while the bot still replies.
async function ensureMuted(client, quiet) {
  if (!config.MUTE_TARGET_CHAT) return false;
  try {
    const chat = await client.getChatById(TARGET_ID);
    if (!chat.isMuted) {
      // Mute "forever" (far-future date; works across web.js versions).
      await chat.mute(new Date("2999-01-01T00:00:00Z"));
      log("Her chat is now muted (notifications off; bot still replies).");
    }
    return true;
  } catch (err) {
    if (!quiet) log("Chat not mutable yet (will retry):", err.message || err);
    return false;
  }
}

// On startup her chat may still be syncing. Keep trying quietly until it's
// muted, then stop. (Her chat may not exist on this session until it syncs
// or she first messages; this makes "mute always" apply on its own.)
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
  // Quick burst right after startup...
  [2000, 15000, 45000, 120000].forEach((ms) => setTimeout(() => attempt(true), ms));
  // ...then keep checking every 5 minutes until it succeeds.
  const poll = setInterval(() => attempt(true), 5 * 60 * 1000);
}

// ---------- WhatsApp client ----------

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, ".wwebjs_auth") }),
  // Pin a known-good WhatsApp Web build (avoids the "reading 'Socket'" inject error).
  webVersion: "2.3000.1054108093",
  webVersionCache: {
    type: "local",
    path: path.join(__dirname, ".wwebjs_cache"),
  },
  puppeteer: {
    headless: true,
    // CHROME_PATH env var wins (used on the Linux server), then config, then
    // puppeteer's own default.
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
  // Save a scannable PNG (reliable on Windows terminals)...
  qrcodeImage.toFile(QR_IMAGE_PATH, qr, { width: 400 }, (err) => {
    if (err) {
      log("Could not save qr.png:", err.message);
    } else {
      log(`QR code saved. OPEN THIS IMAGE AND SCAN IT:  ${QR_IMAGE_PATH}`);
    }
  });
  // ...and also try to print it in the terminal as a fallback.
  console.log("\n(If the image doesn't open, scan this instead:)\n");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("authenticated", () => log("Authenticated — session saved."));

client.on("ready", async () => {
  log("Bot is ready and listening.");
  log(`Watching for messages from: ${config.TARGET_NUMBER}  (${TARGET_ID})`);
  log(
    `Reply delay: random ${config.MIN_DELAY_MINUTES}-${config.MAX_DELAY_MINUTES} minutes. ` +
      `Respuestas contextuales en español (intents.js).`
  );
  muteWithRetries(client);
});

client.on("auth_failure", (m) => log("AUTH FAILURE:", m));
client.on("disconnected", (r) => log("Disconnected:", r));

client.on("message", async (msg) => {
  // Only react to messages FROM the target, in a 1-on-1 chat (not groups).
  if (msg.from !== TARGET_ID) return;
  if (msg.fromMe) return;

  if (!config.REPLY_TO_NON_TEXT && msg.type !== "chat") {
    log(`Ignored non-text message (type: ${msg.type}).`);
    return;
  }

  const incomingText = msg.body || "";
  ensureMuted(client, true); // re-mute if it ever got turned back on (chat exists now)
  const delay = randomDelayMs();
  log(
    `Mensaje recibido: "${incomingText}". Respondo en ${(delay / 60000).toFixed(2)} min.`
  );

  setTimeout(() => {
    sendReply(client, incomingText).catch((err) => log("Reply error:", err.message));
  }, delay);
});

log("Starting WhatsApp auto-reply bot...");
client.initialize();
