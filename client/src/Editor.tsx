import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { EQuestion, QuizCard, api } from "./api";

const blank = (): EQuestion => ({ text: "", options: ["", "", "", ""], correct: 0, time: 20 });
export type Draft = { id?: string; title: string; description: string; category: string; isPublic: boolean; questions: EQuestion[] };
export const newDraft = (): Draft => ({ title: "", description: "", category: "Umumiy", isPublic: true, questions: [blank()] });

export default function Editor({ draft, categories, onDone, onCancel }: { draft: Draft; categories: string[]; onDone: (q: QuizCard) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(draft); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const setQ = (i: number, patch: Partial<EQuestion>) => setD(x => ({ ...x, questions: x.questions.map((q, k) => (k === i ? { ...q, ...patch } : q)) }));
  const move = (i: number, dir: -1 | 1) => setD(x => {
    const a = [...x.questions]; const j = i + dir; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, questions: a };
  });
  async function save() {
    setErr(""); setBusy(true);
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
          <div className="row between"><b>{i + 1}-savol</b>
            <div className="row gap-s">
              <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Yuqoriga"><ArrowUp size={15} /></button>
              <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Pastga"><ArrowDown size={15} /></button>
              <button className="icon-btn danger" disabled={d.questions.length === 1} onClick={() => setD({ ...d, questions: d.questions.filter((_, k) => k !== i) })} aria-label="O‘chirish"><Trash2 size={15} /></button>
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
      <button className="ghost" disabled={d.questions.length >= 50} onClick={() => setD({ ...d, questions: [...d.questions, blank()] })}><Plus size={16} /> Savol qo‘shish</button>
      {err && <p className="err">{err}</p>}
      <div className="row gap"><button className="ghost grow" onClick={onCancel}>Bekor qilish</button><button className="primary grow" disabled={busy} onClick={save}>{busy ? "Saqlanmoqda…" : "Saqlash"}</button></div>
    </div>
  );
}
