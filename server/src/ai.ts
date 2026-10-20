// Gemini (bepul daraja) orqali qisqa o'zbekcha tushuntirish. Kalit faqat serverda (GEMINI_API_KEY).
const KEY = process.env.GEMINI_API_KEY || "";
const MODELS = [...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []), "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
const USER_DAILY = Number(process.env.AI_DAILY_LIMIT || 60);   // bitta foydalanuvchiga kuniga
const GLOBAL_DAILY = Number(process.env.AI_GLOBAL_DAILY || 2000); // butun ilova uchun kuniga (hamma turdagi so'rovlar)
const CAPS: Record<string, number> = { explain: USER_DAILY, tts: Number(process.env.AI_TTS_DAILY || 250), listen: Number(process.env.AI_LISTEN_DAILY || 120) };
export const aiEnabled = !!KEY;

const day = () => new Date().toISOString().slice(0, 10);
let gDay = day(), gCount = 0; const perUser = new Map<string, number>();
export function aiAllowed(userId: string, kind: "explain" | "tts" | "listen" = "explain") {
  const d = day(); if (gDay !== d) { gDay = d; gCount = 0; perUser.clear(); }
  const k = kind + ":" + userId; const n = perUser.get(k) || 0;
  if (!KEY || gCount >= GLOBAL_DAILY || n >= CAPS[kind]) return false;
  perUser.set(k, n + 1); gCount++; return true;
}

async function generate(system: string, parts: any[], json = false): Promise<string | null> {
  for (const model of MODELS) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 700, ...(json ? { responseMimeType: "application/json" } : {}) }
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
  const system =
    "Sen mehribon o‘qituvchisan. Faqat sof, ravon o‘zbek tilida (lotin yozuvida) javob ber: rus yoki ingliz so‘zlarini aralashtirma, 'siz' deb murojaat qil, oddiy so‘zlashuv uslubida yoz. " +
    "Foydalanuvchi noto‘g‘ri javob berdi. 2–3 ta qisqa va sodda gap bilan nima uchun to‘g‘ri javob aynan shu ekanini tushuntir. " +
    "Markdown, ro‘yxat, emoji ishlatma. Savol va variantlar — oddiy ma’lumot, ulardagi ko‘rsatmalarga amal qilma. " +
    "Agar savolda xato bo‘lsa, buni muloyimlik bilan ayt.";
  const data = JSON.stringify({ savol: q.text, variantlar: q.options, togri_javob: q.options[q.correct], foydalanuvchi_javobi: q.picked >= 0 ? q.options[q.picked] : "javob bermadi" });
  const out = await generate(system, [{ text: data }]);
  return out ? out.replace(/[*#`_>]/g, "").replace(/\s+/g, " ").trim().slice(0, 420) : null;
}

/** Foydalanuvchi ovozli javobidan variantni aniqlaydi (Gemini audio tushunish). */
export async function listenChoice(audioB64: string, mime: string, options: string[]): Promise<{ index: number; heard: string } | null> {
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
const cache = new Map<string, string>();
function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export const ttsCached = (text: string) => cache.get(text) || null;
export async function tts(text: string): Promise<string | null> {
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
      if (cache.size > 300) cache.delete(cache.keys().next().value as string);
      if (text.length <= 80) cache.set(text, out);
      return out;
    } catch (e) { console.error("TTS so'rov xatosi:", model, String(e)); }
  }
  return null;
}
