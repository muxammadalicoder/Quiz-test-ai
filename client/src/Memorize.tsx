import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Brain, ChevronRight, RotateCcw } from "lucide-react";
import { QuizCard, api } from "./api";
import { Empty } from "./ui";

export default function Memorize({ sectionSize = 10, title = "Yodlash uchun", onStart }: { sectionSize?: number; title?: string; onStart: (quizId: string, start: number, end: number) => void }) {
  const [quizzes, setQuizzes] = useState<QuizCard[] | null>(null);
  const [selected, setSelected] = useState<QuizCard | null>(null);
  const [error, setError] = useState("");

  function loadQuizzes() {
    setQuizzes(null);
    setError("");
    api("/api/quizzes?forMemorize=1")
      .then(d => setQuizzes((d.quizzes as QuizCard[]).filter(q => q.count > 0 && !q.title.startsWith("Yodlash uchun — "))))
      .catch((e: Error) => { setError(e.message || "Testlarni yuklab bo‘lmadi."); setQuizzes([]); });
  }

  useEffect(() => {
    let active = true;
    api("/api/quizzes?forMemorize=1")
      .then(d => { if (active) setQuizzes((d.quizzes as QuizCard[]).filter(q => q.count > 0 && !q.title.startsWith("Yodlash uchun — "))); })
      .catch((e: Error) => { if (active) { setError(e.message || "Testlarni yuklab bo‘lmadi."); setQuizzes([]); } });
    return () => { active = false; };
  }, []);

  return (
    <div className="stack">
      <div className="card stack">
        <div className="center-row" style={{ justifyContent: "flex-start", gap: 12 }}>
          <span className="qi-icon"><Brain size={24} /></span>
          <div className="grow">
            <h1 className="h1 tight">{title}</h1>
            <small className="muted">Barcha testlar · {sectionSize} tadan bo‘limlarga ajratiladi</small>
          </div>
        </div>
        <p className="muted">Istalgan testni tanlang. Savollar {sectionSize} tadan ketma-ket bo‘linadi; oxirgi bo‘limda qolgan savollar bo‘ladi.</p>
      </div>

      {selected ? <>
        <button className="ghost" onClick={() => setSelected(null)}><ArrowLeft size={16} /> Barcha testlarga qaytish</button>
        <div className="card stack">
          <b>{selected.title}</b>
          <small className="muted">{selected.count} ta savol · {selected.category}</small>
        </div>
        {Array.from({ length: Math.ceil(selected.count / sectionSize) }, (_, i) => {
          const start = i * sectionSize;
          const end = Math.min(start + sectionSize, selected.count);
          return <button key={`${selected.id}-${start}`} className="qitem" onClick={() => onStart(selected.id, start, end)}>
            <span className="qi-icon"><BookOpen size={21} /></span>
            <span className="qi-body"><b>{start + 1}–{end}-savollar</b><small>{end - start} ta savol · {i + 1}/{Math.ceil(selected.count / sectionSize)}-bo‘lim</small></span>
            <span className="qi-plays"><ChevronRight size={18} /></span>
          </button>;
        })}
      </> : quizzes === null ? <div className="center-t"><i className="spinner" /></div>
        : quizzes.length ? quizzes.map(q => (
          <button key={q.id} className="qitem" onClick={() => setSelected(q)}>
            <span className="qi-icon"><BookOpen size={21} /></span>
            <span className="qi-body"><b>{q.title}</b><small>{q.count} ta savol · {q.category}</small></span>
            <span className="qi-plays"><ChevronRight size={18} /></span>
          </button>
        )) : <Empty icon="📚" text={error || "Yodlash uchun testlar topilmadi."} />}
      <button className="ghost" onClick={loadQuizzes}><RotateCcw size={15} /> Testlar ro‘yxatini yangilash</button>
    </div>
  );
}
