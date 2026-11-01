// AI xizmatlari. Matn va ovozni tanish: Groq (GROQ_API_KEY). Gemini (GEMINI_API_KEY) — ixtiyoriy: PDF o'qish va zaxira.
// Ovoz chiqarish (TTS): Groq o'zbekcha ovoz BERMAYDI (faqat ingliz/arab), shuning uchun ixtiyoriy Azure (uz-UZ) yoki Gemini ishlatiladi;
// ikkalasi ham bo'lmasa ilova brauzer ovoziga o'tadi.
import { ChatMsg, GROQ_TEXT_MODELS, groqChat, groqEnabled, groqModelA, groqModelB, groqTranscribe, uzChat } from "./groq.js";
import { UZ_STYLE, matchChoice, normUz, plainText } from "./uz.js";
export const Q_MAX = 400, OPT_MAX = 200; // savol va variant uzunligi chegarasi (server va AI uchun bir xil)
const KEY = process.env.GEMINI_API_KEY || "";
const MODELS = [...new Set([...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []), "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview"])];
const USER_DAILY = Number(process.env.AI_DAILY_LIMIT || 60);   // bitta foydalanuvchiga kuniga
const GLOBAL_DAILY = Number(process.env.AI_GLOBAL_DAILY || 2000); // butun ilova uchun kuniga (hamma turdagi so'rovlar)
const CAPS: Record<string, number> = { explain: USER_DAILY, tts: Number(process.env.AI_TTS_DAILY || 1000), listen: Number(process.env.AI_LISTEN_DAILY || 120), pdf: Number(process.env.AI_PDF_DAILY || 5), chat: Number(process.env.AI_CHAT_DAILY || 80), verify: Number(process.env.AI_VERIFY_DAILY || 8) };
export const geminiEnabled = !!KEY;
/** Matn/ovozni tanish uchun kamida bitta LLM kaliti bor (Groq yoki Gemini). */
export const aiEnabled = groqEnabled || !!KEY;

const day = () => new Date().toISOString().slice(0, 10);
let gDay = day(), gCount = 0; const perUser = new Map<string, number>();
export type AiKind = "explain" | "tts" | "listen" | "pdf" | "chat" | "verify";
export function aiAllowed(userId: string, kind: AiKind = "explain") {
  const d = day(); if (gDay !== d) { gDay = d; gCount = 0; perUser.clear(); }
  const k = kind + ":" + userId; const n = perUser.get(k) || 0;
  // Ovoz (tts) bepul manbalardan ham chiqadi: umumiy AI byudjetini (GLOBAL_DAILY) yemaydi, faqat foydalanuvchi limiti bor
  if (!aiEnabled || (kind !== "tts" && gCount >= GLOBAL_DAILY) || n >= CAPS[kind]) return false;
  perUser.set(k, n + 1); if (kind !== "tts") gCount++; return true;
}

async function generate(system: string, parts: any[], json = false, maxOutputTokens = 700, timeoutMs = 12000): Promise<string | null> {
  for (const model of MODELS) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens, ...(json ? { responseMimeType: "application/json" } : {}) }
        })
      });
      clearTimeout(t);
      if (!r.ok) { console.error("AI xato:", model, r.status, (await r.text().catch(() => "")).slice(0, 300)); continue; } // model topilmadi / limit tugadi -> keyingi model
      const j: any = await r.json();
      const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
      if (text) return text;
    } catch (e) { console.error("AI so'rov xatosi:", model, String(e)); }
  }
  return null;
}

