// Telegram bot (long polling, qo'shimcha kutubxonasiz). /start bosilganda mini ilovani ochish tugmasi chiqadi.
const TOKEN = process.env.BOT_TOKEN || "";
const URL_ = (process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const api = async (method: string, body: unknown) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return r.json() as Promise<any>;
};
export async function startBot() {
  if (!TOKEN || !URL_.startsWith("https://")) { console.log("Bot o‘chiq: BOT_TOKEN va HTTPS WEBAPP_URL kerak."); return; }
  try {
    await api("deleteWebhook", {});
    await api("setChatMenuButton", { menu_button: { type: "web_app", text: "O‘ynash", web_app: { url: URL_ } } });
    await api("setMyCommands", { commands: [{ command: "start", description: "Quiz Arena’ni ochish" }] });
  } catch (e) { console.error("Bot sozlanmadi", e); }
  let offset = 0;
  (async function loop() {
    for (;;) {
      try {
        const res = await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
        for (const up of res.result || []) {
          offset = up.update_id + 1;
          const chat = up.message?.chat;
          if (chat?.type === "private") {
            await api("sendMessage", {
              chat_id: chat.id,
              text: "🎮 Quiz Arena’ga xush kelibsiz!\nTest yarating, do‘stlar bilan ommaviy o‘yin o‘ynang va g‘olib bo‘ling 🏆",
              reply_markup: { inline_keyboard: [[{ text: "▶️ O‘ynash", web_app: { url: URL_ } }]] }
            });
          }
        }
      } catch { await new Promise(r => setTimeout(r, 3000)); }
    }
  })();
  console.log("Telegram bot ishga tushdi.");
}
