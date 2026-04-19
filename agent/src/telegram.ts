// ---------------------------------------------------------------------------
// Telegram Bot notifier
// ---------------------------------------------------------------------------
// Uses the Telegram Bot HTTP API directly — no extra dependency needed.
//
// Setup:
//   1. Message @BotFather on Telegram → /newbot → get TELEGRAM_BOT_TOKEN
//   2. Add the bot to a group chat (or use a personal chat)
//   3. Send any message in the chat, then call:
//      https://api.telegram.org/bot<TOKEN>/getUpdates
//      to find your TELEGRAM_CHAT_ID
//   4. Set both in agent/.env
//
// All group notifications are sent to the single configured chat.
// Members see their wallet address (truncated) in the message so they
// know which action is addressed to them.
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? "";

const API_BASE  = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Send a plain-text or Markdown message to the configured chat.
 * Silently no-ops if the bot token or chat ID are not configured.
 */
export async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[telegram] Not configured — skipping notification.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    CHAT_ID,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[telegram] Failed to send message: ${err}`);
    }
  } catch (err) {
    console.warn("[telegram] Network error:", err);
  }
}

/** Truncate a Stellar address for display: GABC…XYZ */
export function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
