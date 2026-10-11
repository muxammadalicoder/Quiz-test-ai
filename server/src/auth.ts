import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./store.js";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (data: string) => createHmac("sha256", sessionSecret()).update(data).digest("base64url");
const TTL = 1000 * 60 * 60 * 24 * 30;

export function makeToken(userId: string) {
  const body = b64(JSON.stringify({ u: userId, e: Date.now() + TTL }));
  return `${body}.${sign(body)}`;
}
export function readToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const good = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.e > Date.now() && typeof p.u === "string" ? p.u : null;
  } catch { return null; }
}

export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
/** Telegram initData ni rasmiy usulda tekshiradi (HMAC-SHA256, bot tokeni bilan). */
export function verifyInitData(initData: unknown, botToken: string): TgUser | null {
  if (typeof initData !== "string" || initData.length > 4096 || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", key).update(check).digest("hex");
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > 60 * 60 * 24) return null; // 24 soatdan eski bo'lmasin
  try { const u = JSON.parse(params.get("user") || ""); return typeof u.id === "number" ? u : null; } catch { return null; }
}
