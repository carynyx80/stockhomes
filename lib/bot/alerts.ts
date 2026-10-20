import type { AlertPort } from "./types";

/** Telegram alerts. Unconfigured → messages go to the server log only. Never includes secrets. */
export function telegramAlerts(cfg: { token: string; chatId: string } | null, fetchImpl: typeof fetch = fetch): AlertPort {
  return {
    async send(text) {
      if (!cfg) {
        console.log(`[fee-bot alert] ${text}`);
        return;
      }
      const res = await fetchImpl(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) console.error(`[fee-bot] Telegram alert failed with HTTP ${res.status}`);
    },
  };
}
