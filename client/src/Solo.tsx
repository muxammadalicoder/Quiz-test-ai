import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Mic, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { User, api, haptic, tg } from "./api";
import { Confetti, Review, ReviewItem, TimerBar } from "./ui";
import { canListen, canRecord, canSpeak, listen, matchAnswer, pickVoice, speak, startClip, stopListen, stopSpeak, unlockAudio } from "./voice";

type Q = { index: number; total: number; text: string; options: string[]; time: number; score: number };
type Res = { explanation?: string; correct: boolean; correctIndex: number; points: number; score: number; streak: number; timedOut: boolean; next?: boolean;
  finished?: { review: ReviewItem[]; score: number; correct: number; total: number; user: User; levelUp: boolean } };
const LETTERS = ["A", "B", "C", "D"];

export default function Solo({ quizId, count, talk = false, ai = false, onExit, onUser }: { quizId: string; count: number; talk?: boolean; ai?: boolean; onExit: () => void; onUser: (u: User) => void }) {
  const [sid, setSid] = useState(""); const [title, setTitle] = useState(""); const [q, setQ] = useState<Q | null>(null);
  const [res, setRes] = useState<Res | null>(null); const [picked, setPicked] = useState(-1); const [left, setLeft] = useState(0);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [showFinal, setShowFinal] = useState(false); const [early, setEarly] = useState<Res["finished"] | null>(null);
  const endRef = useRef(0); const lockRef = useRef(false);
  // Ovozli (AI suhbat) rejimi
  const [started, setStarted] = useState(!talk); const [sound, setSound] = useState(true); const [listening, setListening] = useState(false); const [hint, setHint] = useState("");
  const soundRef = useRef(true); soundRef.current = sound;
  const advRef = useRef(false); const curRef = useRef(-1); const alive = useRef(true);
  const voiceInfo = talk ? pickVoice() : null;
  const say = (t: string) => (talk && soundRef.current ? speak(t, ai) : Promise.resolve());
  const clipRef = useRef<{ stop: () => void } | null>(null);
  const micOk = (ai && canRecord) || canListen;
  useEffect(() => { alive.current = true; return () => { alive.current = false; clipRef.current?.stop(); stopSpeak(); stopListen(); }; }, []);

  useEffect(() => {
    if (!started) return;
    api("/api/solo/start", { body: { quizId, count, talk } }).then(d => { setSid(d.sid); setTitle(d.title); setQ(d.question); }).catch(e => setErr(e.message));
  }, [quizId, started]);

  useEffect(() => {
    if (!q) return; lockRef.current = false; advRef.current = false; curRef.current = q.index; setHint("");
    if (talk) say(`${q.index + 1}-savol. ${q.text}. ${q.options.map((o, i) => `${LETTERS[i]}, ${o}`).join(". ")}`); endRef.current = Date.now() + q.time * 1000; setLeft(q.time);
    const t = setInterval(() => {
      const l = Math.max(0, (endRef.current - Date.now()) / 1000); setLeft(l);
      if (l <= 0) { clearInterval(t); submit(-1); }
    }, 100);
    return () => clearInterval(t);
  }, [q]);

  async function submit(i: number) {
    if (lockRef.current || !sid) return; lockRef.current = true; setPicked(i);
    try {
      stopListen(); setListening(false);
      const r: Res = await api("/api/solo/answer", { body: { sid, index: i, explain: talk } });
      setRes(r); haptic(r.correct ? "success" : "error");
      if (r.finished) onUser(r.finished.user);
      if (talk) {
        const right = q ? `${LETTERS[r.correctIndex]}, ${q.options[r.correctIndex]}` : "";
        const text = r.correct ? `To‘g‘ri! ${r.points} ball.` : `${r.timedOut ? "Vaqt tugadi." : "Noto‘g‘ri."} To‘g‘ri javob: ${right}. ${r.explanation || ""}`;
        const qi = q?.index;
        say(text).then(() => { if (soundRef.current && r.next && alive.current && curRef.current === qi) setTimeout(() => { if (alive.current && curRef.current === qi) goNext(); }, 700); });
      }
    } catch (e: any) { setErr(e.message); }
  }
  async function finishNow() {
    if (res?.finished) { setShowFinal(true); return; }
    const ok = tg?.showConfirm ? await new Promise<boolean>(r => tg.showConfirm("Testni hozir yakunlaysizmi? Shu paytgacha to‘plangan ball hisoblanadi.", r)) : confirm("Testni hozir yakunlaysizmi?");
    if (!ok || !sid) return; lockRef.current = true;
    try { const d = await api("/api/solo/finish", { body: { sid } }); onUser(d.finished.user); setEarly(d.finished); } catch (e: any) { lockRef.current = false; setErr(e.message); }
  }
  function goNext() { if (advRef.current) return; advRef.current = true; next(); }
  async function mic() {
    if (res || lockRef.current || !q) return;
    if (clipRef.current) { clipRef.current.stop(); return; } // yozib turgan bo'lsa, qayta bosish yozishni to'xtatadi
    stopSpeak();
    if (ai && canRecord) {
      const qi = q.index;
      try {
        setHint("🎤 Gapiring… tugatgach yana bosing"); setListening(true);
        const clip = await startClip(7000); clipRef.current = clip;
        const rec = await clip.done; clipRef.current = null; setListening(false); setHint("⏳ Tushunyapman…");
        const r = await api("/api/ai/listen", { body: { audio: rec.b64, mime: rec.mime, options: q.options } });
        if (curRef.current !== qi || lockRef.current) return;
        if (r.index >= 0) submit(r.index);
        else setHint(`Tushunmadim${r.heard ? `: “${r.heard}”` : ""}. Qayta urinib ko‘ring yoki tugmani bosing.`);
      } catch (e: any) {
        clipRef.current = null; setListening(false);
        setHint(e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "Mikrofonga ruxsat yo‘q. Telefon sozlamalarida Telegram uchun mikrofonni yoqing yoki tugma bilan javob bering." : (e?.message || "Mikrofon ishlamadi."));
      }
      return;
    } setHint("🎤 Eshityapman… variant harfini yoki javobni ayting"); setListening(true);
    try {
      const heard = await listen(); setListening(false);
      const idx = matchAnswer(heard, q.options);
      if (idx >= 0) submit(idx);
      else { setHint(heard.length ? `Eshitdim: “${heard[0]}”. Tushunmadim, qayta urinib ko‘ring yoki tugmani bosing.` : "Hech narsa eshitilmadi. Qayta urinib ko‘ring."); }
    } catch (e: any) { setListening(false); setHint(e.message); }
  }
  async function next() {
    setBusy(true);
    try { const d = await api("/api/solo/next", { body: { sid } }); setRes(null); setPicked(-1); setQ(d.question); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  useEffect(() => {
    const f = early || (res?.finished && showFinal ? res.finished : null);
    if (talk && f) { stopListen(); say(`Test tugadi. ${f.total} ta savoldan ${f.correct} tasiga to‘g‘ri javob berdingiz. Jami ${f.score} ball.`); }
  }, [early, showFinal]);

  if (talk && !started) return (
    <div className="stack center">
      <div className="big-emoji">🎙️</div><h1 className="big-title">AI bilan suhbat</h1>
      <p className="muted">AI savolni ovoz chiqarib o‘qiydi. Javobni tugma bilan{micOk ? " yoki ovoz bilan" : ""} berasiz, AI to‘g‘ri-noto‘g‘riligini aytadi va xatoni tushuntiradi.</p>
      {!ai && !canSpeak && <p className="err">Bu qurilmada ovoz chiqarish ishlamaydi, savollar faqat yozuv ko‘rinishida chiqadi.</p>}
      {!ai && canSpeak && voiceInfo && !voiceInfo.exact && <p className="muted">Qurilmangizda o‘zbek ovozi topilmadi{voiceInfo.voice ? `, “${voiceInfo.voice.lang}” ovozi ishlatiladi (talaffuz noaniq bo‘lishi mumkin)` : ""}.</p>}
      {!micOk && <p className="muted">Ovozni tanish bu qurilmada yo‘q — javobni tugma bilan bering.</p>}
      <button className="primary lg" onClick={() => { unlockAudio(); setStarted(true); speak("Boshladik!", ai); }}>▶ Boshlash</button>
      <button className="ghost" onClick={onExit}>Orqaga</button>
    </div>
  );
  if (err) return <div className="stack center"><p className="err">{err}</p><button className="primary" onClick={onExit}>Orqaga</button></div>;
  const fin = early || (res?.finished && showFinal ? res.finished : null);
  if (fin) {
    const f = fin, pct = Math.round((f.correct / f.total) * 100);
    return (
      <div className="stack center">
        {pct >= 60 && <Confetti />}
        <motion.div className="big-emoji" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>{pct >= 80 ? "🏆" : pct >= 50 ? "👏" : "💪"}</motion.div>
        <h1 className="big-title">{pct >= 80 ? "Ajoyib natija!" : pct >= 50 ? "Yaxshi urinish!" : "Yana urinib ko‘ring!"}</h1>
        <div className="stat-row">
          <div><b>{f.score}</b><small>BALL</small></div><div><b>{f.correct}/{f.total}</b><small>TO‘G‘RI</small></div><div><b>{pct}%</b><small>ANIQLIK</small></div>
        </div>
        {f.levelUp && <div className="champ"><small>YANGI DARAJA</small><b>{f.user.level}-daraja 🎉</b></div>}
        <Review items={f.review} />
        <button className="primary lg" onClick={onExit}>Yakunlash</button>
      </div>
    );
  }
  if (!q) return <div className="stack center"><i className="spinner" /></div>;
  return (
    <div className="stack">
      <div className="row between"><button className="ghost sm danger" onClick={finishNow}>⏹ Testni yakunlash</button><span className="pill">{q.index + 1} / {q.total}</span><span className="pill gold">{res?.score ?? q.score} ball</span></div>
      {talk && <div className="row gap-s center-row">
        <button className="icon-btn" onClick={() => { setSound(s => { if (s) stopSpeak(); return !s; }); }} aria-label="Ovoz">{sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        <button className="icon-btn" onClick={() => say(`${q.text}. ${q.options.map((o, i) => `${LETTERS[i]}, ${o}`).join(". ")}`)} aria-label="Qayta o‘qish"><RotateCcw size={16} /></button>
        {micOk && <button className={`mic-btn ${listening ? "on" : ""}`} disabled={!!res} onClick={mic}><Mic size={18} /> {listening ? (ai && canRecord ? "Tugatish" : "Eshityapman…") : "Ovoz bilan javob"}</button>}
      </div>}
      {talk && hint && <small className="muted center-t">{hint}</small>}
      <small className="muted center-t">{title}</small>
      <TimerBar left={res ? 0 : left} total={q.time} />
      <motion.h1 key={q.index} className="qtext" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>{q.text}</motion.h1>
      <div className="answers">
        {q.options.map((o, i) => {
          const state = res ? (i === res.correctIndex ? "right" : i === picked ? "wrong" : "dim") : "";
          return (
            <motion.button key={i} whileTap={{ scale: .96 }} disabled={!!res} className={`ans c${i} ${state}`} onClick={() => submit(i)}>
              <span>{LETTERS[i]}</span>{o}{state === "right" && <Check size={20} />}{state === "wrong" && <X size={20} />}
            </motion.button>
          );
        })}
      </div>
      {res && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stack">
          <div className={`verdict ${res.correct ? "ok" : "bad"}`}>
            {res.correct ? <><Check size={26} /><div><b>To‘g‘ri!</b><small>+{res.points} ball{res.streak > 1 ? ` · 🔥 ${res.streak} ketma-ket` : ""}</small></div></>
              : <><X size={26} /><div><b>{res.timedOut ? "Vaqt tugadi" : "Noto‘g‘ri"}</b><small>To‘g‘ri javob belgilandi</small></div></>}
          </div>
          {res.explanation && <div className="ai-note"><b>🤖 AI izohi</b><p>{res.explanation}</p></div>}
          <button className="primary lg" disabled={busy} onClick={res.next ? goNext : () => setShowFinal(true)}>{res.next ? "Keyingi savol" : "Natijani ko‘rish"}</button>
        </motion.div>
      )}
    </div>
  );
}
