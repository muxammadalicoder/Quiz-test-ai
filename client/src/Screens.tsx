import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Hash, Lock, Plus, Search, Swords, Trophy, Users } from "lucide-react";
import { QuizCard, User, api, inTelegram } from "./api";
import { AV, Avatar, Empty } from "./ui";

const xpFor = (lvl: number) => (lvl - 1) * (lvl - 1) * 100; // level = floor(sqrt(xp/100))+1
export function XpBar({ u }: { u: User }) {
  const a = xpFor(u.level), b = xpFor(u.level + 1), pct = Math.min(100, ((u.xp - a) / (b - a)) * 100);
  return <div className="xp"><div className="xp-track"><motion.div initial={{ width: 0 }} animate={{ width: pct + "%" }} /></div><small>{u.xp - a} / {b - a} XP</small></div>;
}

export function QuizItem({ q, onOpen, mine }: { q: QuizCard; onOpen: () => void; mine?: boolean }) {
  return (
    <motion.button whileTap={{ scale: .98 }} className="qitem" onClick={onOpen}>
      <span className="qi-icon">{q.isPublic ? "📚" : <Lock size={18} />}</span>
      <span className="qi-body"><b>{q.title}</b><small>{q.category} · {q.count} savol · {mine ? (q.isPublic ? "Ommaviy" : "Shaxsiy") : `👤 ${q.owner}`}</small></span>
      <span className="qi-plays"><Flame size={13} />{q.plays}</span>
    </motion.button>
  );
}

export function Home({ user, onJoin, go, openQuiz }: { user: User; onJoin: (code: string) => void; go: (t: string) => void; openQuiz: (q: QuizCard) => void }) {
  const [code, setCode] = useState(""); const [top, setTop] = useState<QuizCard[]>([]);
  useEffect(() => { api("/api/quizzes").then(d => setTop(d.quizzes.slice(0, 4))).catch(() => {}); }, []);
  return (
    <div className="stack">
      <div className="hello card">
        <Avatar id={user.avatar} size={64} ring />
        <div className="grow"><small className="muted">Xush kelibsiz,</small><h1 className="h1 tight">{user.name}</h1>
          <span className="lvl">⭐ {user.level}-daraja</span></div>
      </div>
      <XpBar u={user} />
      <div className="card stack">
        <b className="sec"><Hash size={15} /> Xonaga qo‘shilish</b>
        <div className="row gap">
          <input className="code-in" value={code} maxLength={6} placeholder="KOD" onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
          <button className="primary" disabled={code.length < 6} onClick={() => onJoin(code)}>Kirish</button>
        </div>
      </div>
      <div className="grid2">
        <button className="tile t-purple" onClick={() => go("room")}><Swords size={24} /><b>Ommaviy o‘yin</b><small>Xona oching, do‘stlarni chaqiring</small></button>
        <button className="tile t-cyan" onClick={() => go("solo")}><Trophy size={24} /><b>Yakka o‘yin</b><small>O‘zingiz bilimingizni sinang</small></button>
        <button className="tile t-orange" onClick={() => go("create")}><Plus size={24} /><b>Test yaratish</b><small>O‘z savollaringizni yozing</small></button>
        <button className="tile t-green" onClick={() => go("board")}><Users size={24} /><b>Reyting</b><small>Eng kuchli o‘yinchilar</small></button>
      </div>
      <b className="sec">🔥 Mashhur testlar</b>
      {top.map(q => <QuizItem key={q.id} q={q} onOpen={() => openQuiz(q)} />)}
    </div>
  );
}

