// Groq (OpenAI bilan mos API): matn modellari + Whisper (ovozni matnga aylantirish).
// Kalit faqat serverda: GROQ_API_KEY. Groq o‘zbekcha ovoz CHIQARMAYDI (TTS faqat inglizcha/arabcha) — ovoz ai.ts da alohida.
import { looksUzbek, plainText } from "./uz.js";

export const GROQ_KEY = process.env.GROQ_API_KEY || "";
export const groqEnabled = !!GROQ_KEY;
const BASE = "https://api.groq.com/openai/v1";

const uniq = (a: (string | undefined)[]) => [...new Set(a.filter((x): x is string => !!x && x.trim().length > 0).map(x => x.trim()))];
export const groqModelA = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
export const groqModelB = process.env.GROQ_MODEL_2 || "llama-3.3-70b-versatile";
/** Matn uchun modellar tartibi (oldingisi ishlamasa keyingisi sinaladi). */
export const GROQ_TEXT_MODELS = uniq([groqModelA, groqModelB, "openai/gpt-oss-20b"]);
/** Asboblar (tool use) bilan ishlash uchun: Llama 3.3 eng ishonchli. */
export const GROQ_TOOL_MODELS = uniq([process.env.GROQ_TOOL_MODEL, "llama-3.3-70b-versatile", "openai/gpt-oss-120b"]);
export const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3";

export let groqLastError = "";

export type ChatMsg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: any[]; tool_call_id?: string };
export type ChatOpts = { models?: string[]; temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number; tools?: any[]; effort?: "low" | "medium" | "high" };
export type ChatResult = { text: string; message: any; model: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Groq chat so‘rovi. Model ishlamasa yoki limit tugasa keyingi modelga o‘tadi. Hammasi yiqilsa null (sabab groqLastError da). */
export async function groqChat(messages: ChatMsg[], o: ChatOpts = {}): Promise<ChatResult | null> {
  if (!groqEnabled) { groqLastError = "GROQ_API_KEY sozlanmagan."; return null; }
  const models = o.models && o.models.length ? o.models : GROQ_TEXT_MODELS;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30000);
      try {
        const body: any = { model, messages, temperature: o.temperature ?? 0.3, max_completion_tokens: o.maxTokens ?? 1500 };
        if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = o.effort || "low";
        if (o.tools?.length) { body.tools = o.tools; body.tool_choice = "auto"; }
        else if (o.json) body.response_format = { type: "json_object" };
        const r = await fetch(`${BASE}/chat/completions`, {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_KEY}` },
          body: JSON.stringify(body)
        });
        clearTimeout(timer);
        if (r.status === 429 || r.status >= 500) {
          const t = (await r.text().catch(() => "")).slice(0, 300);
          groqLastError = r.status === 429 ? "Groq limiti vaqtincha tugadi (1 daqiqadan keyin qayta urinib ko‘ring)." : `Groq serveri xatosi (${r.status}).`;
          console.error("Groq xato:", model, r.status, t);
          if (attempt === 0) { await sleep(r.status === 429 ? 2500 : 800); continue; }
          break; // keyingi modelga
        }
        if (!r.ok) {
          const t = (await r.text().catch(() => "")).slice(0, 400);
          groqLastError = `Groq xatosi ${r.status}: ${t.slice(0, 160)}`;
          console.error("Groq xato:", model, r.status, t);
          break; // 400/401/404: bu model yaroqsiz, keyingisiga
        }
        const j: any = await r.json();
        const message = j?.choices?.[0]?.message;
        if (!message) { groqLastError = "Groq bo‘sh javob qaytardi."; break; }
        groqLastError = "";
        return { text: String(message.content || "").trim(), message, model };
      } catch (e) {
        clearTimeout(timer);
        groqLastError = "Groq bilan aloqa uzildi.";
        console.error("Groq so‘rov xatosi:", model, String(e));
        if (attempt === 0) await sleep(500);
      }
    }
  }
  return null;
}

/** O‘zbekcha javob: til tekshiriladi, begona yozuv/ingliz aralashsa boshqa model bilan qayta uriniladi. */
export async function uzChat(messages: ChatMsg[], o: ChatOpts = {}): Promise<string | null> {
  const models = o.models && o.models.length ? o.models : GROQ_TEXT_MODELS;
  const first = await groqChat(messages, { ...o, models });
  if (!first) return null;
  if (o.json || looksUzbek(first.text)) return first.text;
  const reminder: ChatMsg = { role: "system", content: "ESLATMA: oldingi javobda o‘zbekcha bo‘lmagan so‘zlar yoki yozuv bor edi. Javobni FAQAT lotin yozuvidagi sof o‘zbek tilida qayta yoz." };
  const second = await groqChat([...messages, reminder], { ...o, models: [...models].reverse(), temperature: 0.2 });
  if (second && looksUzbek(second.text)) return second.text;
  return plainText((second || first).text).replace(/[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0600-\u06FF]+/g, " ").replace(/\s+/g, " ").trim();
}

const HALLUCINATIONS = [/amara\.org/i, /subtitles? by/i, /thanks? for watching/i, /subscribe/i, /спасибо за просмотр/i, /продолжение следует/i, /субтитры/i, /obuna bo.?ling/i, /tomosha qilganingiz uchun/i];

/** Whisper orqali ovozni o‘zbekcha matnga aylantiradi. Bo‘sh/shovqin bo‘lsa "" qaytadi, xatoda null. */
export async function groqTranscribe(audio: Buffer, mime: string, o: { prompt?: string; model?: string; language?: string } = {}): Promise<string | null> {
  if (!groqEnabled) { groqLastError = "GROQ_API_KEY sozlanmagan."; return null; }
  const m = mime.toLowerCase();
  const ext = m.includes("webm") ? "webm" : m.includes("ogg") ? "ogg" : m.includes("wav") ? "wav" : m.includes("mpeg") ? "mp3" : m.includes("m4a") || m.includes("aac") ? "m4a" : m.includes("mp4") ? "mp4" : "webm";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime.split(";")[0] || "audio/webm" }), `audio.${ext}`);
      form.append("model", o.model || GROQ_STT_MODEL);
      form.append("language", o.language || "uz");
      form.append("response_format", "json");
      form.append("temperature", "0");
      if (o.prompt) form.append("prompt", o.prompt.slice(0, 500));
      const r = await fetch(`${BASE}/audio/transcriptions`, { method: "POST", signal: ctrl.signal, headers: { authorization: `Bearer ${GROQ_KEY}` }, body: form });
      clearTimeout(timer);
      if (r.status === 429 || r.status >= 500) {
        groqLastError = r.status === 429 ? "Groq ovoz limiti vaqtincha tugadi." : `Groq serveri xatosi (${r.status}).`;
        console.error("Whisper xato:", r.status, (await r.text().catch(() => "")).slice(0, 200));
        if (attempt === 0) { await sleep(1500); continue; }
        return null;
      }
      if (!r.ok) {
        const t = (await r.text().catch(() => "")).slice(0, 300);
        groqLastError = `Whisper xatosi ${r.status}`;
        console.error("Whisper xato:", r.status, t);
        return null;
      }
      const j: any = await r.json();
      const text = String(j?.text || "").trim();
      groqLastError = "";
      if (HALLUCINATIONS.some(re => re.test(text))) return "";
      return text;
    } catch (e) {
      clearTimeout(timer);
      groqLastError = "Groq bilan aloqa uzildi.";
      console.error("Whisper so‘rov xatosi:", String(e));
      if (attempt === 0) await sleep(500);
    }
  }
  return null;
}
