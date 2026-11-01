// O‘zbekcha matn bilan ishlash yordamchilari: kirill→lotin, javob variantini topish, til tekshiruvi.

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "s", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h"
};
export const toLatin = (s: string) => s.toLowerCase().replace(/[\u0400-\u04ff]/g, c => CYR[c] ?? c);
/** Taqqoslash uchun: kichik harf, lotin, tutuq belgilarsiz, faqat harf va raqam. */
export const normUz = (s: string) => toLatin(s).replace(/[ʻʼ‘’`´']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const WORDS: Record<string, number> = {
  a: 0, ey: 0, ay: 0, b: 1, be: 1, bi: 1, bee: 1, c: 2, ce: 2, se: 2, si: 2, s: 2, see: 2, sie: 2, v: 2, d: 3, de: 3, di: 3, dee: 3, g: 3,
  birinchi: 0, birinchisi: 0, ikkinchi: 1, ikkinchisi: 1, uchinchi: 2, uchinchisi: 2, tortinchi: 3, tortinchisi: 3,
  bir: 0, ikki: 1, uch: 2, tort: 3, "1": 0, "2": 1, "3": 2, "4": 3
};
const WEAK = new Set(["bir", "ikki", "uch", "tort", "s", "v", "g"]);

/** Eshitilgan gapdan variant indeksini topadi (A/B/C/D, "birinchi", yoki variant matni). Topilmasa -1. */
export function matchChoice(heard: string, options: string[]): number {
  const text = normUz(heard);
  if (!text) return -1;
  const toks = text.split(" ").filter(Boolean);
  const strong = /\b(variant|javob|harf|otvet|variantlar)\b/.test(text);
  if (toks.length <= 4 || strong) {
    const hits = new Set<number>();
    for (const t of toks) if (t in WORDS && WORDS[t] < options.length && (toks.length <= 2 || strong || !WEAK.has(t))) hits.add(WORDS[t]);
    if (hits.size === 1) return [...hits][0];
  }
  const ht = new Set(toks);
  let best = -1, bestScore = 0, second = 0;
  options.forEach((o, i) => {
    const on = normUz(o), ot = on.split(" ").filter(Boolean);
    if (!ot.length) return;
    const score = text.includes(on) ? 1 : ot.filter(t => ht.has(t)).length / ot.length;
    if (score > bestScore) { second = bestScore; bestScore = score; best = i; } else if (score > second) second = score;
  });
  return bestScore >= 0.6 && bestScore > second ? best : -1;
}

/** Natija o‘zbekcha (lotin) ko‘rinadimi? Boshqa yozuv yoki ingliz tili aralashsa false. */
export function looksUzbek(text: string): boolean {
  if (!text) return false;
  if (/[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0600-\u06FF]/.test(text)) return false;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length < 6) return true;
  const EN = new Set(["the", "and", "is", "are", "you", "this", "that", "with", "for", "not", "have", "was", "will", "can", "your", "from", "which", "because", "should"]);
  const en = words.filter(w => EN.has(w)).length;
  return en / words.length < 0.12;
}

/** Markdown va ortiqcha belgilarni olib tashlaydi (ovozga o‘qish uchun). */
export const plainText = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/[*#`_>|~]/g, "").replace(/\s+/g, " ").trim();

export const UZ_STYLE =
  "TIL QOIDALARI (juda muhim): Faqat sof, ravon va tabiiy o‘zbek tilida (lotin yozuvida) javob ber. " +
  "Rus, ingliz, turk yoki qozoq so‘zlarini aralashtirma; kirill, xitoy, arab harflarini ishlatma. " +
  "Imlo: o‘ va g‘ harflarini shunday yoz (to‘g‘ri, o‘zbek, bo‘lim, yo‘q), sh, ch, ng harflari va tutuq belgisi (’) to‘g‘ri bo‘lsin. " +
  "Gaplar qisqa, aniq va tabiiy bo‘lsin; ingliz yoki rus tilidan so‘zma-so‘z tarjima qilma; 'siz' deb murojaat qil. " +
  "Texnik atamalarni (IaaS, API, server, Docker, TypeScript kabi) o‘zgartirma, lekin tushuntirishni o‘zbekcha yoz. " +
  "Bilmagan yoki ishonching komil bo‘lmagan narsani to‘qima: 'aniq bilmayman' de.";
