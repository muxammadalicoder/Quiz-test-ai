import { useState } from "react";
import { AlertTriangle, Check, FileUp, LoaderCircle, Save, Upload, X } from "lucide-react";
import { api, EQuestion, getToken, SERVER } from "./api";

type ParsedQuiz = { title: string; description: string; category: string; questions: EQuestion[] };

export default function PdfImport({ categories, onCancel, onDone }: { categories: string[]; onCancel: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedQuiz | null>(null);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [showAll, setShowAll] = useState(false);

  async function analyze() {
    if (!file) { setError("Avval PDF yoki DOCX faylni tanlang."); return; }
    setBusy(true); setError(""); setParsed(null); setWarning("");
    try {
      const form = new FormData(); form.append("pdf", file);
      const response = await fetch(`${SERVER}/api/quizzes/import-pdf`, { method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Fayl tahlil qilinmadi.");
      setParsed(data.quiz); setWarning(data.warning || "");
    } catch (e: any) { setError(e.message || "Internetga ulanishda xatolik."); }
    finally { setBusy(false); }
  }

  function setCorrect(qi: number, correct: number) {
    setParsed(p => p ? ({ ...p, questions: p.questions.map((q, i) => i === qi ? { ...q, correct } : q) }) : p);
  }

  async function save() {
    if (!parsed) return;
    if (parsed.questions.length < 1) { setError("Saqlash uchun savol topilmadi."); return; }
    setSaving(true); setError("");
    try {
      await api("/api/quizzes", { body: { title: parsed.title, description: parsed.description, category: parsed.category, isPublic, questions: parsed.questions } });
      onDone();
    } catch (e: any) { setError(e.message || "Test saqlanmadi."); }
    finally { setSaving(false); }
  }

  return <div className="stack">
    <div className="row between"><h1 className="h1">PDF yoki DOCX orqali test qo‘shish</h1><button className="icon-btn" onClick={onCancel} aria-label="Yopish"><X size={18}/></button></div>
    <div className="card stack">
      <div className="row gap"><FileUp size={25}/><div className="grow"><b>PDF yoki DOCX faylni yuklang</b><small className="muted block">Telefon yoki kompyuterdan · 15 MB gacha · 300 tagacha savol</small></div></div>
      <input type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={e => { setFile(e.target.files?.[0] || null); setParsed(null); setError(""); }} />
      {file && <small className="muted">Tanlandi: {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</small>}
      <button className="primary" disabled={!file || busy} onClick={analyze}>{busy ? <><LoaderCircle className="spin" size={17}/> Gemini tahlil qilmoqda…</> : <><Upload size={17}/> Faylni tahlil qilish</>}</button>
      <small className="muted">Yuklash biroz vaqt olishi mumkin.Sabr qiling🤌.</small>
    </div>
    {error && <p className="err">{error}</p>}
    {parsed && <>
      <div className="card stack">
        <div className="row gap"><Check size={20}/><b>{parsed.questions.length} ta savol ajratildi</b></div>
        <label>Test nomi<input maxLength={60} value={parsed.title} onChange={e => setParsed(p => p ? { ...p, title: e.target.value } : p)}/></label>
        <label>Qisqa tavsif<input maxLength={140} value={parsed.description} onChange={e => setParsed(p => p ? { ...p, description: e.target.value } : p)}/></label>
        <label>Mavzu<select value={parsed.category} onChange={e => setParsed(p => p ? { ...p, category: e.target.value } : p)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="inline"><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)}/> Ommaviy test sifatida ko‘rsatish</label>
      </div>
      <div className="ai-note"><b><AlertTriangle size={15} style={{display:"inline",verticalAlign:"middle"}}/> Javoblarni tekshiring</b><p>{warning || "AI belgilagan to‘g‘ri javoblar xato bo‘lishi mumkin. Saqlashdan oldin ko‘rib chiqing."}</p></div>
      <div className="row between"><b className="sec">Savollarni ko‘rib chiqish</b><button className="ghost" onClick={() => setShowAll(v => !v)}>{showAll ? "Qisqartirish" : "Barchasini ko‘rish"}</button></div>
      {(showAll ? parsed.questions : parsed.questions.slice(0, 5)).map((q, i) => <div className="card stack" key={`${i}-${q.text}`}>
        <b>{i + 1}. {q.text}</b>
        <small className="muted">To‘g‘ri javobni tanlang:</small>
        {q.options.map((o, k) => <button key={k} className={`rv-opt ${q.correct === k ? "right" : ""}`} style={{textAlign:"left",width:"100%"}} onClick={() => setCorrect(i, k)}><span>{"ABCD"[k]}</span><em>{o}</em>{q.correct === k && <Check size={16}/>}</button>)}
      </div>)}
      {!showAll && parsed.questions.length > 5 && <button className="ghost" onClick={() => setShowAll(true)}>Qolgan {parsed.questions.length - 5} ta savolni ko‘rish</button>}
      <div className="row gap"><button className="ghost grow" onClick={onCancel}>Bekor qilish</button><button className="primary grow" disabled={saving || !parsed.title.trim()} onClick={save}>{saving ? <><LoaderCircle size={17}/> Saqlanmoqda…</> : <><Save size={17}/> Testlarga saqlash</>}</button></div>
    </>}
  </div>;
}
