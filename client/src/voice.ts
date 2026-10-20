// Brauzerning o'z ovoz imkoniyatlari (bepul). Telefon va Telegram versiyasiga qarab ishlashi har xil bo'lishi mumkin.
import { api } from "./api";

const w = window as any;
export const canSpeak = "speechSynthesis" in window && typeof w.SpeechSynthesisUtterance !== "undefined";
const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
export const canListen = !!SR;

/** O'zbek ovozi bo'lsa — o'sha; bo'lmasa lotin yozuviga yaqin tillar (turkcha, ozarcha...), keyin ruscha. */
export function pickVoice(): { voice: SpeechSynthesisVoice | null; exact: boolean } {
  if (!canSpeak) return { voice: null, exact: false };
  const vs = window.speechSynthesis.getVoices();
  for (const p of ["uz", "tr", "az", "kk", "ru"]) {
    const v = vs.find(x => x.lang.toLowerCase().startsWith(p));
    if (v) return { voice: v, exact: p === "uz" };
  }
  return { voice: null, exact: false };
}

// --- Server ovozi (Gemini TTS): bitta <audio> elementi qayta ishlatiladi (iPhone uchun muhim) ---
const player = new Audio();
let playDone: (() => void) | null = null;
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
/** Foydalanuvchi tugmani bosgan zahoti chaqiring: keyingi ovozlarga brauzer ruxsat beradi. */
export function unlockAudio() { try { player.src = SILENT; player.play().catch(() => {}); } catch { /* yo'q */ } }
export function stopSpeak() {
  try { window.speechSynthesis?.cancel(); } catch { /* yo'q */ }
  try { player.pause(); } catch { /* yo'q */ }
  const d = playDone; playDone = null; d?.();
}
export let voiceError = "";
async function speakServer(text: string): Promise<boolean> {
  voiceError = "";
  try {
    const r = await api("/api/ai/tts", { body: { text } });
    return await new Promise<boolean>(resolve => {
      stopSpeak();
      player.src = "data:audio/wav;base64," + r.audio;
      const done = (ok: boolean) => () => { if (playDone) { playDone = null; resolve(ok); } };
      playDone = done(true);
      player.onended = done(true); player.onerror = done(false);
      player.play().catch(() => { voiceError = "telefon ovozni o‘ynatishga ruxsat bermadi"; if (playDone) { playDone = null; resolve(false); } });
    });
  } catch (e: any) { voiceError = e?.message || "noma'lum xato"; return false; }
}

