// Brauzerning o'z ovoz imkoniyatlari (bepul). Telefon va Telegram versiyasiga qarab ishlashi har xil bo'lishi mumkin.
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

export function stopSpeak() { try { window.speechSynthesis?.cancel(); } catch { /* yo'q */ } }

/** Matnni o'qiydi; o'qish tugagach (yoki xato/uzoq kutilsa) hal bo'ladi. */
export function speak(text: string): Promise<void> {
  return new Promise(resolve => {
    if (!canSpeak || !text) return resolve();
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
