import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { AnimatePresence, motion } from "framer-motion";
import { Home as HomeIcon, Library as LibIcon, Plus, ShieldCheck, Trophy, User as UserIcon, Volume2, VolumeX } from "lucide-react";
import { Config, QuizCard, User, api, connectSocket, getToken, inTelegram, setAuthFailHandler, setToken, tg } from "./api";
import { Avatar, Sheet } from "./ui";
import { Board, Home, Library, Profile } from "./Screens";
import Editor, { Draft, newDraft } from "./Editor";
import PdfImport from "./PdfImport";
import Solo from "./Solo";
import Memorize from "./Memorize";
import Room, { RoomState } from "./Room";
import { playClick, setSoundsEnabled, soundsEnabled, startBackgroundMusic, startTestMusic, stopBackgroundMusic } from "./sounds";

type Tab = "home" | "library" | "create" | "board" | "profile" | "memorize" | "sections50";
type Mode = "any" | "room" | "solo";
type Boot = "loading" | "ready" | "login" | "tgonly";

export default function App() {
  const [boot, setBoot] = useState<Boot>("loading");
  const [cfg, setCfg] = useState<Config>({ guest: false, categories: ["Bulutli texnologiyalar"], reactions: [] });
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [mode, setMode] = useState<Mode>("any");
  const [sheetQuiz, setSheetQuiz] = useState<QuizCard | null>(null);
  const [soloId, setSoloId] = useState("");
  const [memorizeRange, setMemorizeRange] = useState<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pdfImport, setPdfImport] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [libKey, setLibKey] = useState(0);
  const [guestName, setGuestName] = useState("");
  const [online, setOnline] = useState(0);
  const [count, setCount] = useState(0);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [talk, setTalk] = useState(false);
  const [soundOn, setSoundOn] = useState(() => soundsEnabled());
  const socketRef = useRef<Socket | null>(null);

  // Fon musiqasi brauzerning audio cheklovlariga mos ravishda ilk foydalanuvchi harakatidan keyin boshlanadi.
  useEffect(() => {
    startBackgroundMusic();
    const unlock = () => { if (soundsEnabled()) startBackgroundMusic(); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      stopBackgroundMusic();
    };
  }, []);

  // Xona kutish zalida umumiy kuy, savollar davomida esa test musiqasi.
  useEffect(() => {
    if (!room) return;
    if (room.status === "question" || room.status === "results") startTestMusic();
    else startBackgroundMusic();
    return () => { if (room.status === "finished") startBackgroundMusic(); };
  }, [room?.status]);

  const say = useCallback((text: string, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(null), 3200); }, []);

  useEffect(() => {
    try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); tg?.setHeaderColor?.("#0b0d1c"); tg?.setBackgroundColor?.("#0b0d1c"); } catch { /* yo'q */ }
    setAuthFailHandler(() => { setToken(""); setUser(null); if (inTelegram) location.reload(); else setBoot("login"); });
    (async () => {
      let c: Config = cfg;
      try { c = await api("/api/config", { auth: false }); setCfg(c); } catch { say("Serverga ulanib bo‘lmadi.", true); }
      try {
        if (inTelegram) {
          const d = await api("/api/auth/telegram", { auth: false, body: { initData: tg.initData } });
          setToken(d.token); setUser(d.user); setBoot("ready"); return;
        }
        if (getToken()) { const d = await api("/api/me"); setUser(d.user); setBoot("ready"); return; }
      } catch { setToken(""); }
      setBoot(c.guest ? "login" : "tgonly");
    })();
  }, []);

  // Realtime ulanish
  useEffect(() => {
    if (boot !== "ready" || !user) return;
    const s = connectSocket(); socketRef.current = s;
    s.on("room:state", (st: RoomState) => setRoom(st));
    s.on("room:none", () => setRoom(null));
    s.on("online", (n: number) => setOnline(n));
    s.on("room:error", (m: string) => say(m, true));
    s.on("connect_error", () => {});
    const start = tg?.initDataUnsafe?.start_param;
    if (typeof start === "string" && /^[A-Z0-9]{6}$/.test(start)) s.once("connect", () => s.emit("room:join", { code: start }));
    return () => { s.close(); socketRef.current = null; };
  }, [boot, user?.id]);

  // Xona yakunlanganda profil statistikasini yangilash
  useEffect(() => { if (room?.status === "finished") api("/api/me").then(d => setUser(d.user)).catch(() => {}); }, [room?.status]);

  // Telegram "orqaga" tugmasi
  useEffect(() => {
    const bb = tg?.BackButton; if (!bb) return;
    const back = () => { if (soloId) { setSoloId(""); setMemorizeRange(null); } else if (draft) setDraft(null); else if (pdfImport) setPdfImport(false); else if (tab !== "home") setTab("home"); };
    const show = !room && (soloId || draft || pdfImport || tab !== "home");
    show ? bb.show() : bb.hide(); bb.onClick(back); return () => bb.offClick(back);
  }, [soloId, draft, pdfImport, tab, room]);

  async function guestLogin() {
    try { const d = await api("/api/auth/guest", { auth: false, body: { name: guestName } }); setToken(d.token); setUser(d.user); setBoot("ready"); } catch (e: any) { say(e.message, true); }
  }
  const logout = () => { setToken(""); setUser(null); setRoom(null); setBoot("login"); };
  const editQuiz = async (q: QuizCard) => {
    try { const d = await api(`/api/quizzes/${q.id}`); setSheetQuiz(null); setDraft({ id: q.id, title: d.quiz.title, description: d.quiz.description, category: d.quiz.category, isPublic: d.quiz.isPublic, questions: d.quiz.questions }); } catch (e: any) { say(e.message, true); }
  };
  const removeQuiz = async (q: QuizCard) => {
    const password = prompt(`“${q.title}” testini o‘chirish uchun maxsus parolni kiriting:`);
    if (!password) return;
    try { await api(`/api/quizzes/${q.id}`, { method: "DELETE", body: { password } }); setSheetQuiz(null); setLibKey(k => k + 1); say("Test o‘chirildi."); } catch (e: any) { say(e.message, true); }
  };

  if (boot === "loading") return <div className="splash"><div className="logo">🎯</div><i className="spinner" /></div>;
  if (boot === "tgonly") return (
    <div className="splash"><div className="logo">🎯</div><h1 className="h1">Quiz Arena</h1>
      <p className="muted center-t">Xavfsiz kirish uchun ilovani Telegram bot orqali oching.</p>
      {cfg.bot && <a className="primary" href={`https://t.me/${cfg.bot}`}>Telegram’da ochish</a>}</div>
  );
  if (boot === "login") return (
    <div className="splash"><div className="logo">🎯</div><h1 className="h1">Quiz Arena</h1>
      <p className="muted center-t">Test yarating, do‘stlar bilan bellashing!</p>
      <input value={guestName} maxLength={18} placeholder="Ismingiz" onChange={e => setGuestName(e.target.value)} />
      <button className="primary lg" onClick={guestLogin}>Kirish</button>
      <small className="muted center-t">Sinov rejimi: Telegram’siz kirish faqat ishlab chiqish uchun.</small>
      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`}>{toast.text}</div>}</div>
  );
  if (!user) return null;

  const view = () => {
    if (room && socketRef.current) return <Room s={room} userId={user.id} socket={socketRef.current} bot={cfg.bot} reactions={cfg.reactions} />;
    if (soloId) return <Solo quizId={soloId} count={count} shuffleQuestions={shuffleQuestions} talk={talk} ai={!!cfg.ai} memorizeRange={(tab === "memorize" || tab === "sections50") ? memorizeRange : null} onExit={() => { setSoloId(""); setMemorizeRange(null); }} onUser={setUser} />;
    if (pdfImport) return <PdfImport categories={cfg.categories} onCancel={() => setPdfImport(false)} onDone={() => { setPdfImport(false); setTab("library"); setLibKey(k => k + 1); say("PDF testlari saqlandi ✓"); }} />;
    if (draft) return <Editor draft={draft} categories={cfg.categories} onCancel={() => setDraft(null)} onDone={() => { setDraft(null); setTab("library"); setLibKey(k => k + 1); say("Test saqlandi ✓"); }} />;
    switch (tab) {
      case "home": return <Home user={user} go={t => { if (t === "create") setDraft(newDraft()); else if (t === "room" || t === "solo") { setMode(t); setTab("library"); } else { setMode("any"); setTab(t as Tab); } }} openQuiz={q => { setMode("any"); setSheetQuiz(q); }} onJoin={code => socketRef.current?.emit("room:join", { code })} />;
      case "library": return <Library mode={mode} categories={cfg.categories} openQuiz={setSheetQuiz} onCreate={() => setDraft(newDraft())} onImportPdf={() => setPdfImport(true)} refreshKey={libKey} />;
      case "memorize": return <Memorize sectionSize={10} title="Yodlash uchun" onStart={(id, start, end) => { setCount(0); setTalk(false); setMemorizeRange({ start, end }); setSoloId(id); }} />;
      case "sections50": return <Memorize sectionSize={50} title="50 talik bo‘limlar" onStart={(id, start, end) => { setCount(0); setTalk(false); setMemorizeRange({ start, end }); setSoloId(id); }} />;
      case "board": return <Board me={user} />;
      case "profile": return <Profile user={user} onSave={setUser} onLogout={logout} />;
      default: return null;
    }
  };
  const nav = !room && !soloId && !draft && !pdfImport;
  const mine = sheetQuiz && sheetQuiz.ownerId === user.id;

  return (
    <div className="app">
      <div className="bg" aria-hidden><i /><i /></div>
      {!room && !soloId && !draft && !pdfImport && (
        <header className="top"><div className="brand">🎯 Quiz<b>Arena</b></div><span className="online"><i />{online} onlayn</span><button className={`sound-toggle in-header ${soundOn ? "is-on" : ""}`} aria-label={soundOn ? "Ovozlarni o‘chirish" : "Ovozlarni yoqish"} title={soundOn ? "Ovozlarni o‘chirish" : "Ovozlarni yoqish"} onClick={() => { const next = !soundOn; setSoundOn(next); setSoundsEnabled(next); if (next) playClick(); }}>{soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><button className="chip-user" onClick={() => setTab("profile")}><Avatar id={user.avatar} size={30} /><span>{user.xp} XP</span></button></header>
      )}
      {(room || soloId || draft || pdfImport) && <button className={`sound-toggle floating ${soundOn ? "is-on" : ""}`} aria-label={soundOn ? "Ovozlarni o‘chirish" : "Ovozlarni yoqish"} title={soundOn ? "Ovozlarni o‘chirish" : "Ovozlarni yoqish"} onClick={() => { const next = !soundOn; setSoundOn(next); setSoundsEnabled(next); if (next) playClick(); }}>{soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>}
      <main><AnimatePresence mode="wait"><motion.div key={room ? "room" : soloId ? "solo" : pdfImport ? "pdf-import" : draft ? "edit" : tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>{view()}</motion.div></AnimatePresence></main>
      {nav && (
        <nav className="tabbar">
          {([["home", HomeIcon, "Bosh"], ["library", LibIcon, "Testlar"], ["create", Plus, "Yaratish"], ["board", Trophy, "Reyting"], ["profile", UserIcon, "Profil"]] as const).map(([id, I, label]) => (
            <button key={id} className={tab === id && id !== "create" ? "on" : ""} onClick={() => { playClick(); if (id === "create") setDraft(newDraft()); else { if (id === "library") setMode("any"); setTab(id); } }}>
              <span className={id === "create" ? "plus-btn" : ""}><I size={id === "create" ? 22 : 20} /></span><small>{label}</small>
            </button>
          ))}
        </nav>
      )}
      <Sheet open={!!sheetQuiz} onClose={() => setSheetQuiz(null)} title={sheetQuiz?.title}>
        {sheetQuiz && (
          <div className="stack">
            <p className="muted">{sheetQuiz.description || "Tavsif yo‘q"}</p>
            <small className="muted">{sheetQuiz.category} · {sheetQuiz.count} savol · {sheetQuiz.plays} marta o‘ynalgan · Muallif: {sheetQuiz.owner}</small>
            {mode !== "any" && <div className="stack">
              <small className="muted">Nechta savol bo‘lsin?</small>
              <div className="chips">{[0, 20, 25, 30].filter(n => n === 0 || n < sheetQuiz.count).map(n => <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n === 0 ? `Hammasi (${sheetQuiz.count})` : `${n} ta`}</button>)}</div>
              <button className={`ghost ${shuffleQuestions ? "is-on" : ""}`} onClick={() => setShuffleQuestions(v => !v)}>{shuffleQuestions ? "🔀 Savollar aralashtiriladi: YOQILGAN" : "🔀 Savollarni aralashtirish: O‘CHIRILGAN"}</button>
              <small className="muted">{shuffleQuestions ? "Savollar tasodifiy tartibda beriladi." : "Savollar testdagi asl tartibda beriladi."}</small>
            </div>}
            {mode === "solo" && <button className="primary lg" onClick={() => { setMemorizeRange(null); setTalk(false); setSoloId(sheetQuiz.id); setSheetQuiz(null); }}>🎯 Yakka o‘ynash</button>}
            {mode === "solo" && <button className="primary lg ai" onClick={() => { setMemorizeRange(null); setTalk(true); setSoloId(sheetQuiz.id); setSheetQuiz(null); }}>🎙 AI bilan suhbat (ovozli)</button>}
            {mode === "room" && <button className="primary lg alt" onClick={() => { socketRef.current?.emit("room:create", { quizId: sheetQuiz.id, count, shuffleQuestions }); setSheetQuiz(null); }}>⚔️ Ommaviy xona ochish</button>}
            {mode === "any" && <div className="row gap">{mine && <button className="ghost grow" onClick={() => editQuiz(sheetQuiz)}>✏️ Tahrirlash</button>}<button className="ghost grow danger" onClick={() => removeQuiz(sheetQuiz)}>🗑 O‘chirish</button></div>}
          </div>
        )}
      </Sheet>
      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`}>{toast.text}</div>}
      {!room && !soloId && tab === "profile" && inTelegram && <div className="secure"><ShieldCheck size={13} /> Telegram orqali xavfsiz tasdiqlangan</div>}
    </div>
  );
}
