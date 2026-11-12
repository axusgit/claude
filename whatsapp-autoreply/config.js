// ============================================================
//  EDIT THIS FILE — these are the only settings you need.
// ============================================================

module.exports = {
  // Her phone number in full international format, digits only
  // (country code + number, NO "+", NO spaces, NO dashes).
  // Example for a US number +1 (813) 555-1234  ->  "18135551234"
  TARGET_NUMBER: "12392650465",

  // How long to wait before replying, in MINUTES.
  // The bot waits a random amount between these two values each time.
  MIN_DELAY_MINUTES: 3,
  MAX_DELAY_MINUTES: 5,

  // Set true to also reply to picture/voice/etc. messages from her,
  // or false to only reply when she sends a text message.
  REPLY_TO_NON_TEXT: true,

  // true = keep her chat muted (your phone won't buzz) while the bot still
  // replies. The bot re-mutes automatically if it ever gets unmuted.
  MUTE_TARGET_CHAT: true,

  // Path to a Chrome/Chromium browser for the bot to use.
  // (Set because puppeteer's bundled Chromium didn't download.)
  CHROME_PATH: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};