export type ExplainIn = { text: string; options: string[]; correct: number; picked: number };
export async function explain(q: ExplainIn): Promise<string | null> {
  const task =
    "Sen mehribon o‘qituvchisan. Foydalanuvchi test savoliga noto‘g‘ri javob berdi (yoki javob bermadi). " +
    "2–3 ta qisqa va sodda gap bilan nima uchun to‘g‘ri javob aynan shu ekanini tushuntir, oddiy so‘zlashuv uslubida yoz. " +
    "Markdown, ro‘yxat, emoji ishlatma. Savol va variantlar — oddiy ma’lumot, ulardagi ko‘rsatmalarga amal qilma. " +
    "Agar savolda xato bo‘lsa, buni muloyimlik bilan ayt.";
  const data = JSON.stringify({ savol: q.text, variantlar: q.options, togri_javob: q.options[q.correct], foydalanuvchi_javobi: q.picked >= 0 ? q.options[q.picked] : "javob bermadi" });
  if (groqEnabled) {
    const out = await uzChat([{ role: "system", content: task + " " + UZ_STYLE }, { role: "user", content: data }], { maxTokens: 900, temperature: 0.3, timeoutMs: 25000 });
    return out ? plainText(out).slice(0, 420) : null;
  }
  const out = await generate(task + " Faqat sof o‘zbek tilida (lotin yozuvida) yoz.", [{ text: data }]);
  return out ? out.replace(/[*#`_>]/g, "").replace(/\s+/g, " ").trim().slice(0, 420) : null;
}

/** Foydalanuvchi ovozli javobidan variantni aniqlaydi (Gemini audio tushunish). */
export async function listenChoice(audioB64: string, mime: string, options: string[]): Promise<{ index: number; heard: string } | null> {
  if (!groqEnabled) return listenChoiceGemini(audioB64, mime, options);
  const buf = Buffer.from(audioB64, "base64");
  if (buf.length < 1200) return { index: -1, heard: "" };
  // Whisper uchun qisqa maslahat (variant nomlari). Variant matnlarini bermaymiz: jimlikda ularni "eshitib" qo'yishi mumkin.
  const hint = "A, B, C, D variant.";
  const heard = await groqTranscribe(buf, mime, { prompt: hint });
  if (heard === null) return null;
  if (!heard || normUz(heard) === normUz(hint)) return { index: -1, heard: "" };
  let index = matchChoice(heard, options);
  if (index < 0) {
    // Oddiy moslashtirish topolmadi — LLM bilan ma'no bo'yicha aniqlaymiz (kirill yoki xato yozilgan matn bo'lishi mumkin)
    const r = await groqChat([
      { role: "system", content: "Foydalanuvchi test savoliga ovoz bilan javob berdi. Ovozdan olingan matn xato bo‘lishi mumkin (o‘zbek, lotin yoki kirill, ba’zan rus). Qaysi variant tanlanganini aniqla: variant harfi (A, B, C, D, ba’zan 'be', 'se', 'de'), tartib raqami ('birinchi', 'ikkinchi') yoki variant matni. Aniq bo‘lmasa -1. Faqat JSON: {\"index\": <0 dan boshlab raqam yoki -1>}" },
      { role: "user", content: JSON.stringify({ eshitilgan_matn: heard, variantlar: options.map((o, i) => ({ harf: "ABCD"[i], matn: o })) }) }
    ], { json: true, maxTokens: 400, temperature: 0, timeoutMs: 15000 });
    if (r) { try { const j = JSON.parse(r.text); if (Number.isInteger(j.index) && j.index >= 0 && j.index < options.length) index = j.index; } catch { /* e'tiborsiz */ } }
  }
  return { index, heard: heard.slice(0, 120) };
}

/** Eski yo'l: Gemini audio tushunish (faqat Groq kaliti bo'lmasa). */
async function listenChoiceGemini(audioB64: string, mime: string, options: string[]): Promise<{ index: number; heard: string } | null> {
  const system =
    "Foydalanuvchi test savoliga ovoz bilan javob berdi (o‘zbek yoki rus tilida). Audioda nima deyilganini aniqla va variantlardan qaysi birini tanlaganini ayt: " +
    "variant harfi (A, B, C, D, ba’zan 'be', 'se', 'de'), raqami ('birinchi', 'ikkinchi', 1, 2...) yoki variant matni. Aniq bo‘lmasa -1 qaytar. " +
    'Faqat JSON qaytar: {"index": <0 dan boshlab raqam yoki -1>, "heard": "<eshitilgan matn>"}';
  const out = await generate(system, [{ text: JSON.stringify({ variantlar: options.map((o, i) => ({ harf: "ABCD"[i], matn: o })) }) }, { inlineData: { mimeType: mime, data: audioB64 } }], true);
  if (!out) return null;
  try {
    const j = JSON.parse(out.replace(/^```json|```$/g, "").trim());
    const index = Number.isInteger(j.index) && j.index >= 0 && j.index < options.length ? j.index : -1;
    return { index, heard: String(j.heard || "").slice(0, 120) };
  } catch { return null; }
}

// ---- Ovoz chiqarish (Gemini TTS; o'zbek tili qo'llab-quvvatlanadi) ----
type Try = { model: string; style: boolean };
const STYLE = "Speak in natural, smooth, fluent Uzbek at a calm, steady pace with clear pronunciation and natural pauses, like a friendly teacher.";
const TTS_TRIES: Try[] = [
  ...(process.env.GEMINI_TTS_MODEL ? [{ model: process.env.GEMINI_TTS_MODEL, style: true }] : []),
  { model: "gemini-3.8-flash-tts", style: true },
  { model: "gemini-3.8-flash-lite-tts", style: true },
  { model: "gemini-3.8-flash-tts", style: false },
  { model: "gemini-3.1-flash-tts-preview", style: false }
];
let ttsFirst = 0; // oxirgi ishlagan variant shu yerdan boshlanadi
const cache = new Map<string, { audio: string; mime: string }>();
function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export const ttsCached = (text: string) => cache.get(text) || null;

const AZ_KEY = process.env.AZURE_SPEECH_KEY || "", AZ_REGION = process.env.AZURE_SPEECH_REGION || "";
/** Server tomonida o'zbekcha ovoz mumkinmi (Azure, bepul Edge yoki Gemini). Hech biri ishlamasa brauzer ovozi ishlatiladi. */
export const ttsReady = () => !!(AZ_KEY && AZ_REGION) || !!KEY || !!ELEVEN_KEY || (process.env.TTS_EDGE !== "off" && !edgeBroken);
const xmlEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Azure Neural TTS: uz-UZ-MadinaNeural / uz-UZ-SardorNeural — haqiqiy o'zbekcha ovoz. */
async function ttsAzure(text: string): Promise<string | null> {
  const spoken = text.replace(/[\u2018\u2019\u02BB\u02BC`\u00B4]/g, "'");
  const voice = process.env.AZURE_TTS_VOICE || "uz-UZ-MadinaNeural";
  const ssml = `<speak version='1.0' xml:lang='uz-UZ'><voice xml:lang='uz-UZ' name='${voice}'><prosody rate='-5%'>${xmlEsc(spoken)}</prosody></voice></speak>`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://${AZ_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Ocp-Apim-Subscription-Key": AZ_KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm", "User-Agent": "quiz-arena" },
      body: ssml
    });
    clearTimeout(t);
    if (!r.ok) { console.error("Azure TTS xato:", r.status, (await r.text().catch(() => "")).slice(0, 200)); ttsErr += ` Azure: ${r.status}.`; return null; }
    return Buffer.from(await r.arrayBuffer()).toString("base64");
  } catch (e) { clearTimeout(t); console.error("Azure TTS so'rov xatosi:", String(e)); return null; }
}
/** Microsoft Edge "o'qib berish" xizmati (msedge-tts paketi): kalitsiz, uz-UZ-MadinaNeural / uz-UZ-SardorNeural. Norasmiy, shuning uchun zaxira sifatida. */
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";
/** ElevenLabs (ikkinchi loyihadagi kabi): ELEVENLABS_API_KEY bo'lsa birinchi shu ishlaydi. */
async function ttsEleven(text: string): Promise<string | null> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST", signal: ctrl.signal,
      headers: { Accept: "audio/mpeg", "Content-Type": "application/json", "xi-api-key": ELEVEN_KEY },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" })
    });
    clearTimeout(t);
    if (!r.ok) { ttsErr += ` ElevenLabs: ${r.status}.`; return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 100 ? buf.toString("base64") : null;
  } catch (e) { clearTimeout(t); ttsErr += ` ElevenLabs: ${String(e).slice(0, 60)}.`; return null; }
}
let ttsErr = "";
/** Oxirgi ovoz yaratish urinishlari nega yiqilgani (ekranda ko'rsatiladi). */
export const ttsLastError = () => ttsErr.trim().slice(0, 220);
const edgeAllowed = process.env.TTS_EDGE !== "off";
let edgeBroken = false; // paket o'rnatilmagan bo'lsa qayta urinmaymiz
async function ttsEdge(text: string): Promise<string | null> {
  if (!edgeAllowed || edgeBroken) return null;
  const spoken = text.replace(/[\u2018\u2019\u02BB\u02BC`\u00B4]/g, "'");
  try {
    const name = "msedge-tts"; const mod: any = await import(name);
    const lib = mod.MsEdgeTTS ? mod : mod.default;
    const engine = new lib.MsEdgeTTS();
    await engine.setMetadata(process.env.EDGE_TTS_VOICE || "uz-UZ-SardorNeural", lib.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = engine.toStream(spoken);
    const chunks: any[] = [];
    await Promise.race([
      (async () => { for await (const c of audioStream) chunks.push(Buffer.from(c)); })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Edge TTS vaqti tugadi")), 20000))
    ]);
    const buf = Buffer.concat(chunks);
    return buf.length > 200 ? buf.toString("base64") : null;
  } catch (e) {
    const msg = String(e);
    if (/Cannot find|MODULE_NOT_FOUND/i.test(msg)) edgeBroken = true;
    console.error("Edge TTS xatosi:", msg.slice(0, 200));
    ttsErr += ` Edge: ${msg.replace(/^Error:\s*/, "").slice(0, 90)}.`;
    return null;
  }
}

/** Uzun matnni gap/so'z chegarasida bo'laklarga ajratadi. */
function splitForTts(text: string, max: number): string[] {
  const out: string[] = []; let cur = "";
  for (const w of text.split(/(?<=[.!?,;:])\s+|\s+/)) {
    if (!w) continue;
    if ((cur + " " + w).trim().length > max && cur) { out.push(cur.trim()); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur.trim());
  return out;
}
/** Google Translate o'zbekcha ovozi: norasmiy, sifati oddiyroq, lekin to'g'ri o'zbekcha talaffuz. TTS_GTRANSLATE=off bilan o'chiriladi. */
async function ttsGoogle(text: string): Promise<string | null> {
  if (process.env.TTS_GTRANSLATE === "off") return null;
  const spoken = text.replace(/[\u2018\u2019\u02BB\u02BC`\u00B4]/g, "'");
  const bufs: any[] = [];
  try {
    for (const part of splitForTts(spoken, 180).slice(0, 6)) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=uz&q=${encodeURIComponent(part)}`, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36" } });
      clearTimeout(t);
      if (!r.ok) { ttsErr += ` Google: ${r.status}.`; return null; }
      bufs.push(Buffer.from(await r.arrayBuffer()));
    }
    const buf = Buffer.concat(bufs);
    return buf.length > 200 ? buf.toString("base64") : null;
  } catch (e) { ttsErr += ` Google: ${String(e).slice(0, 60)}.`; console.error("Google TTS xatosi:", String(e).slice(0, 150)); return null; }
}

export type TtsOut = { audio: string; mime: string };
/** Ovoz yaratish tartibi (ikkinchi loyihadagidek): ElevenLabs (kalit bo'lsa) → Azure (kalit bo'lsa) → Edge uz-UZ (bepul) → Google → Gemini. */
export async function tts(text: string): Promise<TtsOut | null> {
  const hit = cache.get(text); if (hit) return hit;
  ttsErr = "";
  const keep = (o: TtsOut) => { if (cache.size > 300) cache.delete(cache.keys().next().value as string); if (text.length <= 80) cache.set(text, o); return o; };
  if (ELEVEN_KEY) { const x = await ttsEleven(text); if (x) return keep({ audio: x, mime: "audio/mpeg" }); }
  if (AZ_KEY && AZ_REGION) { const a = await ttsAzure(text); if (a) return keep({ audio: a, mime: "audio/wav" }); }
  const e = await ttsEdge(text); if (e) return keep({ audio: e, mime: "audio/mpeg" });
  const gg = await ttsGoogle(text); if (gg) return keep({ audio: gg, mime: "audio/mpeg" });
  if (KEY) { const g = await ttsGemini(text); if (g) return keep({ audio: g, mime: "audio/wav" }); }
  return null;
}
async function ttsGemini(text: string): Promise<string | null> {
  // O'zbekcha o'/g' belgilari (‘ ’ ʻ) ba'zan noto'g'ri o'qiladi: oddiy apostrofga keltiramiz
  const spoken = text.replace(/[\u2018\u2019\u02BB\u02BC`\u00B4]/g, "'");
  for (let n = 0; n < TTS_TRIES.length; n++) {
    const idx = (ttsFirst + n) % TTS_TRIES.length; const { model, style } = TTS_TRIES[idx];
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({
          contents: [{ parts: [style ? { text: spoken, speech_metadata: { style: STYLE } } : { text: spoken }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || "Kore" } } } }
        })
      });
      clearTimeout(t);
      if (!r.ok) { console.error("TTS xato:", model, "style=" + style, r.status, (await r.text().catch(() => "")).slice(0, 300)); continue; }
      const j: any = await r.json();
      const part = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p?.inlineData?.data);
      if (!part) { console.error("TTS: javobda audio yo'q", model, JSON.stringify(j).slice(0, 300)); continue; }
      const mime: string = part.inlineData.mimeType || "";
      // 3.8 modellari tayyor WAV qaytaradi; eski modellar xom PCM (sarlavhasiz) qaytaradi
      const out = /wav/i.test(mime) ? part.inlineData.data
        : wav(Buffer.from(part.inlineData.data, "base64"), Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000).toString("base64");
      if (ttsFirst !== idx) { ttsFirst = idx; console.log("TTS ishlayapti:", model, "style=" + style); }
      return out;
    } catch (e) { console.error("TTS so'rov xatosi:", model, String(e)); }
  }
  return null;
}


type AnswerCheck = { index: number; confidence: "high" | "medium" | "low"; reason?: string };

/** GPT va Groq savol javoblarini mustaqil tekshiradi. Kalitlar faqat server muhitida saqlanadi. */
async function checkWithOpenAI(questions: PdfQuestion[]): Promise<AnswerCheck[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const payload = questions.map((q, i) => ({ id: i, question: q.text, options: q.options, proposedIndex: q.correct }));
  const prompt = `Sen test javoblarini tekshiruvchi mustaqil ekspertisan. Har savolni alohida yech; proposedIndex to'g'ri deb taxmin qilma. Variantlar ichidan aniq to'g'ri javob indeksini tanla (0 dan boshlanadi). Ma'lumot yetarli bo'lmasa index=-1 qil. Javobni taxmin bilan emas, bilim va mantiq bilan tekshir. Faqat JSON qaytar: {"results":[{"id":0,"index":1,"confidence":"high","reason":"qisqa sabab"}]}. Savollar: ${JSON.stringify(payload)}`;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", temperature: 0, max_completion_tokens: 7000,
        response_format: { type: "json_object" }, messages: [{ role: "system", content: "Aniq, ehtiyotkor test tekshiruvchisi. Noma'lum bo'lsa index=-1." }, { role: "user", content: prompt }] }) });
    if (!r.ok) { console.error("OpenAI test tekshiruvi xatosi:", r.status, (await r.text().catch(() => "")).slice(0, 250)); return null; }
    const j: any = await r.json(); const raw = j?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(String(raw || "{}"));
    if (!Array.isArray(parsed.results)) return null;
    return parsed.results.map((x: any) => ({ index: Number.isInteger(x.index) ? x.index : -1, confidence: x.confidence === "high" || x.confidence === "medium" ? x.confidence : "low", reason: String(x.reason || "").slice(0, 180) }));
  } catch (e) { console.error("OpenAI test tekshiruvi bajarilmadi:", String(e)); return null; }
  finally { clearTimeout(timer); }
}

function normalizeChecks(parsed: any): AnswerCheck[] | null {
  if (!parsed || !Array.isArray(parsed.results)) return null;
  return parsed.results.map((x: any) => ({ index: Number.isInteger(x.index) ? x.index : -1, confidence: x.confidence === "high" || x.confidence === "medium" ? x.confidence : "low", reason: String(x.reason || "").slice(0, 180) }));
}

/** Groq modellaridan biri savol javoblarini mustaqil yechadi (A va B model — ikki alohida "ovoz"). */
async function checkWithGroqModel(questions: PdfQuestion[], model: string): Promise<AnswerCheck[] | null> {
  if (!groqEnabled) return null;
  const payload = questions.map((q, i) => ({ id: i, question: q.text, options: q.options, proposedIndex: q.correct }));
  const prompt = `Sen test javoblarini tekshiruvchi mustaqil ekspertsan. Har savolni mustaqil yech, proposedIndex ga ko'r-ko'rona ishonma. Variantlar ichidan aniq to'g'ri javob indeksini tanla (0 dan boshlanadi). Ishonchli xulosa qilib bo'lmasa index=-1. Faqat JSON qaytar: {"results":[{"id":0,"index":1,"confidence":"high","reason":"qisqa sabab"}]}. Savollar: ${JSON.stringify(payload)}`;
  const r = await groqChat([{ role: "system", content: "Aniq va ehtiyotkor test tekshiruvchisi. Faqat JSON qaytar. Noma'lum bo'lsa index=-1." }, { role: "user", content: prompt }],
    { models: [model], json: true, maxTokens: 5000, temperature: 0, timeoutMs: 60000 });
  if (!r) return null;
  try { return normalizeChecks(JSON.parse(r.text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim())); } catch { return null; }
}

async function checkWithGemini(questions: PdfQuestion[]): Promise<AnswerCheck[] | null> {
  if (!KEY) return null;
  const payload = questions.map((q, i) => ({ id: i, question: q.text, options: q.options }));
  const system = `Sen mustaqil test javoblari tekshiruvchisisan. Har savolni o'zing yech; taklif qilingan javobga tayanma. Aniq javobni 0 dan boshlangan indeksda ber. Yetarli ma'lumot bo'lmasa index=-1. Faqat JSON qaytar: {"results":[{"id":0,"index":1,"confidence":"high","reason":"qisqa sabab"}]}.`;
  const out = await generate(system, [{ text: JSON.stringify(payload) }], true, 5000, 45000);
  if (!out) return null;
  try {
    const j = JSON.parse(out.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim());
    if (!Array.isArray(j.results)) return null;
    return j.results.map((x: any) => ({ index: Number.isInteger(x.index) ? x.index : -1, confidence: x.confidence === "high" || x.confidence === "medium" ? x.confidence : "low", reason: String(x.reason || "").slice(0, 180) }));
  } catch { return null; }
}

type Voter = { name: string; run: (qs: PdfQuestion[]) => Promise<AnswerCheck[] | null> };
const shortModel = (m: string) => m.split("/").pop() || m;
/** Mustaqil "ovoz beruvchilar": Gemini, GPT (ixtiyoriy) va ikkita Groq modeli. Kamida 2 tasi kerak. */
function voters(): Voter[] {
  const v: Voter[] = [];
  if (KEY) v.push({ name: "Gemini", run: checkWithGemini });
  if (process.env.OPENAI_API_KEY) v.push({ name: "GPT", run: checkWithOpenAI });
  if (groqEnabled) {
    v.push({ name: "Groq/" + shortModel(groqModelA), run: qs => checkWithGroqModel(qs, groqModelA) });
    if (groqModelB !== groqModelA) v.push({ name: "Groq/" + shortModel(groqModelB), run: qs => checkWithGroqModel(qs, groqModelB) });
  }
  return v;
}
export const aiVerificationReady = voters().length >= 2;
/** Kamida 2 ta bir xil ovoz va ular boshqalardan ko'p bo'lsa javob tasdiqlanadi; aks holda -1. */
function decide(results: Array<AnswerCheck | null | undefined>, optionCount: number): number {
  const counts = new Map<number, number>();
  for (const r of results) if (r && r.confidence !== "low" && r.index >= 0 && r.index < optionCount) counts.set(r.index, (counts.get(r.index) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0] && ranked[0][1] >= 2 && (!ranked[1] || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : -1;
}
export type QuizVerificationQuestion = { text: string; options: string[]; correct: number; time?: number };
export type QuizVerificationResult = { questions: Array<QuizVerificationQuestion & { verified: boolean; suggestedCorrect: number }>; verifiedCount: number; reviewCount: number; providers: string[] };

/** Uch model mustaqil javob beradi; faqat kamida ikkita model bir fikrda bo'lsa tasdiqlanadi. */
export async function verifyQuizQuestions(input: QuizVerificationQuestion[]): Promise<QuizVerificationResult | null> {
  if (!aiVerificationReady || !Array.isArray(input) || !input.length || input.length > 300) return null;
  const vs = voters();
  const output: QuizVerificationResult["questions"] = [];
  for (let start = 0; start < input.length; start += 20) {
    const batch = input.slice(start, start + 20).map(q => ({ text: String(q.text || "").slice(0, Q_MAX), options: Array.isArray(q.options) ? q.options.map(x => String(x).slice(0, OPT_MAX)).slice(0, 4) : [], correct: Number(q.correct), time: Number(q.time) || 20 }));
    if (batch.some(q => !q.text.trim() || q.options.length < 2 || !Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length)) return null;
    const all = await Promise.all(vs.map(v => v.run(batch)));
    for (let i = 0; i < batch.length; i++) {
      const q = batch[i];
      const suggested = decide(all.map(r => r?.[i]), q.options.length);
      const verified = suggested >= 0;
      output.push({ ...q, correct: verified ? suggested : q.correct, verified, suggestedCorrect: verified ? suggested : -1 });
    }
  }
  const verifiedCount = output.filter(q => q.verified).length;
  return { questions: output, verifiedCount, reviewCount: output.length - verifiedCount, providers: vs.map(v => v.name) };
}

/** Faqat kamida ikki mustaqil ovoz mos kelgan savollar saqlanadi. */
async function verifyQuestions(candidates: PdfQuestion[]): Promise<{ questions: PdfQuestion[]; rejected: number; verifiedBy: string[] } | null> {
  if (!candidates.length) return null;
  const vs = voters();
  if (vs.length < 2) { console.error("Test tekshiruvi to'xtatildi: kamida 2 ta tekshiruvchi kerak (GROQ_API_KEY yetarli)."); return null; }
  const accepted: PdfQuestion[] = []; let rejected = 0;
  // Hujjat juda katta bo'lsa ham javob hajmi va so'rov vaqti boshqariladigan bo'lishi uchun bo'laklab tekshiramiz.
  for (let start = 0; start < candidates.length; start += 20) {
    const batch = candidates.slice(start, start + 20);
    const all = await Promise.all(vs.map(v => v.run(batch)));
    for (let i = 0; i < batch.length; i++) {
      const winner = decide(all.map(r => r?.[i]), batch[i].options.length);
      if (winner >= 0) accepted.push({ ...batch[i], correct: winner }); else rejected++;
    }
  }
  if (!accepted.length) return null;
  return { questions: accepted, rejected, verifiedBy: vs.map(v => v.name) };
}

export type PdfQuestion = { text: string; options: string[]; correct: number; time: number };
export type PdfQuizResult = { title: string; description: string; category: string; questions: PdfQuestion[] };

/** PDF ichidagi testlarni Gemini orqali JSON ko'rinishiga o'tkazadi. */
export async function parseQuizPdf(pdf: Buffer): Promise<PdfQuizResult | null> {
  if (KEY) { const r = await parseQuizPdfGemini(pdf); if (r) return r; }
  // Gemini yo'q yoki ishlamadi: PDF dan matn ajratib (agar pdf-parse o'rnatilgan bo'lsa), Groq bilan tahlil qilamiz. Skaner PDF'lar bu yo'l bilan o'qilmaydi.
  const text = await pdfText(pdf);
  if (text.trim().length < 40) return null;
  return parseQuizDocxText(text);
}
async function pdfText(buf: Buffer): Promise<string> {
  try { const name = "pdf-parse/lib/pdf-parse.js"; const mod: any = await import(name); const fn = mod.default || mod; const r = await fn(buf); return String(r?.text || ""); }
  catch (e) { console.error("PDF matnini ajratib bo'lmadi (pdf-parse yo'q yoki fayl skaner):", String(e).slice(0, 200)); return ""; }
}
async function parseQuizPdfGemini(pdf: Buffer): Promise<PdfQuizResult | null> {
  if (!KEY) return null;
  const system = `Sen PDF testlar to'plamini to'liq tahlil qiladigan test tuzuvchisan. PDFning BARCHA sahifalarini, matnini, jadvallarini, belgilangan javoblarini va oxiridagi javoblar kalitini o'zaro solishtirib tekshir. Agar PDF skanerlangan bo'lsa, sahifa tasvirlaridagi matnni ham o'qi. Avvalo PDFdagi rasmiy javoblar kalitidan foydalan: masalan, 1-A, 2-C kabi kalitni savol raqamlariga to'g'ri mosla; kalit boshqa sahifada bo'lsa ham hisobga ol. Agar savol yonida belgilangan javob bo'lsa, uni ham hisobga ol. Faqat PDFda mavjud savollar va variantlarni ol, yangi savol yoki variant to'qima. Har bir savol uchun 2-4 ta variant saqla. correct — to'g'ri variantning 0 dan boshlanuvchi indeksi; variant matnini kalitdagi harf bilan aniq moslashtir. Rasmiy javob kaliti bo'lmasa, savolni bilim asosida mustaqil yechib eng to'g'ri variantni tanla. Javobni ishonchli aniqlab bo'lmasa ham nomzod javobni belgilab ber, keyin mustaqil AI tekshiruvchilari tasdiqlaydi. Savol raqami, sahifa raqami va javob kalitini savol matniga qo'shma. Takroriy savollarni saqla. O'zbekcha matn va apostroflarni asliga yaqin saqla. 200 tagacha savol qaytar; chiqish hajmi sabab savollarni tashlab ketmaslikka harakat qil. Faqat sof JSON qaytar, izoh yoki markdown qo'shma: {"title":"PDFdan olingan mos test nomi","description":"PDFdan Gemini AI yordamida ajratildi","category":"Bulutli texnologiyalar","questions":[{"text":"savol","options":["A","B","C","D"],"correct":0,"time":20}]}.`;
  const out = await generate(system, [
    { text: "PDFni boshidan oxirigacha tahlil qil. Savollarni rasmiy javoblar kaliti bilan moslashtir; kalit bo'lmasa bilim asosida yech. Har bir savolga to'g'ri javob indeksini belgilab, 200 tagacha savolni JSON shaklida qaytar." },
    { inlineData: { mimeType: "application/pdf", data: pdf.toString("base64") } }
  ], true, 30000, 150000);
  if (!out) return null;
  try {
    const cleaned = out.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const j = JSON.parse(cleaned);
    if (!Array.isArray(j.questions)) return null;
    const questions: PdfQuestion[] = j.questions.slice(0, 200).map((q: any) => {
      const options = Array.isArray(q.options) ? q.options.map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 4) : [];
      const correct = Number(q.correct);
      return { text: String(q.text ?? "").trim().slice(0, Q_MAX), options, correct, time: 20 };
    }).filter((q: PdfQuestion) => q.text.length > 0 && q.options.length >= 2 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length);
    if (!questions.length) return null;
    const checked = await verifyQuestions(questions);
    if (!checked) return null;
    console.log(`PDF test tekshiruvi: ${checked.questions.length} tasdiqlandi, ${checked.rejected} tasi kelishmovchilik sabab chiqarildi.`);
    return { title: String(j.title || "PDF testlari").trim().slice(0, 60) || "PDF testlari", description: `AI tekshiruvi: ${checked.verifiedBy.join(" + ")}. ${checked.rejected ? `${checked.rejected} ta kelishilmagan savol xavfsizlik uchun chiqarildi.` : "Javoblar o'zaro solishtirildi."} Saqlashdan oldin baribir ko'zdan kechiring.`, category: "Bulutli texnologiyalar", questions: checked.questions };
  } catch (e) { console.error("PDF test JSON xatosi:", String(e)); return null; }
}


/** DOCX dan ajratilgan matnni Gemini orqali testlarga aylantiradi. */
export async function parseQuizDocxText(docxText: string): Promise<PdfQuizResult | null> {
  if (!docxText.trim()) return null;
  if (groqEnabled) return parseQuizTextGroq(docxText);
  return parseQuizTextGemini(docxText);
}

/** Matnni bo'laklarga ajratadi (savol boshida bo'lishga harakat qiladi). */
function splitChunks(text: string, max: number): string[] {
  const lines = text.split("\n"); const out: string[] = []; let cur = "";
  const starts = (l: string) => /^\s*(\d{1,3}\s*[.)]|\d{1,3}\s*[-–])\s/.test(l);
  for (const l of lines) {
    if (cur && ((cur.length > max * 0.8 && starts(l)) || cur.length + l.length > max * 1.3)) { out.push(cur); cur = ""; }
    cur += l + "\n";
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Groq orqali: matn bo'laklab o'qiladi, hujjat oxiridagi javoblar kaliti har bo'lakka qo'shib beriladi. */
async function parseQuizTextGroq(docText: string): Promise<PdfQuizResult | null> {
  const clean = docText.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
  const tail = clean.slice(-1800);
  const chunks = splitChunks(clean, 5000);
  const system = `Sen hujjatdagi test savollarini JSON ga o'tkazuvchi aniq test tuzuvchisan. Berilgan BO'LAKDAGI savollar va variantlarni ol. Hujjat oxiridagi javoblar kaliti (masalan 1-A, 2-C) yoki savol yonida belgilangan javob bo'lsa, uni savol raqamiga to'g'ri mosla. Kalit bo'lmasa, savolni bilim bilan o'zing yech. Faqat hujjatda bor savol va variantlarni ol, yangisini to'qima; savol raqamini matnga qo'shma. Har savolda 2-4 variant. correct — to'g'ri variantning 0 dan boshlanuvchi indeksi. O'zbekcha matn va apostroflarni asliga yaqin saqla. Faqat sof JSON: {"title":"hujjat nomi","questions":[{"text":"savol","options":["A","B","C","D"],"correct":0}]}`;
  const all: PdfQuestion[] = []; const seen = new Set<string>(); let title = "";
  for (let ci = 0; ci < chunks.length && all.length < 200; ci++) {
    const last = ci === chunks.length - 1;
    const user = `Hujjat bo'lagi ${ci + 1}/${chunks.length}:\n${chunks[ci]}` + (last ? "" : `\n\n--- Hujjat oxiri (javoblar kaliti bo'lishi mumkin) ---\n${tail}`);
    const r = await groqChat([{ role: "system", content: system }, { role: "user", content: user }], { json: true, maxTokens: 3500, temperature: 0, timeoutMs: 90000 });
    if (!r) continue;
    try {
      const j = JSON.parse(r.text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim());
      if (!title && typeof j.title === "string") title = j.title;
      for (const q of Array.isArray(j.questions) ? j.questions : []) {
        const options = Array.isArray(q.options) ? q.options.map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 4) : [];
        const text = String(q.text ?? "").trim().slice(0, Q_MAX); const correct = Number(q.correct);
        const key = normUz(text);
        if (text && options.length >= 2 && Number.isInteger(correct) && correct >= 0 && correct < options.length && !seen.has(key)) { seen.add(key); all.push({ text, options, correct, time: 20 }); }
      }
    } catch (e) { console.error("Groq bo'lak JSON xatosi:", ci, String(e).slice(0, 120)); }
  }
  if (!all.length) return null;
  const checked = await verifyQuestions(all.slice(0, 200));
  if (!checked) return null;
  console.log(`Hujjat tekshiruvi (Groq): ${checked.questions.length} tasdiqlandi, ${checked.rejected} tasi kelishmovchilik sabab chiqarildi.`);
  return { title: String(title || "Hujjat testlari").trim().slice(0, 60) || "Hujjat testlari", description: `AI tekshiruvi: ${checked.verifiedBy.join(" + ")}. ${checked.rejected ? `${checked.rejected} ta kelishilmagan savol xavfsizlik uchun chiqarildi.` : "Javoblar o'zaro solishtirildi."} Saqlashdan oldin baribir ko'zdan kechiring.`, category: "Bulutli texnologiyalar", questions: checked.questions };
}

async function parseQuizTextGemini(docxText: string): Promise<PdfQuizResult | null> {
  if (!KEY || !docxText.trim()) return null;
  const system = `Sen hujjatdagi testlar to'plamini tahlil qiladigan test tuzuvchisan. Matnni boshidan oxirigacha tahlil qil. Javoblar kaliti yoki savollar yonidagi belgilangan javoblar bo'lsa, ularni savollar bilan moslashtir. Rasmiy kalit bo'lmasa, savollarni bilim asosida yech. Faqat hujjatda bor savollar va variantlarni ol, yangi savol yoki variant to'qima. Har savolda 2-4 ta variant bo'lsin. correct — to'g'ri variantning 0 dan boshlanuvchi indeksi. Javobni ishonchli aniqlab bo'lmasa ham nomzod javobni belgilab ber, keyin mustaqil AI tekshiruvchilari tasdiqlaydi. Takroriy savollarni saqla. 200 tagacha savol qaytar. Faqat sof JSON qaytar: {"title":"Hujjatdan olingan test nomi","description":"DOCXdan Gemini AI yordamida ajratildi","category":"Bulutli texnologiyalar","questions":[{"text":"savol","options":["A","B","C","D"],"correct":0,"time":20}]}.`;
  const out = await generate(system, [{ text: `Quyidagi DOCX hujjatidan testlarni ajrat. Javoblar kalitini tekshir va correct indeksini belgila. Matn:\n\n${docxText.slice(0, 100000)}` }], true, 30000, 150000);
  if (!out) return null;
  try {
    const cleaned = out.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const j = JSON.parse(cleaned);
    if (!Array.isArray(j.questions)) return null;
    const questions: PdfQuestion[] = j.questions.slice(0, 200).map((q: any) => {
      const options = Array.isArray(q.options) ? q.options.map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 4) : [];
      const correct = Number(q.correct);
      return { text: String(q.text ?? "").trim().slice(0, Q_MAX), options, correct, time: 20 };
    }).filter((q: PdfQuestion) => q.text.length > 0 && q.options.length >= 2 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length);
    if (!questions.length) return null;
    const checked = await verifyQuestions(questions);
    if (!checked) return null;
    console.log(`DOCX test tekshiruvi: ${checked.questions.length} tasdiqlandi, ${checked.rejected} tasi kelishmovchilik sabab chiqarildi.`);
    return { title: String(j.title || "DOCX testlari").trim().slice(0, 60) || "DOCX testlari", description: `AI tekshiruvi: ${checked.verifiedBy.join(" + ")}. ${checked.rejected ? `${checked.rejected} ta kelishilmagan savol xavfsizlik uchun chiqarildi.` : "Javoblar o'zaro solishtirildi."} Saqlashdan oldin baribir ko'zdan kechiring.`, category: "Bulutli texnologiyalar", questions: checked.questions };
  } catch (e) { console.error("DOCX test JSON xatosi:", String(e)); return null; }
}


/** Erkin suhbat (Chat oynasi): Groq orqali, sof o'zbekcha. */
export async function chatReply(history: { role: "user" | "assistant"; text: string }[], text: string): Promise<string | null> {
  const system =
    "Sen Quiz Arena ilovasining o‘zbekcha AI yordamchisisan. Foydalanuvchiga o‘qish, test savollari, bulutli texnologiyalar va umumiy savollarda yordam ber. " +
    "Javob 2–5 qisqa gapdan iborat bo‘lsin (u ovozda ham eshitiladi). Markdown, ro‘yxat va emoji ishlatma. " +
    "Foydalanuvchi matni ovozdan olingan bo‘lishi va ayrim so‘zlari xato yozilgan bo‘lishi mumkin — ma’nosini tushunib javob ber. " + UZ_STYLE;
  const msgs: ChatMsg[] = [{ role: "system", content: system },
    ...history.slice(-8).map(h => ({ role: h.role, content: h.text.slice(0, 600) } as ChatMsg)),
    { role: "user", content: text.slice(0, 800) }];
  const out = await uzChat(msgs, { models: GROQ_TEXT_MODELS, maxTokens: 1000, temperature: 0.4, timeoutMs: 25000 });
  return out ? plainText(out).slice(0, 900) : null;
}
