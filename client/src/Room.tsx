import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Crown, LogOut, Play, Send, SkipForward, UserX, Users, WifiOff, X } from "lucide-react";
import { haptic, tg } from "./api";
import { Avatar, Confetti, Podium, Review, ReviewItem, TimerBar, useCountdown } from "./ui";

export type RP = { id: string; name: string; avatar: string; level: number; score: number; streak: number; connected: boolean; answered: boolean; correct?: boolean; points?: number };
export type RoomState = {
  code: string; hostId: string; status: "lobby" | "question" | "results" | "finished"; now: number; endsAt: number;
  quiz: { id: string; title: string; category: string; total: number }; index: number; players: RP[]; leaderboard: RP[];
  question?: { text: string; options: string[]; time: number }; correctIndex?: number; counts?: number[];
  me?: { answer?: number; points?: number; correct?: boolean; answered: boolean }; gained?: Record<string, number>; review?: ReviewItem[];
};
const LETTERS = ["A", "B", "C", "D"];

export default function Room({ s, userId, socket, bot, reactions }: { s: RoomState; userId: string; socket: Socket; bot?: string; reactions: string[] }) {
  const isHost = s.hostId === userId;
  const left = useCountdown(s.endsAt, s.now);
  const [floats, setFloats] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const on = (r: { id: string; emoji: string }) => {
      setFloats(f => [...f.slice(-14), { id: r.id, emoji: r.emoji, x: 10 + Math.random() * 80 }]);
      setTimeout(() => setFloats(f => f.filter(x => x.id !== r.id)), 2600);
    };
    socket.on("room:reaction", on); return () => { socket.off("room:reaction", on); };
  }, [socket]);

  useEffect(() => {
    if (s.status === "results") haptic(s.me?.correct ? "success" : "error");
  }, [s.status, s.index]);

  const link = bot ? `https://t.me/${bot}?startapp=${s.code}` : "";
  const share = () => {
    const text = `🎮 Quiz Arena: “${s.quiz.title}” o‘yiniga qo‘shiling! Kod: ${s.code}`;
    if (link && tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else { navigator.clipboard?.writeText(link || s.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };
  const endGame = async () => {
    const ok = tg?.showConfirm ? await new Promise<boolean>(r => tg.showConfirm("Testni hamma uchun yakunlaysizmi? Natijalar hozirgi ballar bo‘yicha chiqadi.", r)) : confirm("Testni hamma uchun yakunlaysizmi?");
    if (ok) socket.emit("game:end");
  };
  const react = (emoji: string) => { socket.emit("room:react", { emoji }); haptic("select"); };
  const answered = s.players.filter(p => p.answered).length, online = s.players.filter(p => p.connected).length;
  const me = s.players.find(p => p.id === userId);

  const reactBar = (
    <div className="react-bar">{reactions.map(e => <button key={e} onClick={() => react(e)}>{e}</button>)}</div>
  );

  return (
    <div className="room">
      <div className="floats">{floats.map(f => <motion.span key={f.id} initial={{ y: 0, opacity: 1, scale: .6 }} animate={{ y: -320, opacity: 0, scale: 1.4 }} transition={{ duration: 2.4 }} style={{ left: f.x + "%" }}>{f.emoji}</motion.span>)}</div>

      {s.status === "lobby" && (
        <div className="stack">
          <div className="row between">
            <button className="ghost sm" onClick={() => socket.emit("room:leave")}><LogOut size={15} /> Chiqish</button>
            <span className="pill"><Users size={13} /> {s.players.length}</span>
          </div>
          <div className="code-card">
            <small>XONA KODI</small>
            <strong>{s.code.split("").join(" ")}</strong>
            <span>{s.quiz.title} · {s.quiz.total} savol</span>
            <button className="primary sm" onClick={share}>{copied ? <><Check size={15} /> Nusxalandi</> : <><Send size={15} /> Do‘stlarni taklif qilish</>}</button>
          </div>
          <div className="player-grid">
            <AnimatePresence>
              {s.players.map(p => (
                <motion.div key={p.id} layout initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className={`pcard ${p.connected ? "" : "off"}`}>
                  <Avatar id={p.avatar} size={54} />
                  <b>{p.name}</b>
                  <small>{p.id === s.hostId ? <><Crown size={11} /> Boshlovchi</> : `${p.level}-daraja`}</small>
                  {isHost && p.id !== userId && <button className="kick" onClick={() => socket.emit("room:kick", { userId: p.id })} aria-label="Chiqarish"><UserX size={13} /></button>}
                  {!p.connected && <WifiOff className="offi" size={12} />}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {isHost
            ? <button className="primary lg" onClick={() => socket.emit("game:start")}><Play size={18} /> O‘yinni boshlash</button>
            : <div className="waiting"><i className="spinner" /> Boshlovchi o‘yinni boshlashini kutyapmiz…</div>}
          {reactBar}
        </div>
      )}

      {s.status === "question" && s.question && (
        <div className="stack">
          <div className="row between">
            <span className="pill">{s.index + 1} / {s.quiz.total}</span>
            <span className="pill gold">{me?.score ?? 0} ball</span>
          </div>
          <TimerBar left={left} total={s.question.time} />
          <motion.h1 key={s.index} className="qtext" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>{s.question.text}</motion.h1>
          {s.me?.answered ? (
            <div className="waiting big"><i className="spinner" /><div><b>Javob qabul qilindi!</b><br /><small>{answered} / {online} o‘yinchi javob berdi</small></div></div>
          ) : (
            <div className="answers">
              {s.question.options.map((o, i) => (
                <motion.button key={i} whileTap={{ scale: .96 }} className={`ans c${i}`} onClick={() => { haptic("light"); socket.emit("game:answer", { index: i }); }}>
                  <span>{LETTERS[i]}</span>{o}
                </motion.button>
              ))}
            </div>
          )}
          {isHost && <div className="row gap"><button className="ghost sm grow" onClick={() => socket.emit("game:skip")}><SkipForward size={14} /> Vaqtni tugatish</button><button className="ghost sm danger grow" onClick={endGame}>⏹ Testni yakunlash</button></div>}
        </div>
      )}

      {s.status === "results" && s.question && (
        <div className="stack">
          <div className="row between"><span className="pill">{s.index + 1} / {s.quiz.total}</span><span className="pill gold">{me?.score ?? 0} ball</span></div>
          <motion.div initial={{ scale: .8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`verdict ${s.me?.correct ? "ok" : "bad"}`}>
            {s.me?.correct ? <><Check size={28} /><div><b>To‘g‘ri!</b><small>+{s.me.points} ball{me && me.streak > 1 ? ` · 🔥 ${me.streak} ketma-ket` : ""}</small></div></>
              : <><X size={28} /><div><b>{s.me?.answered ? "Noto‘g‘ri" : "Vaqt tugadi"}</b><small>Keyingi savolda omad!</small></div></>}
          </motion.div>
          <h2 className="qtext sm">{s.question.text}</h2>
          <div className="dist">
            {s.question.options.map((o, i) => {
              const c = s.counts?.[i] ?? 0, max = Math.max(1, ...(s.counts || [1]));
              return (
                <div key={i} className={`dist-row ${i === s.correctIndex ? "right" : ""} ${s.me?.answer === i ? "mine" : ""}`}>
                  <span className={`dl c${i}`}>{LETTERS[i]}</span>
                  <div className="dbar"><motion.div initial={{ width: 0 }} animate={{ width: (c / max) * 100 + "%" }} /><em>{o}</em></div>
                  <b>{c}</b>{i === s.correctIndex && <Check size={16} />}
                </div>
              );
            })}
          </div>
          <div className="mini-board">
            {s.leaderboard.slice(0, 5).map((p, i) => (
              <motion.div layout key={p.id} className={`lrow ${p.id === userId ? "me" : ""}`}>
                <span className="rk">{i + 1}</span><Avatar id={p.avatar} size={30} /><b>{p.name}</b>
                {p.points ? <small className="plus">+{p.points}</small> : null}<strong>{p.score}</strong>
              </motion.div>
            ))}
          </div>
          {isHost ? <button className="primary lg" onClick={() => socket.emit("game:next")}>{s.index + 1 >= s.quiz.total ? "Natijalarni ko‘rsatish 🏆" : "Keyingi savol"}</button>
            : <div className="waiting"><i className="spinner" /> Boshlovchi davom ettirishini kutyapmiz…</div>}
          {isHost && <button className="ghost sm danger" onClick={endGame}>⏹ Testni yakunlash</button>}
          {reactBar}
        </div>
      )}

      {s.status === "finished" && (
        <div className="stack center">
          <Confetti />
          <motion.h1 className="big-title" initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>🏆 G‘oliblar!</motion.h1>
          <Podium top={s.leaderboard.slice(0, 3)} />
          {s.leaderboard[0] && <div className="champ"><small>CHEMPION</small><b>{s.leaderboard[0].name}</b><span>{s.leaderboard[0].score} ball bilan birinchi o‘rinni egalladi!</span></div>}
          <div className="mini-board wide">
            {s.leaderboard.map((p, i) => (
              <div key={p.id} className={`lrow ${p.id === userId ? "me" : ""}`}>
                <span className="rk">{i + 1}</span><Avatar id={p.avatar} size={30} still /><b>{p.name}</b>
                {s.gained?.[p.id] ? <small className="plus">+{s.gained[p.id]} XP</small> : null}<strong>{p.score}</strong>
              </div>
            ))}
          </div>
          <Review items={s.review} />
          {reactBar}
          <button className="primary lg" onClick={() => socket.emit("room:leave")}>Bosh sahifaga qaytish</button>
        </div>
      )}
    </div>
  );
}
