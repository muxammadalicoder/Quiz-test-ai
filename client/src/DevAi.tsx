import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { api } from "./api";

type Patch = { id: string; path: string; explanation: string; oldStr: string; newStr: string };
type Msg = { role: "user" | "assistant"; text: string; steps?: string[]; patches?: Patch[] };
type Report = { issues: { sev: string; file: string; line: number; msg: string }[]; logs: string[]; report: { t: number; issues: number; newErrors: number; summary: string } | null; groq: boolean; github: boolean; local: boolean; autoHours: number };

/** Alohida oyna: AI muhandis loyiha kodini tahlil qiladi, xatolarni o‘zbekcha tushuntiradi, "Tuzat" bilan tuzatish tayyorlaydi. */
export default function DevAi({ onExit }: { onExit: () => void }) {
  const [pw, setPw] = useState(""); const [authed, setAuthed] = useState(false);
  const [rep, setRep] = useState<Report | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [applyMsg, setApplyMsg] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function login() {
    setErr(""); setBusy(true);
    try { const r = await api<Report>("/api/dev/report", { body: { password: pw } }); setRep(r); setAuthed(true); } catch (e: any) { setErr(e.message || "Kirib bo‘lmadi"); }
    setBusy(false);
  }
  async function ask(t: string, mode?: "fix") {
    const q = t.trim(); if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: q }]; setMsgs(next); setText(""); setBusy(true); setErr("");
    try {
      const d = await api<{ reply: string; steps: string[]; patches: Patch[]; mode: string }>("/api/dev/chat", { body: { password: pw, mode, messages: next.map(m => ({ role: m.role, text: m.text })) } });
      setMsgs([...next, { role: "assistant", text: d.reply || "(javob bo‘sh)", steps: d.steps, patches: d.patches }]);
    } catch (e: any) { setErr(e.message || "AI muhandis javob bermadi"); }
    setBusy(false);
  }
  async function apply(ids: string[]) {
    setBusy(true);
    try {
      const d = await api<{ results: { id: string; ok: boolean; message: string; url?: string }[] }>("/api/dev/apply", { body: { password: pw, ids } });
      setApplyMsg(m => ({ ...m, ...Object.fromEntries(d.results.map(r => [r.id, (r.ok ? "✅ " : "⚠️ ") + r.message])) }));
    } catch (e: any) { setErr(e.message || "Qo‘llab bo‘lmadi"); }
    setBusy(false);
  }

  const head = <div className="row gap" style={{ alignItems: "center" }}><button className="icon-btn" onClick={onExit} aria-label="Orqaga"><ArrowLeft size={18} /></button><h1 className="h1 tight" style={{ margin: 0 }}>🛠 AI muhandis</h1></div>;
  if (!authed) return (
    <section className="stack">{head}
      <p className="muted">Bu oyna faqat admin uchun. Loyiha kodini tahlil qiladi va xatolarni o‘zbekcha tushuntiradi.</p>
      <input type="password" placeholder="Admin paroli" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
      <button className="primary" disabled={!pw || busy} onClick={login}>Kirish</button>
      {err && <p className="err">{err}</p>}
    </section>
  );

  return (
    <section className="stack" style={{ minHeight: "65vh" }}>{head}
      {rep && <div className="card stack" style={{ fontSize: 13 }}>
        <div>🔎 Avtomatik tekshiruv: <b>{rep.issues.length}</b> ta muammo · 📜 jurnal: <b>{rep.logs.length}</b> ta yozuv</div>
        {rep.report?.summary && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>Oxirgi avto-tahlil ({new Date(rep.report.t).toLocaleString()}):{"\n"}{rep.report.summary}</div>}
        <small className="muted">{rep.autoHours > 0 ? `Har ${rep.autoHours} soatda avtomatik tekshiriladi. ` : "Avtomatik tekshiruv o‘chiq. "}{rep.github ? "Tuzatishlar GitHub’ga yuboriladi." : rep.local ? "Lokal rejim." : "GITHUB_TOKEN yo‘q: tuzatishni qo‘lda kiritasiz."}</small>
        {!rep.groq && <p className="err">GROQ_API_KEY yo‘q — AI ishlamaydi, faqat avtomatik tekshiruv bor.</p>}
      </div>}
      <div className="row gap" style={{ flexWrap: "wrap" }}>
        <button className="ghost" disabled={busy} onClick={() => ask("Loyihani tahlil qil: eng muhim xatolarni top va tushuntir.")}>🔍 Tahlil qil</button>
        <button className="ghost" disabled={busy} onClick={() => ask("Oxirgi xatolar jurnalini ko‘rib chiq va sabablarini tushuntir.")}>📜 Jurnal</button>
        <button className="primary" disabled={busy || !msgs.length} onClick={() => ask("/tuzat Yuqorida topilgan xatolarni tuzat.", "fix")}>🛠 Tuzat</button>
      </div>
      {msgs.map((m, i) => (
        <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "94%", padding: "10px 13px", borderRadius: 14, background: m.role === "user" ? "var(--accent, #343b70)" : "var(--panel, #171a2b)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {m.text}
          {m.steps && m.steps.length > 0 && <details style={{ marginTop: 6 }}><summary className="muted" style={{ fontSize: 12 }}>Ko‘rib chiqilgan: {m.steps.length} ta amal</summary><small className="muted">{m.steps.join(" → ")}</small></details>}
          {m.patches?.map(p => (
            <div key={p.id} className="card stack" style={{ marginTop: 8 }}>
              <b style={{ fontSize: 13 }}>{p.path}</b>
              {p.explanation && <small>{p.explanation}</small>}
              <pre style={{ overflowX: "auto", fontSize: 11, margin: 0, color: "#ff8f8f" }}>{p.oldStr.split("\n").map(l => "- " + l).join("\n")}</pre>
              <pre style={{ overflowX: "auto", fontSize: 11, margin: 0, color: "#8fe3a1" }}>{p.newStr.split("\n").map(l => "+ " + l).join("\n")}</pre>
              {applyMsg[p.id] ? <small>{applyMsg[p.id]}</small> : <button className="primary" disabled={busy} onClick={() => apply([p.id])}>Qo‘llash</button>}
            </div>
          ))}
          {m.patches && m.patches.filter(p => !applyMsg[p.id]).length > 1 && <button className="primary" style={{ marginTop: 8 }} disabled={busy} onClick={() => apply(m.patches!.filter(p => !applyMsg[p.id]).map(p => p.id))}>Hammasini qo‘llash</button>}
        </div>
      ))}
      {busy && <p className="muted">AI kodni o‘qiyapti… (1 daqiqagacha cho‘zilishi mumkin)</p>}
      {err && <p className="err">{err}</p>}
      <div ref={bottom} />
      <div className="row gap">
        <input style={{ flex: 1 }} placeholder="Savol yozing yoki /tuzat deb buyruq bering" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && ask(text)} />
        <button className="primary" disabled={busy || !text.trim()} onClick={() => ask(text)} aria-label="Yuborish"><Send size={16} /></button>
      </div>
    </section>
  );
}