/** Matnni o'qiydi; o'qish tugagach (yoki xato/uzoq kutilsa) hal bo'ladi. */
export async function speak(text: string, server = false): Promise<void> {
  if (!text) return;
  if (server && await speakServer(text)) return;
  return new Promise(resolve => {
    if (!canSpeak) return resolve();
    try {
      stopSpeak();
      const u = new w.SpeechSynthesisUtterance(text) as SpeechSynthesisUtterance;
      const { voice } = pickVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "tr-TR";
      u.rate = 0.95;
      const done = () => { clearTimeout(guard); resolve(); };
      const guard = setTimeout(done, Math.min(30000, 3000 + text.length * 90));
      u.onend = done; u.onerror = done;
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}

let rec: any = null;
export function stopListen() { try { rec?.abort(); } catch { /* yo'q */ } rec = null; }
/** Bir marta tinglaydi va eshitilgan variantlarni qaytaradi. */
export function listen(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error("Bu qurilmada ovozni tanish ishlamaydi."));
    stopListen();
    try {
      rec = new SR(); rec.lang = "uz-UZ"; rec.interimResults = false; rec.maxAlternatives = 3; rec.continuous = false;
      rec.onresult = (e: any) => { const r = e.results?.[0]; resolve(r ? Array.from(r).map((a: any) => String(a.transcript)) : []); };
      rec.onerror = (e: any) => reject(new Error(e?.error === "not-allowed" ? "Mikrofonga ruxsat berilmagan." : "Ovoz eshitilmadi."));
      rec.onend = () => resolve([]);
      rec.start();
    } catch (e: any) { reject(new Error("Mikrofonni yoqib bo‘lmadi.")); }
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`´']/g, "").replace(/[^a-z0-9\u0400-\u04ff\s]/g, " ").replace(/\s+/g, " ").trim();
const WORDS: Record<string, number> = {
  a: 0, b: 1, c: 2, d: 3, be: 1, bi: 1, se: 2, si: 2, de: 3, di: 3, s: 2,
  birinchi: 0, ikkinchi: 1, uchinchi: 2, tortinchi: 3, bir: 0, ikki: 1, uch: 2, tort: 3, "1": 0, "2": 1, "3": 2, "4": 3,
  один: 0, два: 1, три: 2, четыре: 3
};
/** Eshitilgan gapdan variant raqamini topadi (A/B/C/D, "birinchi", yoki variant matni). Topilmasa -1. */
export function matchAnswer(heard: string[], options: string[]): number {
  for (const h of heard) {
    const toks = norm(h).split(" ").filter(Boolean);
    const hits = new Set<number>();
    for (const t of toks) if (t in WORDS && WORDS[t] < options.length) hits.add(WORDS[t]);
    if (hits.size === 1) return [...hits][0];
  }
  let best = -1, bestScore = 0, second = 0;
  for (const h of heard) {
    const ht = new Set(norm(h).split(" ").filter(Boolean)); const hs = norm(h);
    options.forEach((o, i) => {
      const on = norm(o), ot = on.split(" ").filter(Boolean); if (!ot.length) return;
      const score = hs.includes(on) ? 1 : ot.filter(t => ht.has(t)).length / ot.length;
      if (score > bestScore) { second = bestScore; bestScore = score; best = i; } else if (score > second) second = score;
    });
  }
  return bestScore >= 0.6 && bestScore > second ? best : -1;
}

// --- Mikrofon yozuvi (server orqali tanish) ---
export const canRecord = typeof navigator.mediaDevices?.getUserMedia === "function" && !!w.MediaRecorder;
export async function startClip(maxMs = 7000): Promise<{ stop: () => void; done: Promise<{ b64: string; mime: string }> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const mime = types.find(t => w.MediaRecorder.isTypeSupported?.(t)) || "";
  const mr = new w.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  mr.ondataavailable = (e: any) => { if (e.data?.size) chunks.push(e.data); };
  const done = new Promise<{ b64: string; mime: string }>((resolve, reject) => {
    mr.onerror = () => { stream.getTracks().forEach(t => t.stop()); reject(new Error("Yozib bo‘lmadi.")); };
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const type = mr.mimeType || mime || "audio/webm";
      const fr = new FileReader();
      fr.onload = () => resolve({ b64: String(fr.result).split(",")[1] || "", mime: type });
      fr.onerror = () => reject(new Error("Yozuv o‘qilmadi."));
      fr.readAsDataURL(new Blob(chunks, { type }));
    };
  });
  mr.start();
  const timer = setTimeout(() => { if (mr.state !== "inactive") mr.stop(); }, maxMs);
  return { stop: () => { clearTimeout(timer); if (mr.state !== "inactive") mr.stop(); }, done };
}

/** Mikrofonni yoqadi, gapirishni boshlaganingizni sezadi va jim bo'lganingizda o'zi to'xtaydi. speech=false: hech narsa aytilmadi. */
export async function startAutoClip(o = { maxMs: 12000, waitMs: 8000, silenceMs: 1300 }): Promise<{ stop: () => void; done: Promise<{ b64: string; mime: string; speech: boolean }> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const mime = types.find(t => w.MediaRecorder.isTypeSupported?.(t)) || "";
  const mr = new w.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  mr.ondataavailable = (e: any) => { if (e.data?.size) chunks.push(e.data); };
  const AC = w.AudioContext || w.webkitAudioContext;
  let ctx: any = null, an: any = null;
  try { if (AC) { ctx = new AC(); ctx.resume?.(); an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an); } } catch { ctx = null; an = null; }
  let heard = !an; // tahlil qilib bo'lmasa, qat'iy vaqt yoziladi
  let forced = false, tick: any = null, hardStop: any = null;
  const finish = (force = false) => { if (force) forced = true; if (mr.state !== "inactive") mr.stop(); };
  const done = new Promise<{ b64: string; mime: string; speech: boolean }>((resolve, reject) => {
    mr.onerror = () => { cleanup(); reject(new Error("Yozib bo‘lmadi.")); };
    mr.onstop = () => {
      cleanup();
      const type = mr.mimeType || mime || "audio/webm"; const speech = heard || forced;
      if (!speech) return resolve({ b64: "", mime: type, speech: false });
      const fr = new FileReader();
      fr.onload = () => resolve({ b64: String(fr.result).split(",")[1] || "", mime: type, speech: true });
      fr.onerror = () => reject(new Error("Yozuv o‘qilmadi."));
      fr.readAsDataURL(new Blob(chunks, { type }));
    };
  });
  function cleanup() { clearInterval(tick); clearTimeout(hardStop); stream.getTracks().forEach(t => t.stop()); try { ctx?.close(); } catch { /* yo'q */ } }
  mr.start();
  const t0 = Date.now(); let floor = 0, n = 0, lastVoice = 0;
  if (an) {
    const buf = new Uint8Array(an.fftSize);
    tick = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / buf.length), now = Date.now(), el = now - t0;
      if (el < 500) { floor = (floor * n + rms) / (n + 1); n++; return; } // atrofdagi shovqinni o'lchaymiz
      if (rms > Math.max(0.02, floor * 3)) { heard = true; lastVoice = now; }
      if (heard && now - lastVoice > o.silenceMs) finish();
      else if (!heard && el > o.waitMs) finish();
      else if (el > o.maxMs) finish();
    }, 100);
  } else hardStop = setTimeout(() => finish(), 6000);
  return { stop: () => finish(true), done };
}