export function Library({ mode, categories, openQuiz, onCreate, onImportPdf, refreshKey }: { mode: "any" | "room" | "solo"; categories: string[]; openQuiz: (q: QuizCard) => void; onCreate: () => void; onImportPdf: () => void; refreshKey: number }) {
  const [scope, setScope] = useState<"public" | "mine">("public"); const [q, setQ] = useState(""); const [cat, setCat] = useState("");
  const [list, setList] = useState<QuizCard[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => api(`/api/quizzes?scope=${scope}&q=${encodeURIComponent(q)}`).then(d => setList(d.quizzes)).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [scope, q, refreshKey]);
  const shown = (list || []).filter(x => !cat || x.category === cat);
  return (
    <div className="stack">
      <h1 className="h1">{mode === "room" ? "⚔️ Ommaviy o‘yin" : mode === "solo" ? "🎯 Yakka o‘yin" : "Testlar"}</h1>
      {mode !== "any" && <small className="muted">Test tanlang — {mode === "room" ? "xona shu test bilan ochiladi" : "o‘yin shu test bilan boshlanadi"}.</small>}
      <div className="seg"><button className={scope === "public" ? "on" : ""} onClick={() => setScope("public")}>🌍 Ommaviy</button><button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>📁 Mening testlarim</button></div>
      <div className="search"><Search size={16} /><input placeholder="Test qidirish…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="chips"><button className={!cat ? "on" : ""} onClick={() => setCat("")}>Hammasi</button>{categories.map(c => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}</div>
      {list === null ? <div className="center-t"><i className="spinner" /></div>
        : shown.length ? shown.map(x => <QuizItem key={x.id} q={x} mine={scope === "mine"} onOpen={() => openQuiz(x)} />)
        : <Empty icon="🗂️" text={scope === "mine" ? "Hali test yaratmagansiz." : "Hech narsa topilmadi."} />}
      {scope === "mine" && <button className="primary" onClick={onCreate}><Plus size={16} /> Yangi test</button>}
      {mode === "any" && <button className="ghost" onClick={onImportPdf}>📄 PDF orqali test yuklash (Gemini AI)</button>}
    </div>
  );
}

export function Board({ me }: { me: User }) {
  const [list, setList] = useState<User[] | null>(null);
  useEffect(() => { api("/api/leaderboard").then(d => setList(d.users)).catch(() => setList([])); }, []);
  return (
    <div className="stack">
      <h1 className="h1">🏅 Umumiy reyting</h1>
      {list === null ? <div className="center-t"><i className="spinner" /></div> : list.length === 0 ? <Empty icon="🏁" text="Hali hech kim o‘ynamagan. Birinchi bo‘ling!" /> :
        list.map((u, i) => (
          <div key={u.id} className={`lrow big ${u.id === me.id ? "me" : ""} ${i < 3 ? "top" + (i + 1) : ""}`}>
            <span className="rk">{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span><Avatar id={u.avatar} size={40} />
            <span className="grow"><b>{u.name}</b><small className="muted block">{u.level}-daraja · {u.wins} g‘alaba</small></span><strong>{u.xp} XP</strong>
          </div>
        ))}
    </div>
  );
}

export function Profile({ user, onSave, onLogout }: { user: User; onSave: (u: User) => void; onLogout: () => void }) {
  const [name, setName] = useState(user.name); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  async function patch(body: object) {
    setErr(""); setMsg("");
    try { const d = await api("/api/me", { method: "PATCH", body }); onSave(d.user); setMsg("Saqlandi ✓"); setTimeout(() => setMsg(""), 1500); } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="stack">
      <div className="card center-t stack"><div className="center-row"><Avatar id={user.avatar} size={96} ring /></div>
        <h1 className="h1 tight">{user.name}</h1>{user.username && <small className="muted">@{user.username}</small>}
        <span className="lvl">⭐ {user.level}-daraja</span><XpBar u={user} /></div>
      <div className="stat-row">
        <div><b>{user.games}</b><small>O‘YINLAR</small></div><div><b>{user.wins}</b><small>G‘ALABA</small></div><div><b>{user.bestScore}</b><small>REKORD</small></div>
      </div>
      <div className="medals"><span>🥇 {user.podiums[0]}</span><span>🥈 {user.podiums[1]}</span><span>🥉 {user.podiums[2]}</span></div>
      <div className="card stack"><b className="sec">Ism</b>
        <div className="row gap"><input value={name} maxLength={18} onChange={e => setName(e.target.value)} /><button className="primary" disabled={name.trim() === user.name || name.trim().length < 2} onClick={() => patch({ name })}>Saqlash</button></div></div>
      <div className="card stack"><b className="sec">Animatsiyali avatar tanlang</b>
        <div className="av-grid">
          {Object.entries(AV).map(([id, a]) => {
            const locked = user.level < a.min;
            return (
              <button key={id} disabled={locked} className={`av-opt ${user.avatar === id ? "on" : ""}`} onClick={() => patch({ avatar: id })}>
                <Avatar id={id} size={52} />{locked ? <small>🔒 {a.min}-daraja</small> : <small>{a.name}</small>}
              </button>
            );
          })}
        </div></div>
      {msg && <p className="ok">{msg}</p>}{err && <p className="err">{err}</p>}
      {!inTelegram && <button className="ghost" onClick={onLogout}>Chiqish</button>}
    </div>
  );
}
