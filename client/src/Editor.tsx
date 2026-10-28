import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2, ShieldCheck, ShieldAlert } from "lucide-react";
import { EQuestion, QuizCard, api } from "./api";

const blank = (): EQuestion => ({ text: "", options: ["", "", "", ""], correct: 0, time: 20 });
export type Draft = { id?: string; title: string; description: string; category: string; isPublic: boolean; questions: EQuestion[] };
export const newDraft = (): Draft => ({ title: "", description: "", category: "Umumiy", isPublic: true, questions: [blank()] });

export default function Editor({ draft, categories, onDone, onCancel }: { draft: Draft; categories: string[]; onDone: (q: QuizCard) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(draft); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [checking, setChecking] = useState(false); const [review, setReview] = useState<{ verifiedCount: number; reviewCount: number; questions: Array<{ verified: boolean; suggestedCorrect: number }> } | null>(null); const [reviewedManual, setReviewedManual] = useState<number[]>([]); const [verificationStale, setVerificationStale] = useState(false);
  const setQ = (i: number, patch: Partial<EQuestion>) => { if (review && patch.correct === undefined) setVerificationStale(true); if (patch.correct !== undefined && review?.questions[i] && !review.questions[i].verified) setReviewedManual(v => v.includes(i) ? v : [...v, i]); setD(x => ({ ...x, questions: x.questions.map((q, k) => (k === i ? { ...q, ...patch } : q)) })); };
  const move = (i: number, dir: -1 | 1) => setD(x => {
    const a = [...x.questions]; const j = i + dir; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, questions: a };
  });
  async function verify() {
    setErr(""); setChecking(true); setReview(null); setReviewedManual([]);
    const questions = d.questions.map(q => { const idx = q.options.map((o, i) => ({ o: o.trim(), i })).filter(x => x.o); return { ...q, options: idx.map(x => x.o), correct: Math.max(0, idx.findIndex(x => x.i === q.correct)) }; });
    try {
      const r = await api<{ questions: Array<{ text: string; options: string[]; correct: number; time: number; verified: boolean; suggestedCorrect: number }>; verifiedCount: number; reviewCount: number; providers: string[] }>("/api/ai/verify-quiz", { body: { questions } });
      setD(x => ({ ...x, questions: x.questions.map((q, i) => r.questions[i]?.verified && r.questions[i].suggestedCorrect >= 0 ? { ...q, correct: (() => { const clean = q.options.map((o, k) => ({ o: o.trim(), k })).filter(v => v.o); return clean[r.questions[i].suggestedCorrect]?.k ?? q.correct; })() } : q) }));
      setReview({ verifiedCount: r.verifiedCount, reviewCount: r.reviewCount, questions: r.questions }); setVerificationStale(false);
      if (r.reviewCount) setErr(`${r.reviewCount} ta savolda AI'lar kelisha olmadi. Har birida to'g'ri javobni qo'lda tanlang; bu savollar avtomatik tuzatilmagan.`);
    } catch (e: any) { setErr(e.message || "AI tekshiruvi bajarilmadi."); }
    finally { setChecking(false); }
  }
  async function save() {
    setErr("");
    if (verificationStale) { setErr("Savollar tekshiruvdan keyin o'zgardi. Saqlashdan oldin AI bilan qayta tekshiring."); return; }
    if (review && review.questions.some((q, i) => !q.verified && !reviewedManual.includes(i))) { setErr("Avval AI'lar kelisha olmagan savollarda to'g'ri javobni qo'lda tanlang."); return; }
    setBusy(true);
    const body = { ...d, questions: d.questions.map(q => {
      // bo'sh variantlarni olib tashlaymiz, to'g'ri javob indeksini moslaymiz
      const idx = q.options.map((o, i) => ({ o: o.trim(), i })).filter(x => x.o);
      return { ...q, options: idx.map(x => x.o), correct: Math.max(0, idx.findIndex(x => x.i === q.correct)) };
    }) };
    try {
      const r = d.id ? await api(`/api/quizzes/${d.id}`, { method: "PUT", body }) : await api("/api/quizzes", { body });
      onDone(r.quiz);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className="stack">
      <h1 className="h1">{d.id ? "Testni tahrirlash" : "Yangi test yaratish"}</h1>
      <div className="card stack">
        <label>Test nomi<input value={d.title} maxLength={60} placeholder="Masalan: Jahon poytaxtlari" onChange={e => setD({ ...d, title: e.target.value })} /></label>
        <label>Qisqa tavsif<input value={d.description} maxLength={140} placeholder="Ixtiyoriy" onChange={e => setD({ ...d, description: e.target.value })} /></label>
        <div className="row gap">
          <label className="grow">Mavzu<select value={d.category} onChange={e => setD({ ...d, category: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="grow">Ko‘rinishi<select value={d.isPublic ? "1" : "0"} onChange={e => setD({ ...d, isPublic: e.target.value === "1" })}><option value="1">🌍 Ommaviy</option><option value="0">🔒 Faqat men</option></select></label>
        </div>
      </div>
      {d.questions.map((q, i) => (
        <div className="card stack qcard" key={i}>
          <div className="row between"><b>{i + 1}-savol</b>{review && <small className={review.questions[i]?.verified ? "muted" : reviewedManual.includes(i) ? "muted" : "err"}>{review.questions[i]?.verified ? "AI tasdiqladi" : reviewedManual.includes(i) ? "Qo‘lda tekshirildi" : "Qo‘lda tekshirish kerak"}</small>}
            <div className="row gap-s">
              <button className="icon-btn" onClick={() => { if (review) setVerificationStale(true); move(i, -1); }} aria-label="Yuqoriga"><ArrowUp size={15} /></button>
              <button className="icon-btn" onClick={() => { if (review) setVerificationStale(true); move(i, 1); }} aria-label="Pastga"><ArrowDown size={15} /></button>
              <button className="icon-btn danger" disabled={d.questions.length === 1} onClick={() => { if (review) setVerificationStale(true); setD({ ...d, questions: d.questions.filter((_, k) => k !== i) }); }} aria-label="O‘chirish"><Trash2 size={15} /></button>
            </div>
          </div>
          <textarea rows={2} maxLength={200} placeholder="Savol matni" value={q.text} onChange={e => setQ(i, { text: e.target.value })} />
          {q.options.map((o, k) => (
            <div className={`opt c${k}`} key={k}>
              <button type="button" className={`radio ${q.correct === k ? "on" : ""}`} onClick={() => setQ(i, { correct: k })} aria-label="To‘g‘ri javob">{q.correct === k && <Check size={14} />}</button>
              <input value={o} maxLength={100} placeholder={`${"ABCD"[k]} variant${k > 1 ? " (ixtiyoriy)" : ""}`} onChange={e => setQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />
            </div>
          ))}
          <label className="inline">Vaqt
            <select value={q.time} onChange={e => setQ(i, { time: Number(e.target.value) })}>{[10, 15, 20, 30, 45, 60].map(t => <option key={t} value={t}>{t} soniya</option>)}</select>
          </label>
        </div>
      ))}
      <button className="ghost" disabled={d.questions.length >= 300} onClick={() => { if (review) setVerificationStale(true); setD({ ...d, questions: [...d.questions, blank()] }); }}><Plus size={16} /> Savol qo‘shish</button>
      <div className="card stack">
        <b><ShieldCheck size={16} style={{display:"inline",verticalAlign:"middle"}}/> Uchta AI bilan javoblarni tekshirish</b>
        <p className="muted">Gemini, GPT va Groq har bir savolni mustaqil yechadi. Kamida ikkita model bir xil javobni tanlamasa, javob avtomatik o‘zgartirilmaydi. Tekshiruv API xarajatini keltirishi mumkin.</p>
        <button className="ghost" disabled={checking || busy || d.questions.some(q => !q.text.trim() || q.options.filter(o => o.trim()).length < 2)} onClick={verify}>{checking ? "Uchta AI tekshiryapti…" : "AI bilan tekshirish"}</button>
        {review && <p className={review.reviewCount ? "err" : "muted"}>{review.verifiedCount} ta savol tekshiruvdan o‘tdi. {review.reviewCount} ta savolni qo‘lda ko‘rib chiqing.</p>}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="row gap"><button className="ghost grow" onClick={onCancel}>Bekor qilish</button><button className="primary grow" disabled={busy} onClick={save}>{busy ? "Saqlanmoqda…" : "Saqlash"}</button></div>
    </div>
  );
}
